import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase';
import {
  buildCorrectionNote,
  findLatestOpenInRecord,
  getSelfCorrectionWindowMinutes,
  isInAttendanceType,
  minutesSince,
} from '@/lib/attendance-correction';

type CorrectionBody = {
  emp_id: string;
  target_type: 'IN_LAM' | 'IN_TRUC';
  reason?: string;
};

export async function POST(req: NextRequest) {
  const admin = getAdminClient();

  try {
    const body = (await req.json()) as CorrectionBody;
    const empId = body.emp_id?.trim();

    if (!empId || !isInAttendanceType(body.target_type)) {
      return NextResponse.json({ error: 'Thiếu emp_id hoặc target_type không hợp lệ.' }, { status: 400 });
    }

    const { data: employee } = await admin
      .from('nhan_vien')
      .select('ho_ten, trang_thai')
      .eq('ma_nv', empId)
      .single();

    if (!employee || !employee.trang_thai) {
      return NextResponse.json({ error: 'Tài khoản không hợp lệ.' }, { status: 403 });
    }

    const latestOpenIn = await findLatestOpenInRecord(admin, empId);
    if (!latestOpenIn || !latestOpenIn.thoi_gian || !isInAttendanceType(latestOpenIn.loai_ca)) {
      return NextResponse.json({ error: 'Không có bản ghi IN đang mở để sửa.' }, { status: 409 });
    }

    const windowMinutes = await getSelfCorrectionWindowMinutes(admin);
    const elapsedMinutes = minutesSince(latestOpenIn.thoi_gian);
    if (elapsedMinutes > windowMinutes) {
      return NextResponse.json({
        error: `Đã quá thời gian tự sửa (${windowMinutes} phút). Vui lòng liên hệ quản lý khoa.`,
      }, { status: 403 });
    }

    if (latestOpenIn.loai_ca === body.target_type) {
      return NextResponse.json({
        success: true,
        message: 'Loại chấm công đã đúng, không cần sửa.',
        data: {
          record_id: latestOpenIn.id,
          current_type: latestOpenIn.loai_ca,
          target_type: body.target_type,
          thoi_gian_goc: latestOpenIn.thoi_gian,
          minutes_since_checkin: elapsedMinutes,
        },
      });
    }

    const note = buildCorrectionNote({
      scope: 'EMPLOYEE',
      fromType: latestOpenIn.loai_ca,
      toType: body.target_type,
      reason: body.reason ?? null,
    });
    const mergedNote = latestOpenIn.ghi_chu ? `${latestOpenIn.ghi_chu} | ${note}` : note;

    const { error: updateError } = await admin
      .from('lich_su_cham_cong')
      .update({
        loai_ca: body.target_type,
        ghi_chu: mergedNote,
      })
      .eq('id', latestOpenIn.id);

    if (updateError) throw updateError;

    // Audit không được làm hỏng luồng chính.
    try {
      await admin.from('lich_su_sua_nham_cham_cong').insert({
        record_id: latestOpenIn.id,
        ma_nv: empId,
        ho_ten: employee.ho_ten,
        khoa_ghi_nhan: latestOpenIn.khoa_ghi_nhan,
        loai_ca_cu: latestOpenIn.loai_ca,
        loai_ca_moi: body.target_type,
        thoi_gian_goc: latestOpenIn.thoi_gian,
        pham_vi_sua: 'EMPLOYEE',
        ly_do: body.reason ?? null,
        nguoi_sua: empId,
        is_test: latestOpenIn.is_test ?? false,
      });
    } catch {}

    return NextResponse.json({
      success: true,
      message: 'Đã sửa nhầm thành công, giữ nguyên giờ check-in ban đầu.',
      data: {
        record_id: latestOpenIn.id,
        from_type: latestOpenIn.loai_ca,
        to_type: body.target_type,
        thoi_gian_goc: latestOpenIn.thoi_gian,
        minutes_since_checkin: elapsedMinutes,
        window_minutes: windowMinutes,
      },
    });
  } catch {
    return NextResponse.json({ error: 'Lỗi máy chủ.' }, { status: 500 });
  }
}
