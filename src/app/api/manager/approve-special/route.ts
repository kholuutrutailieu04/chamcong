import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase';
import { requireManager } from '@/lib/auth';

export async function POST(req: NextRequest) {
  const session = await requireManager();
  if (!session) return NextResponse.json({ error: 'Không có quyền truy cập.' }, { status: 401 });

  try {
    const { action, recordId, reason } = await req.json();
    // Lấy email và khoa từ session token
    const managerEmail = session.email as string;
    const managerKhoa = session.ma_khoa as string;

    if (!recordId || !action || !managerEmail) {
      return NextResponse.json({ error: 'Thiếu thông tin bắt buộc' }, { status: 400 });
    }

    if (action === 'REJECT' && (!reason || reason.trim() === '')) {
      return NextResponse.json({ error: 'Bắt buộc phải nhập lý do từ chối' }, { status: 400 });
    }

    const admin = getAdminClient();

    // Verify record belongs to manager's khoa (from session, not from client)
    const { data: record, error: recordErr } = await admin
      .from('lich_su_cham_cong')
      .select('ghi_chu, khoa_ghi_nhan')
      .eq('id', recordId)
      .single();

    if (recordErr || !record) {
      return NextResponse.json({ error: 'Không tìm thấy bản ghi chấm công' }, { status: 404 });
    }

    if (record.khoa_ghi_nhan !== managerKhoa) {
      return NextResponse.json({ error: 'Không thể duyệt bản ghi của Khoa khác' }, { status: 403 });
    }

    // Remove existing [TC_*] tags if any, to avoid duplicate or mixed states
    let currentNotes = record.ghi_chu || '';
    currentNotes = currentNotes.replace(/\[TC_APPROVED\]/g, '').replace(/\[TC_REJECTED:[^\]]*\]/g, '').trim();

    let newTag = '';
    if (action === 'APPROVE') {
      newTag = '[TC_APPROVED]';
    } else if (action === 'REJECT') {
      const safeReason = reason.replace(/[\[\]]/g, ''); // Loại bỏ ngoặc vuông trong lý do để tránh lỗi parse
      newTag = `[TC_REJECTED:${safeReason}]`;
    } else {
      return NextResponse.json({ error: 'Hành động không hợp lệ' }, { status: 400 });
    }

    const newGhiChu = currentNotes ? `${currentNotes} ${newTag}` : newTag;

    const { error: updateErr } = await admin
      .from('lich_su_cham_cong')
      .update({ ghi_chu: newGhiChu })
      .eq('id', recordId);

    if (updateErr) throw updateErr;

    return NextResponse.json({ success: true, message: action === 'APPROVE' ? 'Đã duyệt' : 'Đã từ chối' });
  } catch (error: unknown) {
    console.error('Approve Special Error:', error);
    return NextResponse.json({ error: 'Lỗi server' }, { status: 500 });
  }
}
