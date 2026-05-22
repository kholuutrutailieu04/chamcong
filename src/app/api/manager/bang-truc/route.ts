import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase';
import { normalizeShiftType } from '@/lib/shift';
import { requireManager } from '@/lib/auth';

function escapeLike(value: string): string {
  return value.replace(/[%_]/g, (m) => `\\${m}`);
}

export async function GET(req: NextRequest) {
  const session = await requireManager();
  if (!session) return NextResponse.json({ error: 'Không có quyền truy cập.' }, { status: 401 });

  // Lấy khoa từ session token
  const khoa = session.ma_khoa as string;
  const thang = req.nextUrl.searchParams.get('thang');

  if (!khoa || !thang) {
    return NextResponse.json({ error: 'Thiếu mã khoa hoặc tháng.' }, { status: 400 });
  }

  const admin = getAdminClient();
  const { data: employees, error: empErr } = await admin
    .from('nhan_vien')
    .select('ma_nv, ho_ten, loai_truc_mac_dinh, ma_co_so_mac_dinh, so_dien_thoai')
    .eq('khoa_phong', khoa)
    .not('trang_thai', 'is', false)
    .order('ho_ten');

  if (empErr) return NextResponse.json({ error: empErr.message }, { status: 500 });

  const { data: assignments, error: assignErr } = await admin
    .from('bang_truc_noi_bo')
    .select('ma_nv, loai_ca, ghi_chu, nguoi_phan_cong, updated_at')
    .eq('ma_khoa', khoa)
    .eq('thang', thang);

  if (assignErr) return NextResponse.json({ error: assignErr.message }, { status: 500 });

  const assignMap = new Map(assignments?.map((a) => [a.ma_nv, a]) ?? []);
  const result = (employees ?? []).map((emp) => ({
    ma_nv: emp.ma_nv,
    ho_ten: emp.ho_ten,
    loai_truc_mac_dinh: emp.loai_truc_mac_dinh,
    ma_co_so_mac_dinh: emp.ma_co_so_mac_dinh,
    so_dien_thoai: emp.so_dien_thoai,
    loai_ca_phan_cong: normalizeShiftType(assignMap.get(emp.ma_nv)?.loai_ca ?? null),
    ghi_chu: assignMap.get(emp.ma_nv)?.ghi_chu ?? null,
    nguoi_phan_cong: assignMap.get(emp.ma_nv)?.nguoi_phan_cong ?? null,
    updated_at: assignMap.get(emp.ma_nv)?.updated_at ?? null,
  }));

  return NextResponse.json(result);
}

export async function POST(req: NextRequest) {
  const session = await requireManager();
  if (!session) return NextResponse.json({ error: 'Không có quyền truy cập.' }, { status: 401 });

  const admin = getAdminClient();

  try {
    const { thang, ma_nv, ho_ten, loai_ca, ghi_chu } = await req.json();
    // Lấy khoa và email từ session token
    const khoa = session.ma_khoa as string;
    const nguoi_phan_cong = session.email as string;
    if (!khoa || !thang || !ma_nv || !loai_ca) {
      return NextResponse.json({ error: 'Thiếu thông tin bắt buộc.' }, { status: 400 });
    }

    const normalizedShift = normalizeShiftType(loai_ca) ?? loai_ca;

    // VALIDATION: Kiểm tra quyền xếp ca của Khoa
    const { data: khoaData } = await admin
      .from('dm_khoa_phong')
      .select('cho_phep_hanh_chinh, cho_phep_12_24, cho_phep_16_24, cho_phep_24_24, cho_phep_3ca4kip')
      .eq('ma_khoa', khoa)
      .single();

    if (khoaData) {
      const allowed = [];
      if (khoaData.cho_phep_hanh_chinh) allowed.push('HANH_CHINH');
      if (khoaData.cho_phep_12_24) allowed.push('TRUC_12_24');
      if (khoaData.cho_phep_16_24) allowed.push('TRUC_16_24');
      if (khoaData.cho_phep_24_24) allowed.push('TRUC_24_24');
      if (khoaData.cho_phep_3ca4kip) allowed.push('3CA_4KIP');
      
      if (!allowed.includes(normalizedShift)) {
        return NextResponse.json({ error: `Khoa ${khoa} không được phép xếp ca ${normalizedShift}.` }, { status: 403 });
      }
    }

    const { error } = await admin
      .from('bang_truc_noi_bo')
      .upsert(
        {
          ma_nv,
          ho_ten,
          ma_khoa: khoa,
          thang,
          loai_ca: normalizedShift,
          ghi_chu: ghi_chu ?? null,
          nguoi_phan_cong: nguoi_phan_cong ?? null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'ma_nv,ma_khoa,thang' },
      );

    if (error) throw error;
    return NextResponse.json({ success: true, message: `Đã phân công ${normalizedShift} cho ${ma_nv} tháng ${thang}.` });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Lỗi server.';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const session = await requireManager();
  if (!session) return NextResponse.json({ error: 'Không có quyền truy cập.' }, { status: 401 });

  const admin = getAdminClient();

  try {
    const { thang, ma_nv } = await req.json();
    // Lấy khoa từ session token
    const khoa = session.ma_khoa as string;
    if (!khoa || !thang || !ma_nv) {
      return NextResponse.json({ error: 'Thiếu thông tin.' }, { status: 400 });
    }

    const { error } = await admin
      .from('bang_truc_noi_bo')
      .delete()
      .eq('ma_nv', ma_nv)
      .eq('ma_khoa', khoa)
      .eq('thang', thang);

    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Lỗi server.';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
