import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase';

// Lấy danh sách các lệnh cần Khoa xác nhận
export async function GET(req: NextRequest) {
  const khoa = req.nextUrl.searchParams.get('khoa');
  if (!khoa) return NextResponse.json({ error: 'Thiếu mã khoa' }, { status: 400 });

  const admin = getAdminClient();

  // Tìm các lệnh PENDING mà khoa_dich hoặc khoa_nguon = khoa
  const { data, error } = await admin
    .from('yeu_cau_quan_tri')
    .select('*')
    .eq('trang_thai', 'PENDING')
    .or(`ma_khoa_nguon.eq.${khoa},ma_khoa_dich.eq.${khoa}`)
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  
  return NextResponse.json(data);
}

// Bấm Duyệt lệnh
export async function POST(req: NextRequest) {
  const admin = getAdminClient();
  
  try {
    const { request_id, nguoi_duyet } = await req.json();

    if (!request_id || !nguoi_duyet) {
      return NextResponse.json({ error: 'Thiếu thông tin bắt buộc' }, { status: 400 });
    }

    // 1. Lấy thông tin request
    const { data: request } = await admin.from('yeu_cau_quan_tri').select('*').eq('id', request_id).single();
    if (!request) return NextResponse.json({ error: 'Yêu cầu không tồn tại' }, { status: 404 });
    if (request.trang_thai !== 'PENDING') return NextResponse.json({ error: 'Yêu cầu đã được xử lý bởi người khác.' }, { status: 400 });
    if (!request.ma_khoa_dich) return NextResponse.json({ error: 'Yêu cầu thiếu mã khoa đích.' }, { status: 400 });

    // 2. Chuyển trạng thái
    const { error: updateErr } = await admin
      .from('yeu_cau_quan_tri')
      .update({ 
        trang_thai: 'APPROVED', 
        nguoi_duyet, 
        ngay_duyet: new Date().toISOString() 
      })
      .eq('id', request_id);

    if (updateErr) throw updateErr;

    // 3. Gọi Hàm Xử Lý Dữ Liệu SQL (Cắt Timeline + Đổi dữ liệu quá khứ & ca treo)
    // process_rotation_timeline(p_ma_nv, p_khoa_dich, p_tu_ngay, p_den_ngay, p_co_so_dich)
    const { error: rpcErr } = await admin.rpc('process_rotation_timeline', {
      p_ma_nv:      request.ma_nv,
      p_khoa_dich:  request.ma_khoa_dich,
      p_tu_ngay:    request.tu_ngay,
      p_den_ngay:   request.den_ngay || null,
      p_co_so_dich: request.ma_co_so_dich || null  // Tham số cơ sở mới
    });

    if (rpcErr) {
      const missingRpc = rpcErr.message?.toLowerCase().includes('process_rotation_timeline');
      if (missingRpc) {
        throw new Error('Thiếu RPC process_rotation_timeline. Vui lòng chạy migration schema mới.');
      }
      throw new Error(rpcErr.message || 'RPC process_rotation_timeline thất bại.');
    }

    // TODO: Gửi Broadcast PubSub bằng Websocket để ẩn dòng này trên máy người kia
    // await supabase.channel('rotation-channel').send({ type: 'broadcast', event: 'APPROVED', payload: { id: request_id } })

    return NextResponse.json({ success: true, message: 'Đã phê duyệt và đồng bộ dữ liệu.' });
  } catch (err: unknown) {
    console.error(err);
    const message = err instanceof Error ? err.message : 'Lỗi đồng bộ vào hệ thống.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
