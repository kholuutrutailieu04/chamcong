import { NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase';
import { MASTER_OTP_KEY, buildMasterOtpDescription, deleteExpiredMasterOtp } from '@/lib/master-otp';
import { requireAdmin } from '@/lib/auth';

function generateOtp(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export async function POST() {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: 'Không có quyền truy cập.' }, { status: 401 });

  const admin = getAdminClient();

  try {
    await deleteExpiredMasterOtp(admin);

    const masterOtp = generateOtp();
    const expireAt = new Date(Date.now() + 10 * 60 * 1000); // 10 phút

    await admin.from('cau_hinh_he_thong').upsert(
      {
        key: MASTER_OTP_KEY,
        value: masterOtp,
        mo_ta: buildMasterOtpDescription(expireAt),
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
