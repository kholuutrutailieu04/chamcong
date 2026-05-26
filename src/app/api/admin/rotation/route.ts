import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase';
import { is3CaShiftType, normalizeShiftType } from '@/lib/shift';
import { requireAdmin } from '@/lib/auth';

type RotationKhoaInfo = {
  cho_phep_12_24: boolean | null;
  cho_phep_16_24: boolean | null;
  cho_phep_24_24: boolean | null;
  cho_phep_3ca4kip: boolean | null;
  cho_phep_hanh_chinh: boolean | null;
};

function isShiftAllowedForKhoa(shiftType: string, khoa: RotationKhoaInfo) {
  return (
    (shiftType === 'TRUC_12_24' && !!khoa.cho_phep_12_24) ||
    (shiftType === 'TRUC_16_24' && !!khoa.cho_phep_16_24) ||
    (shiftType === 'TRUC_24_24' && !!khoa.cho_phep_24_24) ||
    (is3CaShiftType(shiftType) && !!khoa.cho_phep_3ca4kip) ||
    (shiftType === 'HANH_CHINH' && !!khoa.cho_phep_hanh_chinh)
  );
}

function pickFallbackShiftForKhoa(khoa: RotationKhoaInfo) {
  if (khoa.cho_phep_hanh_chinh) return 'HANH_CHINH';
  if (khoa.cho_phep_24_24) return 'TRUC_24_24';
  if (khoa.cho_phep_16_24) return 'TRUC_16_24';
  if (khoa.cho_phep_12_24) return 'TRUC_12_24';
  if (khoa.cho_phep_3ca4kip) return '3CA_4KIP';
  return 'HANH_CHINH';
}

export async function GET(req: NextRequest) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: 'Không có quyền truy cập.' }, { status: 401 });

  // Lấy các lệnh luân chuyển PENDING hoặc APPROVED của tháng
  const status = req.nextUrl.searchParams.get('status');
  const type = req.nextUrl.searchParams.get('type');
  const limit = Number(req.nextUrl.searchParams.get('limit') ?? '0');
  const admin = getAdminClient();

  let query = admin.from('yeu_cau_quan_tri').select('*').order('created_at', { ascending: false });
  if (status) query = query.eq('trang_thai', status);
  if (type) query = query.eq('loai_yeu_cau', type);
  if (Number.isInteger(limit) && limit > 0) query = query.limit(Math.min(limit, 100));

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  
  return NextResponse.json(data);
}

