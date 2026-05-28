import { SupabaseClient } from '@supabase/supabase-js';
import { Database } from './database.types';
import { getVNDayRangeUTC, toVNDateString } from './timezone';

export async function calculateAndRecordRest(
  admin: SupabaseClient<Database>,
  emp_id: string,
  shift_code: string | null,
  checkout_time_iso: string,
  khoa_ghi_nhan: string | null
) {
  if (!shift_code) return;

  const checkoutDate = new Date(checkout_time_iso);
  const checkoutVNDateStr = toVNDateString(checkoutDate);
  const { startUTC: checkoutStartUTC, endUTC: checkoutEndUTC } = getVNDayRangeUTC(checkoutVNDateStr);

  const [{ data: firstDayMarker }, { data: firstDayNbRecord }] = await Promise.all([
    admin
      .from('first_day_ra_truc_markers')
      .select('id')
      .eq('ma_nv', emp_id)
      .eq('ngay_ap_dung', checkoutVNDateStr)
      .maybeSingle(),
    admin
      .from('lich_su_cham_cong')
      .select('id')
      .eq('ma_nv', emp_id)
      .eq('loai_ca', 'NGHI_BU')
      .gte('thoi_gian', checkoutStartUTC)
      .lte('thoi_gian', checkoutEndUTC)
      .ilike('ghi_chu', '%[FIRST-DAY-RA-TRUC]%')
      .limit(1),
  ]);

  if (firstDayMarker || (firstDayNbRecord?.length ?? 0) > 0) {
    return;
  }

  // 1. Get shift config
  const { data: shiftConfig } = await admin
    .from('cau_hinh_ca_truc')
    .select('thoi_gian_nghi_toi_thieu_h, co_nghi_bu')
    .eq('ma_ca', shift_code)
    .single();

  if (!shiftConfig || !shiftConfig.co_nghi_bu || !shiftConfig.thoi_gian_nghi_toi_thieu_h) {
    return;
  }

  // 2. Calculate next day for rest (based on checkout time + some minimum hours, or simply the next calendar day)
  // According to logic: if checkout is on Day X, rest is on Day X (if checkout early morning) or X+1.
  // We can add `thoi_gian_nghi_toi_thieu_h` to checkout_time.
  const restStartTime = new Date(checkoutDate.getTime() + shiftConfig.thoi_gian_nghi_toi_thieu_h * 60 * 60 * 1000);
  
  // Format as YYYY-MM-DD in Vietnam Time
  const vnTime = new Date(restStartTime.getTime() + 7 * 60 * 60 * 1000);
  const restDayStr = vnTime.toISOString().split('T')[0];

  // 3. Check and insert into lich_nghi_bu
  const { data: existing } = await admin
    .from('lich_nghi_bu')
    .select('id')
    .eq('ma_nv', emp_id)
    .eq('ngay_nghi', restDayStr);

  if (!existing || existing.length === 0) {
    await admin.from('lich_nghi_bu').insert({
      ma_nv: emp_id,
      ngay_nghi: restDayStr,
      khoa_phong: khoa_ghi_nhan,
      created_at: new Date().toISOString()
    });
  }
}
