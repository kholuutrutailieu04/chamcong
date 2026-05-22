import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase';
import { requireManager } from '@/lib/auth';

function escapeLike(value: string): string {
  return value.replace(/[%_]/g, (m) => `\\${m}`);
}

/**
 * GET /api/manager/employees?khoa=KSS&is_test=false
 */
export async function GET(req: NextRequest) {
  const session = await requireManager();
  if (!session) return NextResponse.json({ error: 'Không có quyền truy cập.' }, { status: 401 });

  // Lấy khoa từ session (token), không tin vào query string
  const khoa = session.ma_khoa as string;
  const isTestManager = (session.is_test_account as boolean | undefined) ?? false;

  if (!khoa) return NextResponse.json({ error: 'Thiếu mã khoa trong session.' }, { status: 400 });

  const admin = getAdminClient();

  let query = admin
    .from('nhan_vien')
    .select('ma_nv, ho_ten, loai_truc_mac_dinh, ma_co_so_mac_dinh, trang_thai, so_dien_thoai, khoa_phong')
    .eq('khoa_phong', khoa)
    .not('trang_thai', 'is', false)
    .order('ho_ten');

  if (isTestManager) {
    query = query.like('ma_nv', 'NV_TEST_%');
  } else {
    query = query.not('ma_nv', 'like', 'NV_TEST_%');
  }

  const { data, error } = await query;

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

/**
 * PATCH /api/manager/employees
 *
 * Trưởng khoa chỉ được sửa ho_ten và so_dien_thoai của nhân viên trong khoa.
 */
export async function PATCH(req: NextRequest) {
  const session = await requireManager();
  if (!session) return NextResponse.json({ error: 'Không có quyền truy cập.' }, { status: 401 });

  const admin = getAdminClient();

  try {
    const body = (await req.json()) as {
      ma_nv: string;
      ho_ten: string;
      so_dien_thoai: string;
    };

    const { ma_nv, ho_ten, so_dien_thoai } = body;
    // Lấy khoa từ session token, không nhận từ body
    const khoa = session.ma_khoa as string;
    const nguoi_sua = session.email as string;

    if (!ma_nv || !ho_ten?.trim() || !khoa || !nguoi_sua) {
      return NextResponse.json({ error: 'Thiếu dữ liệu bắt buộc.' }, { status: 400 });
    }

    // Xác nhận nhân viên thuộc khoa
    const { data: emp } = await admin
      .from('nhan_vien')
      .select('ma_nv, ho_ten, khoa_phong')
      .eq('ma_nv', ma_nv)
      .eq('khoa_phong', khoa)
      .single();

    if (!emp) {
      return NextResponse.json(
        { error: 'Nhân viên không thuộc khoa của bạn hoặc không tồn tại.' },
        { status: 403 },
      );
    }

    // Chỉ cho phép sửa ho_ten và so_dien_thoai
    const { error: updateError } = await admin
      .from('nhan_vien')
      .update({
        ho_ten: ho_ten.trim(),
        so_dien_thoai: so_dien_thoai?.trim() || null,
      })
      .eq('ma_nv', ma_nv);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: `Đã cập nhật: ${ho_ten.trim()} (${ma_nv}) bởi ${nguoi_sua}.`,
    });
  } catch {
    return NextResponse.json({ error: 'Lỗi máy chủ.' }, { status: 500 });
  }
}