export async function POST(req: NextRequest) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: 'Không có quyền truy cập.' }, { status: 401 });

  const admin = getAdminClient();
  
  try {
    const body = await req.json();
    const { ma_nv, ma_khoa_dich, ma_co_so_dich, tu_ngay, den_ngay } = body;

    if (!ma_nv || !ma_khoa_dich || !tu_ngay) {
      return NextResponse.json({ error: 'Thiếu thông tin bắt buộc' }, { status: 400 });
    }

    // 1. Kiểm tra NV, lấy khoa nguồn + cơ sở nguồn + loại trực hiện tại
    const { data: emp } = await admin
      .from('nhan_vien')
      .select('ho_ten, khoa_phong, ma_co_so_mac_dinh, loai_truc_mac_dinh')
      .eq('ma_nv', ma_nv).single();
    if (!emp) return NextResponse.json({ error: 'Mã nhân viên không tồn tại' }, { status: 404 });

    // 2. Lấy tên khoa nguồn và khoa đích để hiển thị đẹp hơn
    const { data: khoaInfo } = await admin
      .from('dm_khoa_phong')
      .select('ma_khoa, ten_khoa, cho_phep_12_24, cho_phep_16_24, cho_phep_24_24, cho_phep_3ca4kip, cho_phep_hanh_chinh')
      .in('ma_khoa', [emp.khoa_phong, ma_khoa_dich]);

    const khoaNguon = khoaInfo?.find(k => k.ma_khoa === emp.khoa_phong);
    const khoaDich  = khoaInfo?.find(k => k.ma_khoa === ma_khoa_dich);

    // 3. Tự động kiểm tra loại trực có tương thích với khoa mới không
    const loaiTrucCu = normalizeShiftType(emp.loai_truc_mac_dinh) ?? 'HANH_CHINH';
    let loaiTrucCanhBao = false;
    let loaiTrucMoi = loaiTrucCu;
    if (khoaDich) {
      const isIncompatible = !isShiftAllowedForKhoa(loaiTrucCu, khoaDich);
      if (isIncompatible) {
        loaiTrucMoi = pickFallbackShiftForKhoa(khoaDich);
        loaiTrucCanhBao = true;
      }
    }

    // 4. Kiểm tra khóa tháng (Không cho phép tạo lệnh nếu tháng cũ đã khóa)
    const targetDate = new Date(tu_ngay);
    const today = new Date();
    if (targetDate.getMonth() < today.getMonth() && targetDate.getFullYear() <= today.getFullYear() && today.getDate() > 5) {
       return NextResponse.json({ error: 'Quá mùng 5, không thể sửa dữ liệu tháng trước.' }, { status: 403 });
    }

    const coSoNguon = emp.ma_co_so_mac_dinh || 'CS1';
    const coSoDich  = ma_co_so_dich || coSoNguon; // Mặc định cùng cơ sở nếu không chỉ định
    const tenKhoaNguon = khoaNguon?.ten_khoa || emp.khoa_phong;
    const tenKhoaDich  = khoaDich?.ten_khoa  || ma_khoa_dich;
    
    const formatDate = (d: string) => {
      const parts = d.split('-');
      if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
      return d;
    };

    const tuNgayFormatted = formatDate(tu_ngay);
    const denNgayFormatted = den_ngay ? formatDate(den_ngay) : 'Vô thời hạn';
    
    const noi_dung_nguon = `Nhân sự ${emp.ho_ten} (${ma_nv}) được yêu cầu luân chuyển ĐI từ [${tenKhoaNguon} - ${coSoNguon}] sang [${tenKhoaDich} - ${coSoDich}], từ ngày ${tuNgayFormatted} đến ${denNgayFormatted}. Vui lòng xác nhận.`;
    const noi_dung_dich  = `Nhân sự ${emp.ho_ten} (${ma_nv}) được phân công ĐẾN khoa bạn từ [${tenKhoaNguon} - ${coSoNguon}], từ ngày ${tuNgayFormatted} đến ${denNgayFormatted}. Vui lòng xác nhận để bắt đầu chấm công.`;

    const preview = {
      ho_ten: emp.ho_ten,
      ma_nv,
      khoa_nguon: tenKhoaNguon, co_so_nguon: coSoNguon,
      khoa_dich:  tenKhoaDich,  co_so_dich:  coSoDich,
      tu_ngay, den_ngay: den_ngay || 'Vô thời hạn',
      loai_truc_cu: loaiTrucCu,
      loai_truc_moi: loaiTrucMoi,
      canh_bao_loai_truc: loaiTrucCanhBao
    };

    if (body.preview_only) {
      return NextResponse.json({
        success: true,
        message: 'Đã kiểm tra thông tin luân chuyển.',
        preview,
      });
    }

    const requestPayload = {
      loai_yeu_cau: 'LUAN_CHUYEN',
      ma_nv,
      ho_ten: emp.ho_ten,
      ma_khoa_nguon: emp.khoa_phong,
      ma_khoa_dich,
      ma_co_so_nguon: coSoNguon,
      ma_co_so_dich:  coSoDich,
      tu_ngay,
      den_ngay: den_ngay || null,
      noi_dung_nguon,
      noi_dung_dich,
      trang_thai: 'PENDING',
      is_test: ma_nv.startsWith('NV_TEST_')
    };

    const { data: pendingRequest, error: pendingError } = await admin
      .from('yeu_cau_quan_tri')
      .select('id')
      .eq('loai_yeu_cau', 'LUAN_CHUYEN')
      .eq('ma_nv', ma_nv)
      .eq('trang_thai', 'PENDING')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (pendingError) throw pendingError;

    const writeResult = pendingRequest
      ? await admin
          .from('yeu_cau_quan_tri')
          .update(requestPayload)
          .eq('id', pendingRequest.id)
          .select('id')
          .single()
      : await admin
          .from('yeu_cau_quan_tri')
          .insert(requestPayload)
          .select('id')
          .single();

    const { data, error } = writeResult;

    if (error) throw error;

    // Trả về đầy đủ thông tin preview để UI hiển thị "Tab xác nhận"
    return NextResponse.json({
      success: true,
      message: pendingRequest
        ? 'Đã cập nhật yêu cầu đang chờ xác nhận.'
        : 'Đã gửi yêu cầu xác nhận tới các Khoa.',
      id: data.id,
      preview
    });
  } catch {
    return NextResponse.json({ error: 'Lỗi hệ thống' }, { status: 500 });
  }
}
