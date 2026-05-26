import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase';
import { requireManager } from '@/lib/auth';
import { getTodayVN, getVNDayRangeUTC } from '@/lib/timezone';

export async function POST(req: NextRequest) {
  const session = await requireManager();
  if (!session) return NextResponse.json({ error: 'Không có quyền truy cập.' }, { status: 401 });

  const admin = getAdminClient();

  try {
    const body = (await req.json()) as { ma_nv?: string; reason?: string; is_test?: boolean };
    const maNv = body.ma_nv?.trim();
    const reason = body.reason?.trim();
    const khoa = session.ma_khoa as string;
    const managerEmail = session.email as string;

    if (!maNv || !khoa || !managerEmail || !reason) {
      return NextResponse.json({ error: 'Thiếu dữ liệu ra trực ngày đầu.' }, { status: 400 });
    }

    const { data: emp } = await admin
      .from('nhan_vien')
      .select('ma_nv, ho_ten, khoa_phong')
      .eq('ma_nv', maNv)
      .eq('khoa_phong', khoa)
      .single();

    if (!emp) {
      return NextResponse.json({ error: 'Nhân viên không thuộc khoa của bạn hoặc không tồn tại.' }, { status: 403 });
    }

    const today = getTodayVN();
    const { startUTC, endUTC } = getVNDayRangeUTC(today);

    const { data: existingMarker } = await admin
      .from('first_day_ra_truc_markers')
      .select('id')
      .eq('ma_nv', maNv)
      .maybeSingle();

    if (existingMarker) {
      return NextResponse.json({ error: 'Chức năng ra trực ngày đầu đã được dùng cho nhân viên này.' }, { status: 409 });
    }

    const [{ data: actualIn }, { data: activeLeave }, { data: restLeave }, { data: existingNb }] = await Promise.all([
      admin
        .from('lich_su_cham_cong')
        .select('id')
        .eq('ma_nv', maNv)
        .in('loai_ca', ['IN_LAM', 'IN_TRUC'])
        .gte('thoi_gian', startUTC)
        .lte('thoi_gian', endUTC)
        .limit(1),
      admin
        .from('don_nghi_phep')
        .select('id')
        .eq('ma_nv', maNv)
        .lte('tu_ngay', today)
        .gte('den_ngay', today)
        .limit(1),
      admin
        .from('lich_nghi_bu')
        .select('id')
        .eq('ma_nv', maNv)
        .eq('ngay_nghi', today)
        .limit(1),
      admin
        .from('lich_su_cham_cong')
        .select('id')
        .eq('ma_nv', maNv)
        .eq('loai_ca', 'NGHI_BU')
        .gte('thoi_gian', startUTC)
        .lte('thoi_gian', endUTC)
        .limit(1),
    ]);

    if ((actualIn?.length ?? 0) > 0 || (activeLeave?.length ?? 0) > 0 || (restLeave?.length ?? 0) > 0 || (existingNb?.length ?? 0) > 0) {
      return NextResponse.json({ error: 'Nhân viên đã có dữ liệu hôm nay, không thể dùng ra trực ngày đầu.' }, { status: 409 });
    }

    const { data: marker, error: markerError } = await admin
      .from('first_day_ra_truc_markers')
      .insert({
        ma_nv: maNv,
        ho_ten: emp.ho_ten,
        ma_khoa: khoa,
        ngay_ap_dung: today,
        ghi_chu: reason,
        created_by: managerEmail,
        is_test: body.is_test ?? maNv.startsWith('NV_TEST_'),
      })
      .select('id')
      .single();

    if (markerError) throw markerError;

    const { data: dmKhoa } = await admin
      .from('dm_khoa_phong')
      .select('ten_khoa')
      .eq('ma_khoa', khoa)
      .single();

    const note = `[FIRST-DAY-RA-TRUC] Bởi ${managerEmail}: ${reason}`;
    const { data: attendanceRecord, error: attendanceError } = await admin
      .from('lich_su_cham_cong')
      .insert({
        ma_nv: maNv,
        ho_ten: emp.ho_ten,
        khoa_ghi_nhan: dmKhoa?.ten_khoa || khoa,
        loai_ca: 'NGHI_BU',
        thoi_gian: `${today}T01:30:00.000Z`,
        ghi_chu: note,
        is_suspicious: false,
        is_test: body.is_test ?? maNv.startsWith('NV_TEST_'),
        ho_tro_boi: managerEmail,
      })
      .select('id')
      .single();

    if (attendanceError) {
      await admin.from('first_day_ra_truc_markers').delete().eq('id', marker.id);
      throw attendanceError;
    }

    await admin
      .from('first_day_ra_truc_markers')
      .update({ attendance_record_id: attendanceRecord.id })
      .eq('id', marker.id);

    return NextResponse.json({ success: true, message: 'Đã ghi nhận ra trực ngày đầu, bảng công sẽ hiển thị NB.' });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Lỗi xử lý ra trực ngày đầu.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
