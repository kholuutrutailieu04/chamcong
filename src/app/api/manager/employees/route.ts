import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase';

function escapeLike(value: string): string {
  return value.replace(/[%_]/g, (m) => `\\${m}`);
}

/**
 * GET /api/manager/employees?khoa=KSS&is_test=false
 */
export async function GET(req: NextRequest) {
  const khoa = req.nextUrl.searchParams.get('khoa');
  const isTestManager = req.nextUrl.searchParams.get('is_test') === 'true';

  if (!khoa) return NextResponse.json({ error: 'Thiếu mã khoa' }, { status: 400 });

  const admin = getAdminClient();

  const { data: dmKhoa } = await admin
    .from('dm_khoa_phong')
    .select('ten_khoa')
    .eq('ma_khoa', khoa)
    .single();

  const tenKhoa = (dmKhoa?.ten_khoa || khoa).trim();
  const likePattern = `${escapeLike(tenKhoa)}%`;

  let query = admin
    .from('nhan_vien')
    .select('ma_nv, ho_ten, loai_truc_mac_dinh, ma_co_so_mac_dinh, trang_thai, so_dien_thoai, khoa_phong')
    .or(`khoa_phong.eq.${khoa},khoa_phong.eq.${tenKhoa},khoa_phong.ilike.${likePattern}`)
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
  const admin = getAdminClient();

  try {
    const body = (await req.json()) as {
      ma_nv: string;
      ho_ten: string;
      so_dien_thoai: string;
      khoa: string;       // Mã khoa của manager đang đăng nhập
      nguoi_sua: string;  // Email manager
    };

    const { ma_nv, ho_ten, so_dien_thoai, khoa, nguoi_sua } = body;

    if (!ma_nv || !ho_ten?.trim() || !khoa || !nguoi_sua) {
      return NextResponse.json({ error: 'Thiếu dữ liệu bắt buộc.' }, { status: 400 });
    }

    // Lấy tên khoa để đối chiếu chéo
    const { data: dmKhoa } = await admin
      .from('dm_khoa_phong')
      .select('ten_khoa')
      .eq('ma_khoa', khoa)
      .single();

    const tenKhoa = (dmKhoa?.ten_khoa || khoa).trim();
    const likePattern = `${escapeLike(tenKhoa)}%`;

    // Xác nhận nhân viên thuộc khoa
    const { data: emp } = await admin
      .from('nhan_vien')
      .select('ma_nv, ho_ten, khoa_phong')
      .eq('ma_nv', ma_nv)
      .or(`khoa_phong.eq.${khoa},khoa_phong.eq.${tenKhoa},khoa_phong.ilike.${likePattern}`)
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

