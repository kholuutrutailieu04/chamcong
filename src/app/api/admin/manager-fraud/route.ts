import { NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase';

const PAGE_SIZE = 1000;

export async function GET() {
  const admin = getAdminClient();
  try {
    // Lấy các lượt check-in tay gần nhất để UI lọc theo manager/khoa đang chọn.
    const { data: recent, error } = await admin
      .from('lich_su_cham_cong')
      .select('id, ma_nv, ho_ten, khoa:khoa_ghi_nhan, thoi_gian, loai_ca, ho_tro_boi')
      .not('ho_tro_boi', 'is', null)
      .order('thoi_gian', { ascending: false })
      .limit(500);
      
    if (error) throw error;

    const allManual: { ho_tro_boi: string | null; khoa: string | null }[] = [];
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error: pageError } = await admin
        .from('lich_su_cham_cong')
        .select('ho_tro_boi, khoa:khoa_ghi_nhan')
        .not('ho_tro_boi', 'is', null)
        .range(from, from + PAGE_SIZE - 1);

      if (pageError) throw pageError;
      allManual.push(...((data ?? []) as { ho_tro_boi: string | null; khoa: string | null }[]));
      if (!data || data.length < PAGE_SIZE) break;
    }

    const stats: Record<string, { count: number, khoa: string }> = {};
    for (const record of allManual) {
      const manager = record.ho_tro_boi?.trim();
      if (!manager) continue;
      const khoa = record.khoa || 'Không rõ';
      const key = `${manager}__${khoa}`;
      if (!stats[key]) stats[key] = { count: 0, khoa };
      stats[key].count++;
    }

    const summary = Object.entries(stats).map(([key, info]) => ({
      key,
      manager: key.split('__')[0],
      khoa: info.khoa,
      count: info.count
    })).sort((a, b) => b.count - a.count);

    return NextResponse.json({ recent: recent || [], summary });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Lỗi máy chủ';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
