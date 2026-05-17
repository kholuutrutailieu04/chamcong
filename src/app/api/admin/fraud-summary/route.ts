/**
 * GET /api/admin/fraud-summary?period=week|month|quarter
 *
 * Trả về dữ liệu tổng hợp gian lận từ bảng log_gian_lan,
 * gộp theo nhân viên với số lần vi phạm và danh sách lỗi.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase';

export async function GET(req: NextRequest) {
  const admin = getAdminClient();
  const period = req.nextUrl.searchParams.get('period') ?? 'month';

  try {
    // Tính khoảng thời gian lọc
    const now = new Date();
    let fromDate: Date;
    if (period === 'week') {
      fromDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    } else if (period === 'quarter') {
      fromDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    } else {
      // month (mặc định)
      fromDate = new Date(now.getFullYear(), now.getMonth(), 1);
    }

    const { data: logs, error } = await admin
      .from('log_gian_lan')
      .select('ma_nv_bi_ho, ho_ten_bi_ho, khoa_bi_ho, loai_gian_lan, thoi_gian')
      .gte('thoi_gian', fromDate.toISOString())
      .eq('is_test', false)
      .order('thoi_gian', { ascending: false });

    if (error) throw error;

    // Gộp theo nhân viên
    const map: Record<string, {
      ma_nv: string;
      ho_ten: string;
      khoa: string;
      so_lan: number;
      loi_vi_pham: Set<string>;
    }> = {};

    for (const log of logs ?? []) {
      const key = log.ma_nv_bi_ho ?? 'UNKNOWN';
      if (!map[key]) {
        map[key] = {
          ma_nv: log.ma_nv_bi_ho ?? '',
          ho_ten: log.ho_ten_bi_ho ?? '',
          khoa: log.khoa_bi_ho ?? '',
          so_lan: 0,
          loi_vi_pham: new Set(),
        };
      }
      map[key].so_lan++;
      if (log.loai_gian_lan) map[key].loi_vi_pham.add(log.loai_gian_lan);
    }

    const result = Object.values(map).map(item => ({
      ma_nv: item.ma_nv,
      ho_ten: item.ho_ten,
      khoa: item.khoa,
      so_lan: item.so_lan,
      loi_vi_pham: Array.from(item.loi_vi_pham).join(', '),
    })).sort((a, b) => b.so_lan - a.so_lan);

    return NextResponse.json(result);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Lỗi máy chủ';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
