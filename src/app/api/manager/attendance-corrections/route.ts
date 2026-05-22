import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase';
import { buildCorrectionNote, isInAttendanceType } from '@/lib/attendance-correction';
import { requireManager } from '@/lib/auth';

type ManagerCorrectionBody = {
  record_id: string;
  target_type: 'IN_LAM' | 'IN_TRUC';
  reason: string;
};

/**
 * Thời lượng tối thiểu của từng loại ca (giờ).
 * Dùng để tính: nếu (thoi_gian_hien_tai - thoi_gian_check_in) < min_shift_hours
 * thì nhân viên vẫn đang trong ca trực -> KHÔNG hiển thị.
 */
const SHIFT_MIN_HOURS: Record<string, number> = {
  TRUC_24_24: 22,   // Ca 24/24 - chỉ hiện khi đã vượt 22h
  TRUC_16_24: 14,   // Ca 16/24 - chỉ hiện khi đã vượt 14h
  TRUC_12_24: 10,   // Ca 12/24 - chỉ hiện khi đã vượt 10h
  '3CA_4KIP': 7,    // Ca 3 kíp  - chỉ hiện khi đã vượt 7h
  HANH_CHINH: 7,    // Hành chính - chỉ hiện khi đã vượt 7h
};

function getVNDateBoundaries() {
  // Tính ngày hôm nay và hôm qua theo giờ Việt Nam (UTC+7)
  const nowUTC = Date.now();
  const offsetMs = 7 * 60 * 60 * 1000;
  const nowVN = new Date(nowUTC + offsetMs);

  // Đầu ngày hôm nay (giờ VN)
  const todayVNMidnight = new Date(nowVN);
  todayVNMidnight.setUTCHours(0, 0, 0, 0);
  const todayStartUTC = new Date(todayVNMidnight.getTime() - offsetMs);

  // Đầu ngày hôm qua (giờ VN)
  const yesterdayStartUTC = new Date(todayStartUTC.getTime() - 24 * 60 * 60 * 1000);

  return {
    todayStartUTC: todayStartUTC.toISOString(),
    yesterdayStartUTC: yesterdayStartUTC.toISOString(),
    nowISO: new Date(nowUTC).toISOString(),
  };
}

export async function GET(req: NextRequest) {
  const session = await requireManager();
  if (!session) return NextResponse.json({ error: 'Không có quyền truy cập.' }, { status: 401 });

  // Lấy khoa và is_test từ session token
  const khoa = session.ma_khoa as string;
  const isTestManager = (session.is_test_account as boolean | undefined) ?? false;

  if (!khoa) {
    return NextResponse.json({ error: 'Thiếu mã khoa.' }, { status: 400 });
  }

  const admin = getAdminClient();

  // Lấy tên khoa từ dm_khoa_phong
  const { data: dmKhoa } = await admin
    .from('dm_khoa_phong')
    .select('ten_khoa')
    .eq('ma_khoa', khoa)
    .single();
  const tenKhoa = dmKhoa?.ten_khoa || khoa;

  const { yesterdayStartUTC } = getVNDateBoundaries();
  // 48h từ hiện tại, nhưng không vượt quá đầu ngày hôm qua
  const from48hAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  // Lấy bản ghi từ đầu ngày hôm qua hoặc 48h trước, lấy cái nào muộn hơn
  const fromTime = yesterdayStartUTC > from48hAgo ? yesterdayStartUTC : from48hAgo;

  // 1. Lấy tất cả bản ghi IN_LAM/IN_TRUC trong khoảng thời gian
  const { data: inRecords, error } = await admin
    .from('lich_su_cham_cong')
    .select('id, ma_nv, ho_ten, khoa_ghi_nhan, loai_ca, thoi_gian, ghi_chu')
    .eq('khoa_ghi_nhan', tenKhoa)
    .in('loai_ca', ['IN_LAM', 'IN_TRUC'])
    .gte('thoi_gian', fromTime)
    .order('thoi_gian', { ascending: false })
    .limit(100);

  if (error) {
    return NextResponse.json({ error: 'Không lấy được danh sách cần sửa.' }, { status: 500 });
  }

  if (!inRecords || inRecords.length === 0) {
    return NextResponse.json([]);
  }

  // 2. Cách ly TEST/REAL
  const filtered = inRecords.filter(r => {
    if (isTestManager) return r.ma_nv?.startsWith('NV_TEST_');
    return !r.ma_nv?.startsWith('NV_TEST_');
  });

  // 3. Lấy tất cả bản ghi OUT tương ứng để kiểm tra ai đã checkout
  const inIds = filtered.map(r => r.id);
  const { data: outRecords } = inIds.length > 0
    ? await admin
        .from('lich_su_cham_cong')
        .select('in_record_id')
        .in('in_record_id', inIds)
        .eq('loai_ca', 'OUT')
    : { data: [] };

  const checkedOutSet = new Set((outRecords ?? []).map(o => o.in_record_id));

  // 4. Lấy loại trực của từng nhân viên để tính thời gian ca
  const maNvList = [...new Set(filtered.map(r => r.ma_nv).filter(Boolean))];
  const { data: empList } = maNvList.length > 0
    ? await admin
        .from('nhan_vien')
        .select('ma_nv, loai_truc_mac_dinh')
        .in('ma_nv', maNvList as string[])
    : { data: [] };

  const empShiftMap = new Map<string, string>(
    (empList ?? []).map(e => [e.ma_nv, e.loai_truc_mac_dinh ?? 'HANH_CHINH'])
  );

  const { todayStartUTC } = getVNDateBoundaries();
  const nowMs = Date.now();

  // 5. Lọc: chỉ lấy người chưa checkout VÀ đã vượt khoảng thời gian ca hợp lệ
  const result = filtered
    .filter(record => {
      // Chưa checkout
      if (checkedOutSet.has(record.id)) return false;

      // Kiểm tra xem còn trong khoảng thời gian ca trực không
      if (!record.thoi_gian) return true;
      const checkinMs = new Date(record.thoi_gian).getTime();
      const elapsedHours = (nowMs - checkinMs) / (1000 * 60 * 60);
      const shiftType = empShiftMap.get(record.ma_nv ?? '') ?? 'HANH_CHINH';
      const minHours = SHIFT_MIN_HOURS[shiftType] ?? 7;

      // Chỉ hiện nếu đã quá thời gian tối thiểu của ca
      return elapsedHours >= minHours;
    })
    .map(record => ({
      ...record,
      group: record.thoi_gian && record.thoi_gian >= todayStartUTC ? 'today' : 'yesterday',
    }));

  return NextResponse.json(result);
}

