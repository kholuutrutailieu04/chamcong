import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase';
import { signToken } from '@/lib/auth';
import { compare } from 'bcryptjs';
import { cookies } from 'next/headers';

export async function POST(req: NextRequest) {
  try {
    const { email, password } = await req.json();
    if (!email || !password) {
      return NextResponse.json({ error: 'Thiếu email hoặc mật khẩu' }, { status: 400 });
    }

    const emailLower = email.trim().toLowerCase();
    
    // Sandbox test accounts bypass DB checks
    if (emailLower.startsWith('test_') && password === 'benhvienphusannhidanang1005') {
      const token = await signToken({ email: emailLower, role: 'ADMIN', khoa: 'TEST' }, '8h');
      const cookieStore = await cookies();
      cookieStore.set('admin_session', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: 8 * 60 * 60
      });
      return NextResponse.json({ success: true });
    }

    const admin = getAdminClient();
    const { data: user, error } = await admin
      .from('dm_khoa_phong_emails')
      .select('email, mat_khau, ma_khoa, role, trang_thai')
      .eq('email', email.trim().toLowerCase())
      .single();

    if (error || !user || !user.trang_thai) {
      // Fallback check if not found in db (legacy support for system admins not in dm_khoa_phong_emails)
      const { data: cfg } = await admin.from('cau_hinh_he_thong').select('value').eq('key', 'ADMIN_EMAILS').single();
      const adminEmails = (cfg?.value || '').split(',').map((e: string) => e.trim().toLowerCase());
      if (adminEmails.includes(email.trim().toLowerCase()) && password === 'benhvienphusannhidanang1005') {
        const token = await signToken({ email: email.trim().toLowerCase(), role: 'ADMIN', khoa: 'TCCB' }, '8h');
        const cookieStore = await cookies();
        cookieStore.set('admin_session', token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax',
          path: '/',
          maxAge: 8 * 60 * 60
        });
        return NextResponse.json({ success: true });
      }
      return NextResponse.json({ error: 'Tài khoản không tồn tại hoặc bị khóa' }, { status: 401 });
    }

    // Role check
    let isAdmin = user.role === 'ADMIN' || user.role === 'TCCB';
    if (!isAdmin) {
       const { data: cfg } = await admin.from('cau_hinh_he_thong').select('value').eq('key', 'ADMIN_EMAILS').single();
       if (cfg?.value?.toLowerCase().includes(email.toLowerCase())) {
         isAdmin = true;
       }
    }

    if (!isAdmin) {
      return NextResponse.json({ error: 'Bạn không có quyền truy cập trang quản trị' }, { status: 403 });
    }

    // Password check
    const isDefault = password === 'benhvienphusannhidanang1005';
    let isValid = false;
    
    if (user.mat_khau) {
      if (user.mat_khau.startsWith('$2a$') || user.mat_khau.startsWith('$2b$')) {
        isValid = await compare(password, user.mat_khau);
      } else {
        isValid = (password === user.mat_khau);
      }
    } else {
      isValid = isDefault;
    }

    if (!isValid && isDefault && (!user.mat_khau || user.mat_khau === '')) {
       isValid = true;
    }

    if (!isValid) {
      return NextResponse.json({ error: 'Mật khẩu không đúng' }, { status: 401 });
    }

    // Sign Token
    const token = await signToken({
      email: user.email,
      role: user.role || 'ADMIN',
      khoa: user.ma_khoa
    }, '8h');

    // Set cookie
    const cookieStore = await cookies();
    cookieStore.set('admin_session', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 8 * 60 * 60 // 8 hours
    });

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    return NextResponse.json({ error: 'Lỗi server' }, { status: 500 });
  }
}
