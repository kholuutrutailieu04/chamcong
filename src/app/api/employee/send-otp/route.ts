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

// Bỏ hàm generateOtp tự tạo mã


export async function POST(req: NextRequest) {
  const admin = getAdminClient();

  try {
    const { ma_nv, email, device_id } = await req.json() as {
      ma_nv: string;
      email?: string;
      device_id: string;
    };
    let targetEmail = email;

    if (!ma_nv || !device_id) {
      return NextResponse.json({ error: 'Thiếu thông tin bắt buộc.' }, { status: 400 });
    }

    // Lấy thông tin nhân viên từ DB
    const { data: emp } = await admin
      .from('nhan_vien')
      .select('ma_nv, email')
      .eq('ma_nv', ma_nv)
      .single();

    if (!emp) {
      return NextResponse.json({ error: 'Mã nhân viên không tồn tại.' }, { status: 404 });
    }

    // Nếu front-end gửi lên email mới (lần đầu), cập nhật db
    if (targetEmail) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(targetEmail)) {
        return NextResponse.json({ error: 'Email không hợp lệ.' }, { status: 400 });
      }
      if (!emp.email || emp.email !== targetEmail) {
        await admin.from('nhan_vien').update({ email: targetEmail }).eq('ma_nv', ma_nv);
      }
    } else {
      // Nếu front-end không gửi email, lấy từ DB
      if (!emp.email) {
        return NextResponse.json({ error: 'Nhân viên chưa có email. Vui lòng đăng ký email.' }, { status: 400 });
      }
      targetEmail = emp.email;
    }

    // Gọi Supabase Auth gửi OTP nguyên bản qua email
    const { error: otpError } = await supabaseAuthClient.auth.signInWithOtp({
      email: targetEmail,
      options: {
        shouldCreateUser: true,
      },
    });

    if (otpError) {
      console.warn('[send-otp] Supabase Auth error:', otpError.message);
      return NextResponse.json({ error: 'Không thể gửi mã xác thực. Lỗi từ Supabase: ' + otpError.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: `Mã xác thực đã được gửi đến ${targetEmail}. Có hiệu lực trong 10 phút.`,
    });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Lỗi máy chủ';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
