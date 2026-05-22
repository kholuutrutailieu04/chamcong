import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase';
import { requireManager } from '@/lib/auth';

// Lấy danh sách nhân viên chưa Checkout trong 48h tại khoa
export async function GET(req: NextRequest) {
  const session = await requireManager();
  if (!session) return NextResponse.json({ error: 'Không có quyền truy cập.' }, { status: 401 });

  // Lấy khoa từ session token
  const khoa = session.ma_khoa as string;
  if (!khoa) {
    return NextResponse.json({ error: 'Thiếu mã khoa' }, { status: 400 });
  }

  const admin = getAdminClient();
  const past48h = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

  // Tìm các ca IN chưa có OUT (Trong 48h)
  const { data: records, error } = await admin
    .from('lich_su_cham_cong')
    .select('id, ma_nv, ho_ten, loai_ca, thoi_gian')
    .in('loai_ca', ['IN_LAM', 'IN_TRUC'])
    .eq('khoa_ghi_nhan', khoa)
    .gte('thoi_gian', past48h)
    .order('thoi_gian', { ascending: false });

  if (error || !records) {
    return NextResponse.json({ error: 'Lỗi truy vấn.' }, { status: 500 });
  }

  // Lấy các ca OUT
  const inIds = records.map(r => r.id);
  const { data: outRecords } = await admin
    .from('lich_su_cham_cong')
    .select('in_record_id')
    .in('in_record_id', inIds);

  const outRecordSet = new Set(outRecords?.map(o => o.in_record_id) || []);

  const pendingRecords = records.filter(r => !outRecordSet.has(r.id));

  return NextResponse.json(pendingRecords);
}

// Trưởng khoa Check-out hộ
export async function POST(req: NextRequest) {
  const session = await requireManager();
  if (!session) return NextResponse.json({ error: 'Không có quyền truy cập.' }, { status: 401 });

  const admin = getAdminClient();
  
  try {
    const { in_id, ma_nv, ho_ten } = await req.json();
    // Lấy khoa từ session token
    const khoa_ghi_nhan = session.ma_khoa as string;

    if (!in_id || !ma_nv) {
       return NextResponse.json({ error: 'Thiếu thông tin' }, { status: 400 });
    }

    const { error } = await admin.from('lich_su_cham_cong').insert({
        ma_nv,
        ho_ten,
        khoa_ghi_nhan,
        loai_ca: 'OUT',
        thoi_gian: new Date().toISOString(),
        in_record_id: in_id,
        ghi_chu: '[TRƯỞNG KHOA] Xác nhận Check-out hộ'
    });

    if (error) throw error;
    
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: 'Lỗi khi Checkout hộ' }, { status: 500 });
  }
}
