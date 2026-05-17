/**
 * POST /api/manager/attendance-corrections/emergency-checkin
 *
 * Trưởng khoa ghi check-in thủ công cho nhân viên gặp sự cố kỹ thuật.
 * Tạo bản ghi IN với ghi chú rõ nguồn gốc.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase';

export async function POST(req: NextRequest) {
  const admin = getAdminClient();

  try {
    const body = (await req.json()) as {
      ma_nv: string;
      ho_ten: string;
      loai_ca: 'IN_LAM' | 'IN_TRUC';
      khoa: string;
      nguoi_ghi: string;
      ly_do: string;
      is_test?: boolean;
    };

    const { ma_nv, ho_ten, loai_ca, khoa, nguoi_ghi, ly_do, is_test } = body;

    if (!ma_nv || !loai_ca || !khoa || !nguoi_ghi || !ly_do) {
      return NextResponse.json({ error: 'Thiếu dữ liệu bắt buộc.' }, { status: 400 });
    }

    if (!['IN_LAM', 'IN_TRUC'].includes(loai_ca)) {
      return NextResponse.json({ error: 'loai_ca không hợp lệ.' }, { status: 400 });
    }

    // Lấy tên khoa
    const { data: dmKhoa } = await admin
      .from('dm_khoa_phong')
      .select('ten_khoa')
      .eq('ma_khoa', khoa)
      .single();
    const tenKhoa = dmKhoa?.ten_khoa || khoa;

    // Kiểm tra nhân viên thuộc khoa
    const { data: emp } = await admin
      .from('nhan_vien')
      .select('ma_nv, ho_ten, khoa_phong')
      .eq('ma_nv', ma_nv)
      .single();

    if (!emp) {
      return NextResponse.json({ error: 'Không tìm thấy nhân viên.' }, { status: 404 });
    }

    // Kiểm tra hôm nay đã có check-in chưa (tránh tạo trùng)
    const todayStart = new Date();
    todayStart.setUTCHours(todayStart.getUTCHours() - 7); // Convert to VN
    todayStart.setHours(0, 0, 0, 0);
    const todayStartUTC = new Date(todayStart.getTime() + 7 * 60 * 60 * 1000).toISOString();
    const todayEndUTC = new Date(todayStart.getTime() + 7 * 60 * 60 * 1000 + 24 * 60 * 60 * 1000 - 1).toISOString();

    const { data: existing } = await admin
      .from('lich_su_cham_cong')
      .select('id')
      .eq('ma_nv', ma_nv)
      .in('loai_ca', ['IN_LAM', 'IN_TRUC'])
      .gte('thoi_gian', todayStartUTC)
      .lte('thoi_gian', todayEndUTC)
      .maybeSingle();

    if (existing) {
      return NextResponse.json(
        { error: 'Nhân viên này đã có check-in hôm nay rồi. Dùng chức năng "Đổi ca" thay thế.' },
        { status: 409 },
      );
    }

    const note = `[EMERGENCY-CHECKIN] Bởi ${nguoi_ghi}: ${ly_do}`;

    const { error: insertError } = await admin.from('lich_su_cham_cong').insert({
      ma_nv,
      ho_ten: ho_ten || emp.ho_ten,
      khoa_ghi_nhan: tenKhoa,
      loai_ca,
      thoi_gian: new Date().toISOString(),
      ghi_chu: note,
      is_test: is_test ?? false,
      ho_tro_boi: nguoi_ghi,
    });

    if (insertError) throw insertError;

    return NextResponse.json({
      success: true,
      message: `Đã ghi check-in khẩn cấp cho ${ho_ten || emp.ho_ten}.`,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Lỗi máy chủ';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
