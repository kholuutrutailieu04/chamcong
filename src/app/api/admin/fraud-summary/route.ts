/**
 * GET /api/admin/fraud-summary?period=week|month|quarter
 *
 * Trả về dữ liệu sổ đen từ bảng log_gian_lan,
 * gộp theo nhân viên và danh sách loại lỗi, không đếm số lần.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase';
import { addDaysToVNDate, getTodayVN, getVNDateTimeUTC } from '@/lib/timezone';

export async function GET(req: NextRequest) {
  const admin = getAdminClient();
  const period = req.nextUrl.searchParams.get('period') ?? 'month';

  try {
    const todayVN = getTodayVN();
    let fromDateVN: string;
    if (period === 'week') {
      fromDateVN = addDaysToVNDate(todayVN, -6);
    } else if (period === 'quarter') {
      fromDateVN = addDaysToVNDate(todayVN, -89);
    } else {
      fromDateVN = `${todayVN.slice(0, 7)}-01`;
    }
    const fromUTC = getVNDateTimeUTC(fromDateVN, '00:00:00');

    const { data: logs, error } = await admin
      .from('log_gian_lan')
      .select('ma_nv_bi_ho, ho_ten_bi_ho, khoa_bi_ho, loai_gian_lan, thoi_gian')
      .gte('thoi_gian', fromUTC)
      .eq('is_test', false)
      .order('thoi_gian', { ascending: false });

    if (error) throw error;

    // Gộp theo nhân viên
    const map: Record<string, {
      ma_nv: string;
      ho_ten: string;
      khoa: string;
      loi_vi_pham: Set<string>;
      latestTime: string;
    }> = {};

    for (const log of logs ?? []) {
      const key = log.ma_nv_bi_ho ?? 'UNKNOWN';
      if (!map[key]) {
        map[key] = {
          ma_nv: log.ma_nv_bi_ho ?? '',
          ho_ten: log.ho_ten_bi_ho ?? '',
          khoa: log.khoa_bi_ho ?? '',
          loi_vi_pham: new Set(),
          latestTime: log.thoi_gian ?? '',
        };
      }
      if (log.loai_gian_lan) map[key].loi_vi_pham.add(log.loai_gian_lan);
      if (log.thoi_gian && log.thoi_gian > map[key].latestTime) map[key].latestTime = log.thoi_gian;
    }

    const resultWithLatest = Object.values(map).map(item => ({
      ma_nv: item.ma_nv,
      ho_ten: item.ho_ten,
      khoa: item.khoa,
      loi_vi_pham: Array.from(item.loi_vi_pham).join(', '),
      latestTime: item.latestTime,
    })).sort((a, b) => b.latestTime.localeCompare(a.latestTime));

    const result = resultWithLatest.map((item) => ({
      ma_nv: item.ma_nv,
      ho_ten: item.ho_ten,
      khoa: item.khoa,
      loi_vi_pham: item.loi_vi_pham,
    }));

    return NextResponse.json(result);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Lỗi máy chủ';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
