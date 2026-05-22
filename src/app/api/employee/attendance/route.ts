/**
 * API: /api/employee/attendance
 *
 * GET: Nhân viên tra cứu lịch sử chấm công của chính mình theo tháng.
 *
 * Bảo mật:
 * - Chỉ dùng getAdminClient() (service_role) server-side.
 * - Trình duyệt KHÔNG bao giờ cầm chìa khóa Supabase.
 * - Server kiểm tra mã nhân viên tồn tại trước khi trả dữ liệu.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase';
import { getVNMonthRangeUTC } from '@/lib/timezone';

export async function GET(req: NextRequest) {
  const ma_nv = req.nextUrl.searchParams.get('ma_nv');
  const month = req.nextUrl.searchParams.get('month'); // Định dạng: "YYYY-MM"

  if (!ma_nv || !month) {
    return NextResponse.json({ error: 'Thiếu thông tin bắt buộc (ma_nv, month)' }, { status: 400 });
  }

  // Kiểm tra định dạng tháng hợp lệ (YYYY-MM)
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: 'Định dạng tháng không hợp lệ, cần dạng YYYY-MM' }, { status: 400 });
  }

  const admin = getAdminClient();

  // Bước 1: Xác minh nhân viên có tồn tại và đang hoạt động không
  // (Chặn trường hợp ai đó đoán mã NV của người khác)
  const { data: emp, error: empError } = await admin
    .from('nhan_vien')
    .select('ma_nv, ho_ten, trang_thai')
    .eq('ma_nv', ma_nv)
    .eq('trang_thai', true) // Chỉ cho phép nhân viên đang hoạt động
    .single();

  if (empError || !emp) {
    return NextResponse.json({ error: 'Mã nhân viên không hợp lệ hoặc đã ngừng hoạt động' }, { status: 404 });
  }

  // Bước 2: Tính toán khoảng thời gian của tháng cần tra cứu (theo múi giờ VN GMT+7)
  const { startUTC: firstDay, endUTC: lastDay } = getVNMonthRangeUTC(month);

  // Bước 3: Lấy dữ liệu chấm công — server dùng chìa khóa Chủ, trình duyệt không biết
  const { data: records, error: recordsError } = await admin
    .from('lich_su_cham_cong')
    // Lấy thêm in_record_id để client xác định cặp IN-OUT hoàn chỉnh
    .select('id, thoi_gian, loai_ca, ghi_chu, in_record_id')
    .eq('ma_nv', ma_nv)
    // Không lọc is_test - nhân viên được xem lịch sử của chính mình (kể cả tài khoản test)
    .gte('thoi_gian', firstDay)
    .lte('thoi_gian', lastDay)
    .order('thoi_gian', { ascending: true });


  if (recordsError) {
    return NextResponse.json({ error: 'Lỗi máy chủ khi lấy dữ liệu' }, { status: 500 });
  }

  // Lấy thêm lịch nghỉ bù dự kiến
  const [y, m] = month.split('-');
  const paddedMonth = m.padStart(2, '0');
  const monthPrefix = `${y}-${paddedMonth}`;
  
  const { data: restLeaves } = await admin
    .from('lich_nghi_bu')
    .select('id, ngay_nghi')
    .eq('ma_nv', ma_nv)
    .like('ngay_nghi', `${monthPrefix}%`);

  const combinedRecords = [...(records ?? [])];

  if (restLeaves) {
    for (const rest of restLeaves) {
      combinedRecords.push({
        id: rest.id,
        thoi_gian: `${rest.ngay_nghi}T00:00:00.000Z`,
        loai_ca: 'NGHI_BU',
        ghi_chu: '[HỆ THỐNG] Nghỉ bù sau trực',
        in_record_id: null
      });
    }
  }

  return NextResponse.json({
    ho_ten: emp.ho_ten,
    ma_nv: emp.ma_nv,
    month,
    records: combinedRecords,
  });
}
