/**
 * API: /api/geofence
 * Mô tả: Endpoint nhẹ để kiểm tra tọa độ GPS có nằm trong cơ sở bệnh viện không.
 * Tách riêng khỏi /api/attendance để có thể gọi sớm (trước khi mở camera).
 *
 * GET /api/geofence?gps=16.023,108.249
 * Response: { allowed: boolean, campus?: string, message: string }
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase';
import { haversineMeters } from '@/lib/utils';



export async function GET(req: NextRequest) {
  const gps = req.nextUrl.searchParams.get('gps');
  if (!gps) {
    return NextResponse.json({ allowed: false, message: 'Thiếu tọa độ GPS' }, { status: 400 });
  }

  const [latStr, lonStr] = gps.split(',');
  const userLat = parseFloat(latStr);
  const userLon = parseFloat(lonStr);

  if (isNaN(userLat) || isNaN(userLon)) {
    return NextResponse.json({ allowed: false, message: 'Tọa độ GPS không đúng định dạng' }, { status: 400 });
  }

  const admin = getAdminClient();
  const { data: campuses, error } = await admin
    .from('co_so')
    .select('ma_co_so, ten_co_so, latitude, longitude, ban_kinh_met')
    .eq('trang_thai', true);

  if (error || !campuses?.length) {
    return NextResponse.json({ allowed: false, message: 'Không thể đọc cấu hình vị trí từ hệ thống' }, { status: 500 });
  }

  for (const campus of campuses) {
    const distM = haversineMeters(userLat, userLon, campus.latitude, campus.longitude);
    if (distM <= campus.ban_kinh_met) {
      return NextResponse.json({
        allowed: true,
        campus: campus.ma_co_so,
        campus_name: campus.ten_co_so,
        distance_m: Math.round(distM),
        message: `Trong phạm vi ${campus.ten_co_so} (${Math.round(distM)}m)`,
      });
    }
  }

  return NextResponse.json({
    allowed: false,
    message: 'Bạn đang đứng ngoài khuôn viên bệnh viện. Hệ thống không cho phép chấm công từ xa.',
  });
}
