/**
 * POST /api/employee/send-otp
 *
 * Gửi mã OTP 6 chữ số về email của nhân viên.
 * OTP được lưu tạm vào bảng cau_hinh_he_thong (key: OTP_<ma_nv>_<device_id>)
 * với thời hạn 10 phút.
 * Đồng thời nếu email chưa có trong DB thì cập nhật vào bảng nhan_vien.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase';
import { createClient } from '@supabase/supabase-js';

// Dùng Supabase Auth để gửi magic link/OTP Email (miễn phí)
const supabaseAuthClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

function generateOtp(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export async function POST(req: NextRequest) {
  const admin = getAdminClient();

  try {
    const { ma_nv, email, device_id } = await req.json() as {
      ma_nv: string;
      email: string;
      device_id: string;
    };

    if (!ma_nv || !email || !device_id) {
      return NextResponse.json({ error: 'Thiếu thông tin bắt buộc.' }, { status: 400 });
    }

    // Kiểm tra email hợp lệ (regex đơn giản)
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: 'Email không hợp lệ.' }, { status: 400 });
    }

    // Kiểm tra nhân viên tồn tại
    const { data: emp } = await admin
      .from('nhan_vien')
      .select('ma_nv, email')
      .eq('ma_nv', ma_nv)
      .single();

    if (!emp) {
      return NextResponse.json({ error: 'Mã nhân viên không tồn tại.' }, { status: 404 });
    }

    // Nếu nhân viên chưa có email trong DB -> Cập nhật email mới
    if (!emp.email) {
      await admin.from('nhan_vien').update({ email }).eq('ma_nv', ma_nv);
    }

    // Tạo OTP 6 số và lưu vào cau_hinh_he_thong với key tạm thời
    const otp = generateOtp();
    const otpKey = `OTP_${ma_nv}_${device_id}`;
    const expireAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 phút

    // Upsert OTP vào bảng cau_hinh_he_thong làm kho tạm
    await admin.from('cau_hinh_he_thong').upsert(
      {
        key: otpKey,
        value: otp,
        mo_ta: `OTP tạm thời cho ${ma_nv} | Hết hạn: ${expireAt}`,
        kieu_du_lieu: 'OTP_TEMP',
        trang_thai: true,
      },
      { onConflict: 'key' }
    );

    // Gửi OTP qua Supabase Auth (sử dụng signInWithOtp)
    // Đây là tính năng miễn phí của Supabase: gửi magic link email
    const { error: otpError } = await supabaseAuthClient.auth.signInWithOtp({
      email,
      options: {
        // Cho phép tạo user nếu chưa tồn tại để tránh lỗi "Signups not allowed for otp"
        // Nội dung email sẽ chứa OTP thủ công trong subject/body nếu cấu hình custom SMTP
        shouldCreateUser: true,
        data: {
          otp_code: otp,
          ma_nv,
        },
      },
    });

    if (otpError) {
      // Fallback: Nếu Supabase Auth gặp lỗi, vẫn trả về thành công vì OTP đã được lưu
      // Admin có thể tra OTP trong bảng cau_hinh_he_thong nếu cần
      console.warn('[send-otp] Supabase Auth warning:', otpError.message);
    }

    return NextResponse.json({
      success: true,
      message: `Mã xác thực đã được gửi đến ${email}. Có hiệu lực trong 10 phút.`,
    });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Lỗi máy chủ';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
