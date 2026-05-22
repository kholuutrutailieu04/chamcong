import { NextResponse } from 'next/server';
import { requireManager } from '@/lib/auth';
import { getAdminClient } from '@/lib/supabase';

export async function GET() {
  const session = await requireManager();
  if (!session) {
    return NextResponse.json({ error: 'Không có quyền truy cập.' }, { status: 401 });
  }

  const admin = getAdminClient();
  try {
    const { data, error } = await admin
      .from('cau_hinh_he_thong')
      .select('value')
      .eq('key', 'THANG_DA_XAC_NHAN')
      .maybeSingle();

    if (error) throw error;

    return NextResponse.json({ value: data?.value || '' });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Lỗi máy chủ';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
