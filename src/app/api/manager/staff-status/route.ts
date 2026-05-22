import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase';
import { getTodayVN, getVNDayRangeUTC } from '@/lib/timezone';
import { requireManager } from '@/lib/auth';

type ActualAttendanceStatus = {
  id: string;
  ma_nv: string | null;
  loai_ca: string | null;
  thoi_gian: string | null;
  ho_tro_boi: string | null;
};

type LeavePlanStatus = {
  id: string;
  ma_nv: string;
  loai_nghi: string;
  tu_ngay: string;
  den_ngay: string;
};

function escapeLike(value: string): string {
  return value.replace(/[%_]/g, (m) => `\\${m}`);
}

export async function GET(req: NextRequest) {
  const session = await requireManager();
  if (!session) return NextResponse.json({ error: 'Không có quyền truy cập.' }, { status: 401 });

  // Lấy khoa và is_test từ session token
  const khoa = session.ma_khoa as string;
  const isTestManager = (session.is_test_account as boolean | undefined) ?? false;

  if (!khoa) return NextResponse.json({ error: 'Thiếu mã khoa' }, { status: 400 });

  const admin = getAdminClient();

  // 2. Fetch employees
  let empQuery = admin
    .from('nhan_vien')
    .select('ma_nv, ho_ten, loai_truc_mac_dinh, ma_co_so_mac_dinh, trang_thai, so_dien_thoai, khoa_phong')
    .eq('khoa_phong', khoa)
    .not('trang_thai', 'is', false)
    .order('ho_ten');

  if (isTestManager) {
    empQuery = empQuery.like('ma_nv', 'NV_TEST_%');
  } else {
    empQuery = empQuery.not('ma_nv', 'like', 'NV_TEST_%');
  }

  const { data: employees, error: empError } = await empQuery;
  if (empError || !employees) {
    return NextResponse.json({ error: empError?.message || 'Lỗi lấy danh sách nhân viên' }, { status: 500 });
  }

  const empIds = employees.map(e => e.ma_nv);
  if (empIds.length === 0) return NextResponse.json([]);

  // 3. Fetch ACTUAL check-ins for today (theo VN timezone GMT+7)
  const todayDateStr = getTodayVN(); // YYYY-MM-DD theo múi giờ VN
  const { startUTC: todayStartUTC, endUTC: todayEndUTC } = getVNDayRangeUTC(todayDateStr);

  // We look for the FIRST IN_LAM or IN_TRUC of the day
  const { data: actuals } = await admin
    .from('lich_su_cham_cong')
    .select('id, ma_nv, loai_ca, thoi_gian, ho_tro_boi')
    .in('ma_nv', empIds)
    .in('loai_ca', ['IN_LAM', 'IN_TRUC'])
    .gte('thoi_gian', todayStartUTC)
    .lte('thoi_gian', todayEndUTC)
    .order('thoi_gian', { ascending: true });

  // Map to get the first valid IN per employee
  const actualMap = new Map<string, ActualAttendanceStatus>();
  if (actuals) {
    for (const record of actuals) {
      if (record.ma_nv && !actualMap.has(record.ma_nv)) {
        actualMap.set(record.ma_nv, record);
      }
    }
  }

  // 4. Fetch PLAN (Leaves) for today

  const { data: plans } = await admin
    .from('don_nghi_phep')
    .select('id, ma_nv, loai_nghi, tu_ngay, den_ngay')
    .in('ma_nv', empIds)
    .lte('tu_ngay', todayDateStr)
    .gte('den_ngay', todayDateStr);

  const planMap = new Map<string, LeavePlanStatus>();
  if (plans) {
    for (const plan of plans) {
      if (plan.ma_nv) planMap.set(plan.ma_nv, plan);
    }
  }

  // 4.5 Fetch Nghỉ bù cho hôm nay
  const { data: restLeaves } = await admin
    .from('lich_nghi_bu')
    .select('ma_nv')
    .in('ma_nv', empIds)
    .eq('ngay_nghi', todayDateStr);

  const restSet = new Set(restLeaves?.map(r => r.ma_nv) || []);

  // 5. Combine using "Actual overrides Plan"
  const staffStatus = employees.map(emp => {
    const actual = actualMap.get(emp.ma_nv);
    const plan = planMap.get(emp.ma_nv);
    const isResting = restSet.has(emp.ma_nv);

    return {
      ...emp,
      status: {
        has_actual: !!actual,
        actual_data: actual || null,
        has_plan: !!plan || isResting,
        plan_data: plan || null,
        display_state: actual ? 'ACTUAL' : ((plan || isResting) ? 'PLAN' : 'NONE'),
        display_type: actual ? actual.loai_ca : (plan ? plan.loai_nghi : (isResting ? 'NGHI_BU' : null)),
        is_resting: isResting
      }
    };
  });

  return NextResponse.json(staffStatus);
}
