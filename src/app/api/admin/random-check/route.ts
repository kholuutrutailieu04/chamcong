import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase';
import { v4 as uuidv4 } from 'uuid';
import { Database } from '@/lib/database.types';
import { normalizeShiftType } from '@/lib/shift';
import { getTodayVN, getVNHour } from '@/lib/timezone';

/**
 * POST /api/admin/random-check/init
 * Khởi tạo phiên kiểm tra cho danh sách mã NV
 */
export async function POST(req: NextRequest) {
  const admin = getAdminClient();
  try {
    const { employeeIds } = await req.json();
    if (!employeeIds || !Array.isArray(employeeIds)) {
      return NextResponse.json({ error: 'Danh sách mã nhân viên không hợp lệ' }, { status: 400 });
    }

    const results: Database['public']['Tables']['kiem_tra_dot_xuat']['Row'][] = [];
    const today = getTodayVN();

    for (const ma_nv of employeeIds) {
      // 1. Tra cứu thông tin NV
      const { data: emp } = await admin
        .from('nhan_vien')
        .select('ho_ten, khoa_phong, ma_co_so_mac_dinh, loai_truc_mac_dinh')
        .eq('ma_nv', ma_nv.trim())
        .single();

      if (!emp) continue;

      // 2. Tra cứu luân chuyển hiện tại
      const { data: rotation } = await admin
        .from('lich_luan_chuyen')
        .select('khoa_den, ma_co_so_dich, loai_truc_moi')
        .eq('ma_nv', ma_nv.trim())
        .lte('tu_ngay', today)
        .or(`den_ngay.is.null,den_ngay.gte.${today}`)
        .order('tu_ngay', { ascending: false })
        .limit(1)
        .single();

      const khoa_hien_tai = rotation?.khoa_den || emp.khoa_phong;
      const co_so_hien_tai = rotation?.ma_co_so_dich || emp.ma_co_so_mac_dinh || 'CS1';
      const loai_truc = normalizeShiftType(rotation?.loai_truc_moi || emp.loai_truc_mac_dinh);

      // 3. Xác định trạng thái dự kiến (đơn giản hóa)
      let trang_thai_du_kien = `Loại hình: ${loai_truc ?? 'CHUA_CAU_HINH'}`;
      const hour = getVNHour();
      if (loai_truc === 'HANH_CHINH') {
        if (hour >= 7 && hour < 17) trang_thai_du_kien += ' (Trong giờ HC)';
        else trang_thai_du_kien += ' (Ngoài giờ HC)';
      }

      // 4. Tạo token và lưu bảng tạm
      const token = uuidv4();
      const { data: session, error } = await admin.from('kiem_tra_dot_xuat').insert({
        token,
        ma_nv: ma_nv.trim(),
        ho_ten: emp.ho_ten,
        khoa_hien_tai,
        co_so_hien_tai,
        trang_thai_du_kien,
        thoi_gian_gui: new Date().toISOString()
      }).select().single();

      if (!error) {
        results.push(session);
      }
    }

    return NextResponse.json(results);
  } catch {
    return NextResponse.json({ error: 'Lỗi hệ thống' }, { status: 500 });
  }
}

/**
 * DELETE /api/admin/random-check/cleanup
 * Xóa sạch bảng kiểm tra đột xuất
 */
export async function DELETE() {
  const admin = getAdminClient();
  try {
    const { error } = await admin.from('kiem_tra_dot_xuat').delete().neq('id', '00000000-0000-0000-0000-000000000000'); // Xóa tất cả
    if (error) throw error;
    return NextResponse.json({ success: true, message: 'Đã xóa toàn bộ dữ liệu kiểm tra đột xuất.' });
  } catch {
    return NextResponse.json({ error: 'Không thể dọn dẹp dữ liệu' }, { status: 500 });
  }
}

/**
 * GET /api/admin/random-check/results
 * Lấy danh sách kết quả hiện tại cho Admin
 */
export async function GET() {
  const admin = getAdminClient();
  const { data, error } = await admin.from('kiem_tra_dot_xuat').select('*').order('created_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
