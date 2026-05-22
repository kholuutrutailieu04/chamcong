import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase';
import { getCurrentVNMonth, getVNMonthRangeUTC, toVNDateString } from '@/lib/timezone';
import { requireManager } from '@/lib/auth';

export async function GET(req: NextRequest) {
  const session = await requireManager();
  if (!session) return NextResponse.json({ error: 'Không có quyền truy cập.' }, { status: 401 });

  // Lấy khoa từ session token
  const khoa = session.ma_khoa as string;
  let thang = req.nextUrl.searchParams.get('thang');

  if (!khoa) {
    return NextResponse.json({ error: 'Thiếu mã khoa' }, { status: 400 });
  }

  if (!thang) {
    thang = getCurrentVNMonth();
  }

  const { startUTC, endUTC } = getVNMonthRangeUTC(thang);

  const admin = getAdminClient();

  try {
    // 1. Get all NGHI_BU records for this month in this khoa
    const { data: nghiBuRecords, error: err1 } = await admin
      .from('lich_su_cham_cong')
      .select('ma_nv, thoi_gian')
      .eq('loai_ca', 'NGHI_BU')
      .eq('khoa_ghi_nhan', khoa)
      .gte('thoi_gian', startUTC)
      .lte('thoi_gian', endUTC);

    if (err1) throw err1;

    if (!nghiBuRecords || nghiBuRecords.length === 0) {
      return NextResponse.json([]); // No NGHI_BU, so no special shifts possible
    }

    // Build a set of "ma_nv|YYYY-MM-DD" that have NGHI_BU
    const restDays = new Set(
      nghiBuRecords.map((r) => {
        const dateStr = toVNDateString(new Date(r.thoi_gian!));
        return `${r.ma_nv}|${dateStr}`;
      })
    );

    // 2. Get all IN_LAM/IN_TRUC records and OUT records
    const { data: attendanceRecords, error: err2 } = await admin
      .from('lich_su_cham_cong')
      .select('id, ma_nv, ho_ten, thoi_gian, loai_ca, ghi_chu, in_record_id')
      .in('loai_ca', ['IN_LAM', 'IN_TRUC', 'OUT'])
      .eq('khoa_ghi_nhan', khoa)
      .gte('thoi_gian', startUTC)
      .lte('thoi_gian', endUTC);

    if (err2) throw err2;

    const inRecords = attendanceRecords?.filter((r) => r.loai_ca === 'IN_LAM' || r.loai_ca === 'IN_TRUC') || [];
    const outRecords = attendanceRecords?.filter((r) => r.loai_ca === 'OUT') || [];

    const specialRecords = [];

    for (const inRec of inRecords) {
      if (!inRec.ma_nv || !inRec.thoi_gian) continue;
      
      const dateStr = toVNDateString(new Date(inRec.thoi_gian));
      const key = `${inRec.ma_nv}|${dateStr}`;

      // If they checked in on a NGHI_BU day
      if (restDays.has(key)) {
        // Find matching OUT
        const matchingOut = outRecords.find((out) => out.in_record_id === inRec.id);

        let status = 'PENDING';
        let rejectReason = '';
        if (inRec.ghi_chu?.includes('[TC_APPROVED]')) {
          status = 'APPROVED';
        } else if (inRec.ghi_chu?.includes('[TC_REJECTED:')) {
          status = 'REJECTED';
          const match = inRec.ghi_chu.match(/\[TC_REJECTED:(.*?)\]/);
          if (match && match[1]) {
            rejectReason = match[1];
          }
        }

        specialRecords.push({
          id: inRec.id,
          ma_nv: inRec.ma_nv,
          ho_ten: inRec.ho_ten,
          in_time: inRec.thoi_gian,
          out_time: matchingOut ? matchingOut.thoi_gian : null,
          status,
          rejectReason,
        });
      }
    }

    // Sort by IN time descending
    specialRecords.sort((a, b) => new Date(b.in_time).getTime() - new Date(a.in_time).getTime());

    return NextResponse.json(specialRecords);
  } catch (error: unknown) {
    console.error('Special Records Fetch Error:', error);
    return NextResponse.json({ error: 'Lỗi server' }, { status: 500 });
  }
}
