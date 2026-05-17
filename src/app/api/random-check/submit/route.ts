import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase';
import { uploadToDriveWithFolderHierarchy } from '@/lib/drive';

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371e3;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export async function POST(req: NextRequest) {
  const admin = getAdminClient();
  try {
    const { token, lat, lon, imageBase64 } = await req.json();

    if (!token || lat == null || lon == null || !imageBase64) {
      return NextResponse.json({ error: 'Thiếu dữ liệu xác thực' }, { status: 400 });
    }

    const { data: checkRecord } = await admin
      .from('kiem_tra_dot_xuat')
      .select('*')
      .eq('token', token)
      .single();

    if (!checkRecord) return NextResponse.json({ error: 'Mã kiểm tra không hợp lệ hoặc đã hết hạn' }, { status: 404 });
    if (checkRecord.trang_thai === 'COMPLETED') return NextResponse.json({ error: 'Bạn đã hoàn thành kiểm tra này.' }, { status: 400 });
    if (!checkRecord.co_so_hien_tai) return NextResponse.json({ error: 'Thiếu thông tin cơ sở kiểm tra.' }, { status: 400 });

    const { data: coSo } = await admin
      .from('co_so')
      .select('latitude, longitude, ban_kinh_met')
      .eq('ma_co_so', checkRecord.co_so_hien_tai)
      .single();

    let isMatch = false;
    if (coSo) {
      const dist = haversineMeters(lat, lon, coSo.latitude, coSo.longitude);
      if (dist <= coSo.ban_kinh_met) isMatch = true;
    }

    const fileName = `RANDOM_CHECK_${checkRecord.ma_nv}_${Date.now()}.jpg`;
    
    const base64Content = imageBase64.split(';base64,').pop() || imageBase64;
    const imgBuffer = Buffer.from(base64Content, 'base64');
    
    // Đẩy ảnh vào RandomCheck, hoặc gốc thư mục nếu không có folderId
    const linkAnh = await uploadToDriveWithFolderHierarchy(imgBuffer, fileName, 'image/jpeg', 'RandomCheck');

    const { error: updateErr } = await admin
      .from('kiem_tra_dot_xuat')
      .update({
        lat_thuc_te: lat,
        lon_thuc_te: lon,
        link_anh_mat: linkAnh,
        is_match_gps: isMatch,
        thoi_gian_phan_hoi: new Date().toISOString(),
        trang_thai: 'COMPLETED',
      })
      .eq('token', token);

    if (updateErr) throw updateErr;

    return NextResponse.json({ success: true, isMatch });
  } catch (err: unknown) {
    console.error(err);
    return NextResponse.json({ error: 'Lỗi xác thực dữ liệu' }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token');
  if (!token) {
    return NextResponse.json({ error: 'Thiếu token kiểm tra' }, { status: 400 });
  }

  const admin = getAdminClient();
  const { data, error } = await admin
    .from('kiem_tra_dot_xuat')
    .select('ho_ten, ma_nv, trang_thai, khoa_hien_tai')
    .eq('token', token)
    .single();

  if (error) return NextResponse.json({ error: 'Mã không tồn tại' }, { status: 404 });
  return NextResponse.json(data);
}
