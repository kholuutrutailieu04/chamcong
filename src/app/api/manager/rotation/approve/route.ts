import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase';
import { requireManager } from '@/lib/auth';

type RpcErrorLike = {
  code?: string;
  message?: string;
  hint?: string | null;
};

function getRotationRpcErrorMessage(error: RpcErrorLike) {
  if (error.code === 'PGRST203') {
    return 'RPC luân chuyển bị trùng chữ ký trong Supabase. Vui lòng chạy database/process-rotation-timeline-manager-rpc.sql.';
  }

  if (error.code === 'PGRST202') {
    return 'Thiếu RPC process_rotation_timeline_manager. Vui lòng chạy database/process-rotation-timeline-manager-rpc.sql.';
  }

  return error.message || error.hint || 'RPC process_rotation_timeline_manager thất bại.';
}

// Lấy danh sách các lệnh cần Khoa xác nhận
export async function GET() {
  const session = await requireManager();
  if (!session) return NextResponse.json({ error: 'Không có quyền truy cập.' }, { status: 401 });

  // Lấy khoa từ session token
  const khoa = session.ma_khoa as string;
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
  const session = await requireManager();
  if (!session) return NextResponse.json({ error: 'Không có quyền truy cập.' }, { status: 401 });

  const admin = getAdminClient();
  
  try {
    const { request_id } = await req.json();
    // Lấy email từ session token
    const nguoi_duyet = session.email as string;

    if (!request_id || !nguoi_duyet) {
      return NextResponse.json({ error: 'Thiếu thông tin bắt buộc' }, { status: 400 });
    }

    // 1. Lấy thông tin request
    const { data: request } = await admin.from('yeu_cau_quan_tri').select('*').eq('id', request_id).single();
    if (!request) return NextResponse.json({ error: 'Yêu cầu không tồn tại' }, { status: 404 });
    
    // Nếu yêu cầu đã được duyệt bởi khoa khác từ trước
    if (request.trang_thai === 'APPROVED') {
      return NextResponse.json({ success: true, message: 'Yêu cầu đã được phê duyệt bởi khoa khác.' });
    }
    if (request.trang_thai !== 'PENDING') {
      return NextResponse.json({ error: 'Yêu cầu đã được xử lý bởi người khác.' }, { status: 400 });
    }
    if (!request.ma_khoa_dich) return NextResponse.json({ error: 'Yêu cầu thiếu mã khoa đích.' }, { status: 400 });

    // 2. Gọi RPC wrapper để tránh lỗi PostgREST chọn nhầm overload process_rotation_timeline.
    const { error: rpcErr } = await admin.rpc('process_rotation_timeline_manager', {
      p_ma_nv:      request.ma_nv,
      p_khoa_dich:  request.ma_khoa_dich,
      p_tu_ngay:    request.tu_ngay,
      p_den_ngay:   request.den_ngay || null,
      p_co_so_dich: request.ma_co_so_dich || null  // Tham số cơ sở mới
    });

    if (rpcErr) {
      throw new Error(getRotationRpcErrorMessage(rpcErr));
    }

    // 3. Chuyển trạng thái sang APPROVED sau khi RPC thành công
    const { error: updateErr } = await admin
      .from('yeu_cau_quan_tri')
      .update({ 
        trang_thai: 'APPROVED', 
        nguoi_duyet, 
        ngay_duyet: new Date().toISOString() 
      })
      .eq('id', request_id);

    if (updateErr) throw updateErr;

    // TODO: Gửi Broadcast PubSub bằng Websocket để ẩn dòng này trên máy người kia
    // await supabase.channel('rotation-channel').send({ type: 'broadcast', event: 'APPROVED', payload: { id: request_id } })

    return NextResponse.json({ success: true, message: 'Đã phê duyệt và đồng bộ dữ liệu.' });
  } catch (err: unknown) {
    console.error(err);
    const message = err instanceof Error ? err.message : 'Lỗi đồng bộ vào hệ thống.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
