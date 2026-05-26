import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase';
import type { Json } from '@/lib/database.types';
import { getTodayVN } from '@/lib/timezone';
import {
  LEAVE_TRANSACTION_SOURCES,
  buildLeaveUnits,
  createLeaveDebitTransactions,
  creditLeaveUnits,
  normalizeLeaveHalfDay,
  sumLeaveUnits,
} from '@/lib/attendance-summary';

type LeaveAuditEntry = {
  action: 'CREATE' | 'CANCEL';
  by: string;
  at: string;
  before: { tu_ngay: string; den_ngay: string } | null;
  after: { tu_ngay: string; den_ngay: string } | null;
};

// Lấy danh sách phép hôm nay của Khoa
export async function GET(req: NextRequest) {
  const khoa = req.nextUrl.searchParams.get('khoa');
  if (!khoa) return NextResponse.json({ error: 'Thiếu mã khoa' }, { status: 400 });

  const admin = getAdminClient();
  const today = getTodayVN();

  // Lấy các đơn phép bao trùm ngày hôm nay
  const { data, error } = await admin
    .from('don_nghi_phep')
    .select('id, ma_nv, ho_ten, loai_nghi, tu_ngay, den_ngay')
    .lte('tu_ngay', today)
    .gte('den_ngay', today); // Mặc định chỉ lấy đơn của khoa nên ta sẽ filter tiếp ở code nếu cần, hoặc join với nhân viên.
    // Vì bảng đơn giản hóa chưa kèm mã khoa, ta sẽ fetch toàn bộ nv của khoa trước.

  if (error) return NextResponse.json({ error: 'Lỗi truy vấn.' }, { status: 500 });

  const { data: nvs } = await admin.from('nhan_vien').select('ma_nv').eq('khoa_phong', khoa);
  const khoaNvIds = new Set(nvs?.map(n => n.ma_nv));

  const filtered = (data || []).filter(d => khoaNvIds.has(d.ma_nv));

  return NextResponse.json(filtered);
}

