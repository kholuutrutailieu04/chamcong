/**
 * POST /api/manager/attendance-corrections/force-checkout
 *
 * Trưởng khoa force check-out cho nhân viên quên check-out hôm qua.
 * Tạo một bản ghi OUT với in_record_id trỏ đến IN gốc.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase';
import { calculateAndRecordRest } from '@/lib/rest-logic';
import { requireManager } from '@/lib/auth';

export async function POST(req: NextRequest) {
  const session = await requireManager();
  if (!session) return NextResponse.json({ error: 'Không có quyền truy cập.' }, { status: 401 });

  const admin = getAdminClient();

  try {
    const body = (await req.json()) as {
      in_record_id: string;
      ma_nv: string;
      reason: string;
      is_test?: boolean;
    };

    const { in_record_id, ma_nv, reason, is_test } = body;
    // Lấy khoa và email từ session token
    const khoa = session.ma_khoa as string;
    const nguoi_sua = session.email as string;

    if (!in_record_id || !ma_nv || !khoa || !reason || !nguoi_sua) {
      return NextResponse.json({ error: 'Thiếu dữ liệu bắt buộc.' }, { status: 400 });
    }

    // Kiểm tra bản ghi IN tồn tại và chưa có OUT
    const { data: inRecord } = await admin
      .from('lich_su_cham_cong')
      .select('id, ma_nv, ho_ten, khoa_ghi_nhan, loai_ca, thoi_gian, ghi_chu')
      .eq('id', in_record_id)
      .single();

    if (!inRecord) {
      return NextResponse.json({ error: 'Không tìm thấy bản ghi check-in.' }, { status: 404 });
    }

    // Kiểm tra quyền: nhân viên phải thuộc khoa
    const { data: dmKhoa } = await admin
      .from('dm_khoa_phong')
      .select('ten_khoa')
      .eq('ma_khoa', khoa)
      .single();
    const tenKhoa = dmKhoa?.ten_khoa || khoa;

    if (inRecord.khoa_ghi_nhan !== tenKhoa) {
      return NextResponse.json({ error: 'Không có quyền xử lý bản ghi ngoài khoa.' }, { status: 403 });
    }

    // Kiểm tra chưa có OUT
    const { data: existingOut } = await admin
      .from('lich_su_cham_cong')
      .select('id')
      .eq('in_record_id', in_record_id)
      .eq('loai_ca', 'OUT')
      .maybeSingle();

    if (existingOut) {
      return NextResponse.json({ error: 'Nhân viên này đã có check-out rồi.' }, { status: 409 });
    }

    const nowIso = new Date().toISOString();
    const note = `[FORCE-OUT] Bởi ${nguoi_sua}: ${reason}`;
    const { error: insertError } = await admin.from('lich_su_cham_cong').insert({
      ma_nv: inRecord.ma_nv,
      ho_ten: inRecord.ho_ten,
      khoa_ghi_nhan: inRecord.khoa_ghi_nhan,
      loai_ca: 'OUT',
      thoi_gian: nowIso,
      in_record_id: in_record_id,
      ghi_chu: note,
      is_test: is_test ?? false,
    });

    if (insertError) throw insertError;

    if (inRecord.loai_ca === 'IN_TRUC' && inRecord.ma_nv) {
       // Get default shift or rotation
       const { data: emp } = await admin.from('nhan_vien').select('loai_truc_mac_dinh').eq('ma_nv', inRecord.ma_nv).single();
       let shiftCode = emp?.loai_truc_mac_dinh;
       
       // Handle 3 kíp if applicable
       if (inRecord.ghi_chu?.includes('ca 3 kíp:')) {
          const match = inRecord.ghi_chu.match(/ca 3 kíp: (\w+)/);
          if (match && match[1]) shiftCode = match[1];
       }
       
       if (shiftCode) {
          await calculateAndRecordRest(admin, inRecord.ma_nv, shiftCode, nowIso, inRecord.khoa_ghi_nhan).catch(console.error);
       }
    }

    return NextResponse.json({ success: true, message: 'Force check-out thành công.' });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Lỗi máy chủ';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
