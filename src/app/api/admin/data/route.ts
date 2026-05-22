import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase';
import { deleteExpiredMasterOtp } from '@/lib/master-otp';
import { requireAdmin } from '@/lib/auth';

const PAGE_SIZE = 1000;

/**
 * GET /api/admin/data?type=khoas|co_so|configs
 * Dùng AdminClient (bypass RLS) để lấy dữ liệu danh mục cho trang Admin
 */
export async function GET(req: NextRequest) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: 'Không có quyền truy cập.' }, { status: 401 });

  const type = req.nextUrl.searchParams.get('type');
  const admin = getAdminClient();

  try {
    if (type === 'khoas') {
      const { data, error } = await admin
        .from('dm_khoa_phong')
        .select('ma_khoa, ten_khoa, cho_phep_chia_ca_truc, cho_phep_hanh_chinh, cho_phep_12_24, cho_phep_16_24, cho_phep_24_24, cho_phep_3ca4kip')
        .eq('trang_thai', true)
        .order('ten_khoa');
      if (error) throw error;
      return NextResponse.json(data);
    }

    if (type === 'co_so') {
      const { data, error } = await admin
        .from('co_so')
        .select('ma_co_so, ten_co_so')
        .eq('trang_thai', true)
        .order('ten_co_so');
      if (error) throw error;
      return NextResponse.json(data);
    }

    if (type === 'configs') {
      await deleteExpiredMasterOtp(admin);
      const { data, error } = await admin
        .from('cau_hinh_he_thong')
        .select('*')
        .order('key');
      if (error) throw error;
      return NextResponse.json(data);
    }

    if (type === 'employees') {
      const isTestMode = req.nextUrl.searchParams.get('is_test') === 'true';
      const employees = [];

      for (let from = 0; ; from += PAGE_SIZE) {
        let query = admin
          .from('nhan_vien')
          .select('*')
          .order('ho_ten')
          .range(from, from + PAGE_SIZE - 1);

        if (isTestMode) {
          query = query.like('ma_nv', 'NV_TEST_%');
        } else {
          query = query.not('ma_nv', 'like', 'NV_TEST_%');
        }

        const { data, error } = await query;
        if (error) throw error;
        employees.push(...(data ?? []));
        if (!data || data.length < PAGE_SIZE) break;
      }

      return NextResponse.json(employees);
    }

    if (type === 'admin_emails') {
      // Lấy danh sách email admin từ cấu hình hệ thống
      const { data, error } = await admin
        .from('cau_hinh_he_thong')
        .select('value')
        .eq('key', 'ADMIN_EMAILS')
        .single();
      if (error) return NextResponse.json({ emails: [] });
      // value là chuỗi phân cách bằng dấu phẩy: "admin@bv.vn,tccb@bv.vn"
      const emails = (data?.value || '').split(',').map((e: string) => e.trim().toLowerCase()).filter(Boolean);
      return NextResponse.json({ emails });
    }

    return NextResponse.json({ error: 'type không hợp lệ. Dùng: khoas | co_so | configs | admin_emails | employees' }, { status: 400 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Lỗi server';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/**
 * PATCH /api/admin/data?type=configs
 * Cập nhật giá trị cấu hình hệ thống
 */
export async function PATCH(req: NextRequest) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: 'Không có quyền truy cập.' }, { status: 401 });

  const type = req.nextUrl.searchParams.get('type');
  if (type !== 'configs' && type !== 'employees') {
    return NextResponse.json({ error: 'Chỉ hỗ trợ PATCH type=configs hoặc type=employees' }, { status: 400 });
  }

  const admin = getAdminClient();
  try {
    if (type === 'employees') {
      const { id, email, so_dien_thoai } = await req.json();
      if (!id) return NextResponse.json({ error: 'Thiếu ID nhân viên' }, { status: 400 });
      
      const { error } = await admin
        .from('nhan_vien')
        .update({ email, so_dien_thoai })
        .eq('id', id);
        
      if (error) throw error;
      return NextResponse.json({ success: true });
    }

    const { key, value } = await req.json();
    if (!key || value === undefined) {
      return NextResponse.json({ error: 'Thiếu key hoặc value' }, { status: 400 });
    }
    const { error } = await admin
      .from('cau_hinh_he_thong')
      .update({ value: String(value) })
      .eq('key', key);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Lỗi cập nhật';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
