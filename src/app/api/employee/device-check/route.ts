/**
 * POST /api/employee/device-check
 *
 * Kiểm tra xem device_id có hợp lệ với ma_nv hay không.
 * Logic:
 *   - Nếu device_id chưa tồn tại trong DB -> Yêu cầu OTP (máy mới hoàn toàn)
 *   - Nếu device_id đã tồn tại VÀ thuộc đúng ma_nv -> Hợp lệ, không cần OTP
 *   - Nếu device_id đã tồn tại NHƯNG thuộc ma_nv khác -> Gian lận dùng chung máy
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase';

export async function POST(req: NextRequest) {
  const admin = getAdminClient();

  try {
    const { ma_nv, device_id } = await req.json() as { ma_nv: string; device_id: string };

    if (!ma_nv || !device_id) {
      return NextResponse.json({ error: 'Thiếu ma_nv hoặc device_id' }, { status: 400 });
    }

    // Kiểm tra nhân viên tồn tại
    const { data: emp } = await admin
      .from('nhan_vien')
      .select('ma_nv, ho_ten, email')
      .eq('ma_nv', ma_nv)
      .single();

    if (!emp) {
      return NextResponse.json({ error: 'Mã nhân viên không tồn tại.' }, { status: 404 });
    }

    // Kiểm tra device_id đã từng được đăng ký bởi ai chưa
    const { data: deviceRecords } = await admin
      .from('thiet_bi_nhan_vien')
      .select('ma_nv, is_active')
      .eq('device_id', device_id);

    const ownDeviceRecord = deviceRecords?.find(d => d.ma_nv === ma_nv && d.is_active);
    const otherOwnerRecord = deviceRecords?.find(d => d.ma_nv !== ma_nv);

    if (ownDeviceRecord) {
      // Máy đã được đăng ký bởi chính nhân viên này -> Cho đăng nhập luôn
      return NextResponse.json({
        status: 'TRUSTED',
        has_email: !!emp.email,
        message: 'Thiết bị đã được xác minh.',
      });
    }

    if (otherOwnerRecord) {
      // Máy đã thuộc về người khác -> Gian lận tiềm năng
      // Vẫn cho đăng nhập nhưng đánh dấu cần ghi log
      return NextResponse.json({
        status: 'SHARED_DEVICE_FRAUD',
        has_email: !!emp.email,
        other_ma_nv: otherOwnerRecord.ma_nv,
        message: 'Thiết bị này đã được đăng ký bởi nhân viên khác.',
      });
    }

    // Máy chưa từng được đăng ký -> Yêu cầu OTP
    return NextResponse.json({
      status: 'NEW_DEVICE',
      has_email: !!emp.email,
      message: 'Thiết bị mới, cần xác minh qua Email.',
    });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Lỗi máy chủ';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