export async function POST(req: NextRequest) {
  const session = await requireManager();
  if (!session) return NextResponse.json({ error: 'Không có quyền truy cập.' }, { status: 401 });

  const admin = getAdminClient();

  try {
    const body = (await req.json()) as ManagerCorrectionBody;
    const recordId = body.record_id?.trim();
    // Lấy khoa và nguoi_sua từ session token
    const khoa = session.ma_khoa as string;
    const nguoiSua = session.email as string;
    const reason = body.reason?.trim();

    if (!recordId || !khoa || !nguoiSua || !reason || !isInAttendanceType(body.target_type)) {
      return NextResponse.json({ error: 'Thiếu dữ liệu sửa nhầm hoặc target_type không hợp lệ.' }, { status: 400 });
    }

    const { data: record } = await admin
      .from('lich_su_cham_cong')
      .select('id, ma_nv, ho_ten, khoa_ghi_nhan, loai_ca, thoi_gian, ghi_chu, is_test')
      .eq('id', recordId)
      .single();

    if (!record) {
      return NextResponse.json({ error: 'Không tìm thấy bản ghi cần sửa.' }, { status: 404 });
    }

    // Lấy tên khoa từ dm_khoa_phong
    const { data: dmKhoa } = await admin
      .from('dm_khoa_phong')
      .select('ten_khoa')
      .eq('ma_khoa', khoa)
      .single();
    const tenKhoa = dmKhoa?.ten_khoa || khoa;

    if (record.khoa_ghi_nhan !== tenKhoa) {
      return NextResponse.json({ error: 'Bạn không có quyền sửa bản ghi ngoài khoa của mình.' }, { status: 403 });
    }

    if (!isInAttendanceType(record.loai_ca)) {
      return NextResponse.json({ error: 'Chỉ hỗ trợ sửa giữa IN_LAM và IN_TRUC.' }, { status: 400 });
    }

    if (record.loai_ca === body.target_type) {
      return NextResponse.json({ success: true, message: 'Dữ liệu đã đúng loại, không cần sửa.' });
    }

    const note = buildCorrectionNote({
      scope: 'MANAGER',
      fromType: record.loai_ca,
      toType: body.target_type,
      reason,
      actor: nguoiSua,
    });
    const mergedNote = record.ghi_chu ? `${record.ghi_chu} | ${note}` : note;

    const { error: updateError } = await admin
      .from('lich_su_cham_cong')
      .update({ loai_ca: body.target_type, ghi_chu: mergedNote })
      .eq('id', recordId);

    if (updateError) throw updateError;

    try {
      await admin.from('lich_su_sua_nham_cham_cong').insert({
        record_id: record.id,
        ma_nv: record.ma_nv,
        ho_ten: record.ho_ten,
        khoa_ghi_nhan: record.khoa_ghi_nhan,
        loai_ca_cu: record.loai_ca,
        loai_ca_moi: body.target_type,
        thoi_gian_goc: record.thoi_gian,
        pham_vi_sua: 'MANAGER',
        ly_do: reason,
        nguoi_sua: nguoiSua,
        is_test: record.is_test ?? false,
      });
    } catch {}

    return NextResponse.json({
      success: true,
      message: 'Quản lý đã sửa nhầm thành công và giữ nguyên giờ check-in gốc.',
    });
  } catch {
    return NextResponse.json({ error: 'Lỗi máy chủ.' }, { status: 500 });
  }
}
