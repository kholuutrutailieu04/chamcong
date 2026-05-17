/**
 * POST /api/employee/verify-otp
 *
 * Xác thực mã OTP do nhân viên nhập.
 * Nếu hợp lệ: Lưu thiết bị vào bảng thiet_bi_nhan_vien và xóa OTP tạm.
 * Nếu sai/hết hạn: Trả về lỗi.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase';

export async function POST(req: NextRequest) {
  const admin = getAdminClient();

  try {
    const { ma_nv, device_id, otp, ten_thiet_bi } = await req.json() as {
      ma_nv: string;
      device_id: string;
      otp: string;
      ten_thiet_bi?: string;
    };

    if (!ma_nv || !device_id || !otp) {
      return NextResponse.json({ error: 'Thiếu thông tin bắt buộc.' }, { status: 400 });
    }

    const otpKey = `OTP_${ma_nv}_${device_id}`;

    // Lấy OTP đã lưu
    const { data: otpRecord } = await admin
      .from('cau_hinh_he_thong')
      .select('value, mo_ta')
      .eq('key', otpKey)
      .single();

    if (!otpRecord) {
      return NextResponse.json({ error: 'Mã OTP không tồn tại hoặc đã hết hạn. Vui lòng yêu cầu mã mới.' }, { status: 400 });
    }

    // Kiểm tra hết hạn từ mo_ta
    const expireMatch = otpRecord.mo_ta?.match(/Hết hạn: (.+)/);
    if (expireMatch) {
      const expireAt = new Date(expireMatch[1]);
      if (new Date() > expireAt) {
        // Xóa OTP hết hạn
        await admin.from('cau_hinh_he_thong').delete().eq('key', otpKey);
        return NextResponse.json({ error: 'Mã OTP đã hết hạn (10 phút). Vui lòng yêu cầu mã mới.' }, { status: 400 });
      }
    }

    // So sánh OTP
    if (otpRecord.value !== otp.trim()) {
      return NextResponse.json({ error: 'Mã OTP không đúng.' }, { status: 400 });
    }

    // OTP hợp lệ: Lấy IP của request
    const ip = req.headers.get('x-forwarded-for') ?? req.headers.get('x-real-ip') ?? null;

    // Lấy thông tin NV để ghi log
    const { data: emp } = await admin
      .from('nhan_vien')
      .select('ho_ten, khoa_phong')
      .eq('ma_nv', ma_nv)
      .single();

    const empName = emp?.ho_ten ?? ma_nv;
    const empKhoa = emp?.khoa_phong ?? 'KhongXacDinh';

    // Lấy danh sách thiết bị của nhân viên
    const { data: userDevices } = await admin
      .from('thiet_bi_nhan_vien')
      .select('id, device_id, ngay_dang_ky, is_active')
      .eq('ma_nv', ma_nv)
      .order('ngay_dang_ky', { ascending: true });

    const activeDevices = (userDevices || []).filter((d) => d.is_active);

    // Kế hoạch vô hiệu hóa nếu >= 2
    if (activeDevices.length >= 2) {
      // Vô hiệu hóa thiết bị cũ nhất (hoặc nhiều hơn nếu đã có > 2)
      const toDeactivate = activeDevices.slice(0, activeDevices.length - 1);
      const toDeactivateIds = toDeactivate.map((d) => d.id);
      
      await admin
        .from('thiet_bi_nhan_vien')
        .update({ is_active: false })
        .in('id', toDeactivateIds);

      // Ghi log gian lận: Vượt quota
      await admin.from('log_gian_lan').insert({
        ma_nv_bi_ho: ma_nv,
        ho_ten_bi_ho: empName,
        khoa_bi_ho: empKhoa,
        loai_gian_lan: 'VUOT_QUOTA_THIET_BI',
        id_thiet_bi: device_id,
        ghi_chu: `Vượt quá 2 thiết bị. Đã vô hiệu hóa thiết bị cũ: ${toDeactivate.map(d => d.device_id).join(', ')}`,
      });
    }

    // Đếm tần suất đăng ký trong 30 ngày
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const recentDevices = (userDevices || []).filter((d) => d.ngay_dang_ky && d.ngay_dang_ky >= thirtyDaysAgo);
    
    // Nếu thiết bị này đã có mặt trong db (upsert), ta trừ đi chính nó khi đếm
    const isNewDevice = !userDevices?.some(d => d.device_id === device_id);
    const recentCount = recentDevices.length + (isNewDevice ? 1 : 0);

    if (recentCount > 3) {
      // Ghi log gian lận: Đổi thiết bị liên tục
      await admin.from('log_gian_lan').insert({
        ma_nv_bi_ho: ma_nv,
        ho_ten_bi_ho: empName,
        khoa_bi_ho: empKhoa,
        loai_gian_lan: 'DOI_THIET_BI_LIEN_TUC',
        id_thiet_bi: device_id,
        ghi_chu: `Đăng ký thiết bị ${recentCount} lần trong 30 ngày qua.`,
      });
    }

    // Đăng ký/Cập nhật thiết bị hiện tại vào bảng thiet_bi_nhan_vien
    await admin.from('thiet_bi_nhan_vien').upsert(
      {
        ma_nv,
        device_id,
        ten_thiet_bi: ten_thiet_bi ?? null,
        ip_gan_nhat: ip,
        ngay_dang_ky: new Date().toISOString(),
        is_active: true,
      },
      { onConflict: 'ma_nv,device_id' }
    );

    // Xóa OTP tạm khỏi DB
    await admin.from('cau_hinh_he_thong').delete().eq('key', otpKey);

    return NextResponse.json({
      success: true,
      message: 'Xác thực thành công. Thiết bị đã được đăng ký.',
    });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Lỗi máy chủ';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
