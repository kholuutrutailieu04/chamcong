import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase';
import bcrypt from 'bcryptjs';

const DEFAULT_PASSWORD = 'benhvienphusannhidanang1005';

export async function POST(req: NextRequest) {
  try {
    const { email, password } = await req.json();

    if (!email || !password) {
      return NextResponse.json({ error: 'Thiếu email hoặc mật khẩu.' }, { status: 400 });
    }

    const admin = getAdminClient();

    // 1. Tìm email trong bảng dm_khoa_phong_emails
    const { data: emailData, error: emailError } = await admin
      .from('dm_khoa_phong_emails')
      .select('ma_khoa, ho_ten, trang_thai, mat_khau')
      .eq('email', email)
      .eq('trang_thai', true)
      .single();

    if (emailError || !emailData) {
      return NextResponse.json({ error: 'Email không thuộc quyền quản lý của Khoa nào!' }, { status: 404 });
    }

    // 2. Kiểm tra mật khẩu (server-side - client không bao giờ biết kết quả nội bộ)
    let isPasswordValid = false;
    if (!emailData.mat_khau) {
      // Chưa đổi mật khẩu -> so sánh với mặc định (plain text)
      isPasswordValid = password === DEFAULT_PASSWORD;
    } else {
      // Đã đổi mật khẩu -> so sánh với hash bcrypt
      isPasswordValid = await bcrypt.compare(password, emailData.mat_khau);
    }

    if (!isPasswordValid) {
      return NextResponse.json({ error: 'Mật khẩu không đúng.' }, { status: 401 });
    }

    // 3. Xác định tài khoản test
    const is_test_account = email.toLowerCase().startsWith('test_');

    // 4. Lấy cờ cho_phep_chia_ca_truc từ bảng dm_khoa_phong
    let cho_phep_chia_ca_truc = false;
    const allowed_shifts: string[] = [];
    if (emailData.ma_khoa) {
      const { data: khoaData } = await admin
        .from('dm_khoa_phong')
        .select('cho_phep_chia_ca_truc, cho_phep_hanh_chinh, cho_phep_12_24, cho_phep_16_24, cho_phep_24_24, cho_phep_3ca4kip')
        .eq('ma_khoa', emailData.ma_khoa)
        .single();
      if (khoaData) {
        cho_phep_chia_ca_truc = !!khoaData.cho_phep_chia_ca_truc;
        if (khoaData.cho_phep_hanh_chinh) allowed_shifts.push('HANH_CHINH');
        if (khoaData.cho_phep_12_24) allowed_shifts.push('TRUC_12_24');
        if (khoaData.cho_phep_16_24) allowed_shifts.push('TRUC_16_24');
        if (khoaData.cho_phep_24_24) allowed_shifts.push('TRUC_24_24');
        if (khoaData.cho_phep_3ca4kip) allowed_shifts.push('3CA_4KIP');
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        ma_khoa: emailData.ma_khoa,
        ho_ten: emailData.ho_ten,
        cho_phep_chia_ca_truc,
        is_test_account,
        allowed_shifts,
      }
    });

  } catch (error: unknown) {
    console.error('Manager Auth Error:', error);
    return NextResponse.json({ error: 'Lỗi xác thực hệ thống.' }, { status: 500 });
  }
}

/**
 * PATCH /api/manager/auth
 * Đổi mật khẩu cho tài khoản quản lý. Mật khẩu mới sẽ được hash bcrypt trước khi lưu.
 * Body: { email, old_password, new_password }
 */
export async function PATCH(req: NextRequest) {
  try {
    const { email, old_password, new_password } = await req.json();

    if (!email || !old_password || !new_password) {
      return NextResponse.json({ error: 'Thiếu thông tin bắt buộc.' }, { status: 400 });
    }

    if (new_password.length < 8) {
      return NextResponse.json({ error: 'Mật khẩu mới phải có ít nhất 8 ký tự.' }, { status: 400 });
    }

    const admin = getAdminClient();

    const { data: emailData } = await admin
      .from('dm_khoa_phong_emails')
      .select('mat_khau, trang_thai')
      .eq('email', email)
      .eq('trang_thai', true)
      .single();

    if (!emailData) {
      return NextResponse.json({ error: 'Tài khoản không tồn tại.' }, { status: 404 });
    }

    // Kiểm tra mật khẩu cũ
    let isOldPasswordValid = false;
    if (!emailData.mat_khau) {
      isOldPasswordValid = old_password === 'benhvienphusannhidanang1005';
    } else {
      isOldPasswordValid = await bcrypt.compare(old_password, emailData.mat_khau);
    }

    if (!isOldPasswordValid) {
      return NextResponse.json({ error: 'Mật khẩu hiện tại không đúng.' }, { status: 401 });
    }

    // Hash mật khẩu mới với bcrypt (salt rounds = 12)
    const hashedPassword = await bcrypt.hash(new_password, 12);

    const { error: updateError } = await admin
      .from('dm_khoa_phong_emails')
      .update({ mat_khau: hashedPassword })
      .eq('email', email);

    if (updateError) throw updateError;

    return NextResponse.json({ success: true, message: 'Đã đổi mật khẩu thành công.' });

  } catch (error: unknown) {
    console.error('Change Password Error:', error);
    return NextResponse.json({ error: 'Lỗi máy chủ khi đổi mật khẩu.' }, { status: 500 });
  }
}
