import { NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase';

function generateOtp(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export async function POST() {
  const admin = getAdminClient();

  try {
    const masterOtp = generateOtp();
    const expireAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 phút

    await admin.from('cau_hinh_he_thong').upsert(
      {
        key: 'MASTER_OTP',
        value: masterOtp,
        mo_ta: `Mã OTP Khẩn Cấp dùng chung | Hết hạn: ${expireAt}`,
        kieu_du_lieu: 'OTP_MASTER',
        trang_thai: true,
      },
      { onConflict: 'key' }
    );

    return NextResponse.json({
      success: true,
      otp: masterOtp,
      message: 'Mã OTP Khẩn Cấp đã được tạo thành công.',
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Lỗi máy chủ';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
