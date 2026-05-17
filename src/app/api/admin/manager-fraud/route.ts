import { NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase';

export async function GET() {
  const admin = getAdminClient();
  try {
    // Lấy 50 lượt check-in tay gần nhất
    const { data: recent, error } = await admin
      .from('lich_su_cham_cong')
      .select('id, ma_nv, ho_ten, khoa:khoa_ghi_nhan, thoi_gian, loai_ca, ho_tro_boi')
      .not('ho_tro_boi', 'is', null)
      .order('thoi_gian', { ascending: false })
      .limit(50);
      
    if (error) throw error;

    // Lấy tổng số lượt hỗ trợ theo từng manager (thống kê đơn giản)
    const { data: allManual } = await admin
      .from('lich_su_cham_cong')
      .select('ho_tro_boi, khoa:khoa_ghi_nhan')
      .not('ho_tro_boi', 'is', null);

    const stats: Record<string, { count: number, khoa: string }> = {};
    if (allManual) {
       for (const record of allManual) {
          const m = record.ho_tro_boi as string;
          if (!stats[m]) stats[m] = { count: 0, khoa: record.khoa || '' };
          stats[m].count++;
       }
    }

    const summary = Object.entries(stats).map(([manager, info]) => ({
      manager,
      khoa: info.khoa,
      count: info.count
    })).sort((a, b) => b.count - a.count);

    return NextResponse.json({ recent: recent || [], summary });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Lỗi máy chủ';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