// Trưởng khoa bân đơn nghỉ (Ốm, Phép, v.v)
export async function POST(req: NextRequest) {
  const admin = getAdminClient();
  
  try {
    const { ma_nv, tu_ngay, den_ngay, loai_nghi, manager_email, buoi_nghi } = await req.json();
    // buoi_nghi: 'CA_NGAY' (mặc định) | 'SANG' | 'CHIEU'
    const buoiNghiValue = normalizeLeaveHalfDay(buoi_nghi);

    if (!ma_nv || !tu_ngay || !den_ngay || !loai_nghi || !manager_email) {
       return NextResponse.json({ error: 'Thiếu thông tin bắt buộc' }, { status: 400 });
    }

    // Tính số ngày nghỉ liên tiếp (số ngày)
    const t1 = new Date(tu_ngay).getTime();
    const t2 = new Date(den_ngay).getTime();
    if (Number.isNaN(t1) || Number.isNaN(t2) || t2 < t1) {
      return NextResponse.json({ error: 'Khoảng thời gian không hợp lệ' }, { status: 400 });
    }
    // Khọn nghỉ theo buổi chỉ được áp dụng cho đơn trong cùng 1 ngày (tu_ngay == den_ngay)
    if (buoiNghiValue !== 'CA_NGAY' && tu_ngay !== den_ngay) {
      return NextResponse.json(
        { error: 'Nghỉ theo buổi (Sáng/Chiều) chỉ áp dụng cho đơn trong cùng 1 ngày.' },
        { status: 400 },
      );
    }

    const leaveUnits = buildLeaveUnits({
      leaveId: 'pending',
      maNv: ma_nv,
      tuNgay: tu_ngay,
      denNgay: den_ngay,
      buoiNghi: buoiNghiValue,
    });
    const sumDays = sumLeaveUnits(leaveUnits);

    if (sumDays <= 0) return NextResponse.json({ error: 'Khoảng thời gian không hợp lệ' }, { status: 400 });

    // Ràng buộc số ngày nghỉ phép liên tiếp (11 ngày max - lấy từ cấu hình hệ thống)
    if (loai_nghi === 'NGHI_PHEP') {
        const { data: sysConfig } = await admin.from('cau_hinh_he_thong').select('value').eq('key', 'GIOI_HAN_PHEP_LIEN_TIEP').single();
        const maxLimit = sysConfig ? parseInt(sysConfig.value) : 11;
        if (sumDays > maxLimit) {
            return NextResponse.json({ error: `Vượt quá định mức nghỉ ${maxLimit} ngày liên tiếp.` }, { status: 400 });
        }
    }

    // 1. Lấy thông tin NV
    const { data: emp } = await admin.from('nhan_vien').select('ho_ten, quy_phep_nam, ngay_vao_lam').eq('ma_nv', ma_nv).single();
    if (!emp) return NextResponse.json({ error: 'Nhân viên không tồn tại' }, { status: 404 });

    // 2. Logic Thâm Niên (Premium Leave)
    // Nếu có ngay_vao_lam, cứ 5 năm tròn được cộng 1 ngày phép
    let bonusLeave = 0;
    if (emp.ngay_vao_lam) {
      const startYear = new Date(emp.ngay_vao_lam).getFullYear();
      const currentYear = new Date().getFullYear();
      const diff = currentYear - startYear;
      if (diff >= 5) {
        bonusLeave = Math.floor(diff / 5);
      }
    }

    // 3. Kiểm tra quỹ phép. Việc trừ thực tế sẽ đi qua ledger để có thể hoàn đúng từng ngày/buổi.
    let quyPhep = (emp.quy_phep_nam !== null ? emp.quy_phep_nam : 12) + bonusLeave;

    if (loai_nghi === 'NGHI_PHEP') {
        if (quyPhep < sumDays) {
            const displayDays = sumDays < 1 ? '0.5' : String(sumDays);
            return NextResponse.json({ error: `Quỹ phép của nhân viên chỉ còn ${quyPhep} ngày, không đủ cho ${displayDays} ngày xin nghỉ.` }, { status: 400 });
        }
    }

    const auditLog = [{
      action: 'CREATE',
      by: manager_email,
      at: new Date().toISOString(),
      before: null,
      after: { tu_ngay, den_ngay, loai_nghi, buoi_nghi: buoiNghiValue, sum_days: sumDays }
    }];

    const { data: insertedLeave, error } = await admin.from('don_nghi_phep').insert({
        ma_nv,
        ho_ten: emp.ho_ten,
        tu_ngay,
        den_ngay,
        loai_nghi,
        buoi_nghi: buoiNghiValue,
        ly_do: `[TRUONG KHOA UPDATE] Tao boi ${manager_email}`,
        audit_log: auditLog,
        is_test: ma_nv.startsWith('NV_TEST_')
    }).select('id, ma_nv, tu_ngay, den_ngay, buoi_nghi').single();

    if (error) throw error;

    try {
      if (loai_nghi === 'NGHI_PHEP') {
        await createLeaveDebitTransactions({
          admin,
          leaveId: insertedLeave.id,
          maNv: ma_nv,
          tuNgay: tu_ngay,
          denNgay: den_ngay,
          buoiNghi: buoiNghiValue,
          reason: `Tạo đơn nghỉ phép bởi ${manager_email}`,
        });

        quyPhep = quyPhep - sumDays;
        const { error: quotaError } = await admin
          .from('nhan_vien')
          .update({ quy_phep_nam: Math.round(quyPhep * 10) / 10 })
          .eq('ma_nv', ma_nv);

        if (quotaError) throw new Error(`Không thể cập nhật quỹ phép: ${quotaError.message}`);
      }
    } catch (ledgerError) {
      await admin.from('phep_quota_transactions').delete().eq('leave_id', insertedLeave.id);
      await admin.from('don_nghi_phep').delete().eq('id', insertedLeave.id);
      const message = ledgerError instanceof Error ? ledgerError.message : 'Không thể ghi ledger phép';
      return NextResponse.json({ error: message }, { status: 500 });
    }
    
    return NextResponse.json({ success: true, message: 'Cập nhật thành công' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Lỗi hệ thống khi tải phép.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// Hủy đơn nghỉ (Có độ trễ hiệu lực)
export async function DELETE(req: NextRequest) {
  const admin = getAdminClient();
  try {
    const { id, manager_email } = await req.json();
    if (!id || !manager_email) return NextResponse.json({ error: 'Thiếu dữ liệu' }, { status: 400 });

    const { data: plan } = await admin.from('don_nghi_phep').select('*').eq('id', id).single();
    if (!plan) return NextResponse.json({ error: 'Không tìm thấy lệnh nghỉ' }, { status: 404 });

    const todayDateStr = getTodayVN();

    const auditEntry: LeaveAuditEntry = {
      action: 'CANCEL',
      by: manager_email,
      at: new Date().toISOString(),
      before: { tu_ngay: plan.tu_ngay, den_ngay: plan.den_ngay },
      after: null,
    };

    const existingAudit = plan.audit_log
      ? (Array.isArray(plan.audit_log) ? plan.audit_log : JSON.parse(plan.audit_log as string))
      : [];

    // Nếu lệnh nghỉ chưa bắt đầu (tu_ngay > today) -> Xóa luôn
    if (plan.tu_ngay > todayDateStr) {
       if (plan.loai_nghi === 'NGHI_PHEP') {
         await creditLeaveUnits({
           admin,
           leaveId: plan.id,
           maNv: plan.ma_nv,
           tuNgay: plan.tu_ngay,
           denNgay: plan.den_ngay,
           buoiNghi: plan.buoi_nghi,
           source: LEAVE_TRANSACTION_SOURCES.managerCancel,
           reason: `Hoàn phép do xóa lệnh nghỉ tương lai bởi ${manager_email}`,
         });
       }
       await admin.from('don_nghi_phep').delete().eq('id', id);
       return NextResponse.json({ success: true, message: 'Đã xóa lệnh nghỉ trong tương lai' });
    }

    // Nếu lệnh nghỉ đã qua (den_ngay < today) -> Không cho phép xóa
    if (plan.den_ngay < todayDateStr) {
       return NextResponse.json({ error: 'Không thể hủy lệnh nghỉ trong quá khứ' }, { status: 400 });
    }

    // Đang diễn ra -> Cập nhật den_ngay = today (Hiệu lực hủy từ ngày mai)
    auditEntry.after = { tu_ngay: plan.tu_ngay, den_ngay: todayDateStr };
    existingAudit.push(auditEntry);

    const refundFrom = todayDateStr < plan.den_ngay ? addOneVNDay(todayDateStr) : null;
    if (refundFrom && plan.loai_nghi === 'NGHI_PHEP') {
      await creditLeaveUnits({
        admin,
        leaveId: plan.id,
        maNv: plan.ma_nv,
        tuNgay: refundFrom,
        denNgay: plan.den_ngay,
        buoiNghi: plan.buoi_nghi,
        source: LEAVE_TRANSACTION_SOURCES.managerCancel,
        reason: `Hoàn phép do hủy sớm bởi ${manager_email}`,
      });
    }

    await admin.from('don_nghi_phep').update({
       den_ngay: todayDateStr,
       audit_log: existingAudit as Json[],
       ly_do: `${plan.ly_do} | Hủy sớm bởi ${manager_email} từ ${todayDateStr}`
    }).eq('id', id);

    return NextResponse.json({ success: true, message: 'Lệnh nghỉ sẽ hết hiệu lực từ ngày mai.' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Lỗi hệ thống khi hủy lệnh nghỉ.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function addOneVNDay(dateStr: string): string {
  const date = new Date(`${dateStr}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().split('T')[0];
}
