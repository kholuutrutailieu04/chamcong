import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import {
  addDaysToVNDate,
  getTodayVN,
  getVNDateTimeUTC,
  getVNDayRangeUTC,
  toVNDateString,
} from '@/lib/timezone';

type AdminClient = SupabaseClient<Database>;
type AttendanceRow = Database['public']['Tables']['lich_su_cham_cong']['Row'];

export const AUTO_CLOSE_KEYS = {
  enabled: 'AUTO_CLOSE_OPEN_IN_ENABLED',
  pendingValue: 'AUTO_CLOSE_OPEN_IN_PENDING_VALUE',
  effectiveDate: 'AUTO_CLOSE_OPEN_IN_EFFECTIVE_DATE',
  updatedBy: 'AUTO_CLOSE_OPEN_IN_UPDATED_BY',
  updatedAt: 'AUTO_CLOSE_OPEN_IN_UPDATED_AT',
} as const;

export type AutoCloseConfig = {
  enabled: boolean;
  pendingValue: boolean | null;
  effectiveDate: string | null;
  updatedBy: string | null;
  updatedAt: string | null;
};

type ShiftConfig = {
  ma_ca: string;
  gio_bat_dau: string;
  gio_ket_thuc: string;
  vat_qua_nua_dem: boolean | null;
};

type OpenInRecord = Pick<
  AttendanceRow,
  'id' | 'ma_nv' | 'ho_ten' | 'khoa_ghi_nhan' | 'loai_ca' | 'thoi_gian' | 'ghi_chu' | 'is_test' | 'ma_co_so'
>;

const CONFIG_DESCRIPTIONS: Record<string, { mo_ta: string; kieu_du_lieu: string }> = {
  [AUTO_CLOSE_KEYS.enabled]: {
    mo_ta: 'Tự sinh OUT khi có check-in mới nhưng ca cũ chưa check-out',
    kieu_du_lieu: 'boolean',
  },
  [AUTO_CLOSE_KEYS.pendingValue]: {
    mo_ta: 'Giá trị công tắc tự sinh OUT đang chờ hiệu lực',
    kieu_du_lieu: 'boolean',
  },
  [AUTO_CLOSE_KEYS.effectiveDate]: {
    mo_ta: 'Ngày hiệu lực của thay đổi công tắc tự sinh OUT',
    kieu_du_lieu: 'date',
  },
  [AUTO_CLOSE_KEYS.updatedBy]: {
    mo_ta: 'TCCB cập nhật công tắc tự sinh OUT gần nhất',
    kieu_du_lieu: 'string',
  },
  [AUTO_CLOSE_KEYS.updatedAt]: {
    mo_ta: 'Thời điểm cập nhật công tắc tự sinh OUT gần nhất',
    kieu_du_lieu: 'datetime',
  },
};

function parseBool(value: string | null | undefined, fallback: boolean): boolean {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return fallback;
}

function parsePendingBool(value: string | null | undefined): boolean | null {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return null;
}

export function getAutoCloseEffectiveDateFromToday(todayVN = getTodayVN()): string {
  return addDaysToVNDate(todayVN, 7);
}

export async function getAutoCloseConfig(admin: AdminClient): Promise<AutoCloseConfig> {
  const keys = Object.values(AUTO_CLOSE_KEYS);
  const { data } = await admin
    .from('cau_hinh_he_thong')
    .select('key, value')
    .in('key', keys);

  const values = new Map((data ?? []).map((row) => [row.key, row.value]));

  return {
    enabled: parseBool(values.get(AUTO_CLOSE_KEYS.enabled), true),
    pendingValue: parsePendingBool(values.get(AUTO_CLOSE_KEYS.pendingValue)),
    effectiveDate: values.get(AUTO_CLOSE_KEYS.effectiveDate) || null,
    updatedBy: values.get(AUTO_CLOSE_KEYS.updatedBy) || null,
    updatedAt: values.get(AUTO_CLOSE_KEYS.updatedAt) || null,
  };
}

export async function scheduleAutoCloseConfigChange(
  admin: AdminClient,
  enabled: boolean,
  updatedBy: string,
): Promise<AutoCloseConfig> {
  const effectiveDate = getAutoCloseEffectiveDateFromToday();
  const nowIso = new Date().toISOString();
  const rows = [
    { key: AUTO_CLOSE_KEYS.pendingValue, value: String(enabled) },
    { key: AUTO_CLOSE_KEYS.effectiveDate, value: effectiveDate },
    { key: AUTO_CLOSE_KEYS.updatedBy, value: updatedBy },
    { key: AUTO_CLOSE_KEYS.updatedAt, value: nowIso },
  ].map((row) => ({
    ...row,
    mo_ta: CONFIG_DESCRIPTIONS[row.key].mo_ta,
    kieu_du_lieu: CONFIG_DESCRIPTIONS[row.key].kieu_du_lieu,
    trang_thai: true,
  }));

  const { error } = await admin.from('cau_hinh_he_thong').upsert(rows, { onConflict: 'key' });
  if (error) throw error;
  return getAutoCloseConfig(admin);
}

function parseTimeToMinutes(value: string): number {
  const [hour = '0', minute = '0'] = value.split(':');
  return Number(hour) * 60 + Number(minute);
}

function get3CaChildShiftCode(note: string | null): string | null {
  const match = note?.match(/ca 3 (?:kíp|kip):\s*([\w-]+)/i);
  return match?.[1] ?? null;
}

function resolveShiftCode(record: OpenInRecord, employeeShift?: string | null): string {
  if (record.loai_ca === 'IN_LAM') return 'HANH_CHINH';
  return get3CaChildShiftCode(record.ghi_chu) ?? employeeShift ?? 'HANH_CHINH';
}

function getShiftEndISO(record: OpenInRecord, shift?: ShiftConfig): string | null {
  if (!record.thoi_gian) return null;
  if (!shift) return record.loai_ca === 'IN_LAM' ? getVNDateTimeUTC(toVNDateString(new Date(record.thoi_gian)), '17:00:00') : null;

  const checkinVNDate = toVNDateString(new Date(record.thoi_gian));
  const startMinutes = parseTimeToMinutes(shift.gio_bat_dau);
  const endMinutes = parseTimeToMinutes(shift.gio_ket_thuc);
  const endsNextDay = Boolean(shift.vat_qua_nua_dem) || endMinutes <= startMinutes;
  const endVNDate = endsNextDay ? addDaysToVNDate(checkinVNDate, 1) : checkinVNDate;
  return getVNDateTimeUTC(endVNDate, shift.gio_ket_thuc);
}

function canAutoCloseRecord(params: {
  record: OpenInRecord;
  employeeShift?: string | null;
  shiftMap: Map<string, ShiftConfig>;
  closeAtISO: string;
  excludeOvernight: boolean;
}): { allowed: boolean; shiftEndISO: string | null } {
  const shiftCode = resolveShiftCode(params.record, params.employeeShift);
  const shift = params.shiftMap.get(shiftCode);

  if (params.excludeOvernight && params.record.loai_ca === 'IN_TRUC' && shift?.vat_qua_nua_dem) {
    return { allowed: false, shiftEndISO: null };
  }

  const shiftEndISO = getShiftEndISO(params.record, shift);
  if (!shiftEndISO) return { allowed: false, shiftEndISO: null };
  return { allowed: shiftEndISO <= params.closeAtISO, shiftEndISO };
}

async function fetchEmployeeShiftMap(admin: AdminClient, records: OpenInRecord[]): Promise<Map<string, string | null>> {
  const maNvs = [...new Set(records.map((record) => record.ma_nv).filter(Boolean))] as string[];
  if (maNvs.length === 0) return new Map();

  const { data } = await admin
    .from('nhan_vien')
    .select('ma_nv, loai_truc_mac_dinh')
    .in('ma_nv', maNvs);

  return new Map((data ?? []).map((emp) => [emp.ma_nv, emp.loai_truc_mac_dinh]));
}

async function fetchShiftMap(admin: AdminClient): Promise<Map<string, ShiftConfig>> {
  const { data } = await admin
    .from('cau_hinh_ca_truc')
    .select('ma_ca, gio_bat_dau, gio_ket_thuc, vat_qua_nua_dem');

  return new Map((data ?? []).map((shift) => [shift.ma_ca, shift as ShiftConfig]));
}

async function hasLinkedOut(admin: AdminClient, inRecordId: string): Promise<boolean> {
  const { data } = await admin
    .from('lich_su_cham_cong')
    .select('id')
    .eq('in_record_id', inRecordId)
    .eq('loai_ca', 'OUT')
    .limit(1);

  return Boolean(data && data.length > 0);
}

export async function autoCloseLatestOpenInForEmployee(
  admin: AdminClient,
  params: {
    maNv: string;
    closeAtISO: string;
    maCoSo?: string | null;
    note: string;
    isTest?: boolean;
    excludeOvernight?: boolean;
  },
): Promise<{ closed: boolean; recordId: string | null }> {
  const config = await applyDueAutoCloseConfig(admin);
  if (!config.enabled) return { closed: false, recordId: null };

  const past48h = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  const { data: oldIns } = await admin
    .from('lich_su_cham_cong')
    .select('id, ma_nv, ho_ten, khoa_ghi_nhan, loai_ca, thoi_gian, ghi_chu, is_test, ma_co_so')
    .eq('ma_nv', params.maNv)
    .in('loai_ca', ['IN_LAM', 'IN_TRUC'])
    .gte('thoi_gian', past48h)
    .lt('thoi_gian', params.closeAtISO)
    .order('thoi_gian', { ascending: false })
    .limit(1);

  const record = oldIns?.[0] as OpenInRecord | undefined;
  if (!record || await hasLinkedOut(admin, record.id)) return { closed: false, recordId: null };

  const [employeeShiftMap, shiftMap] = await Promise.all([
    fetchEmployeeShiftMap(admin, [record]),
    fetchShiftMap(admin),
  ]);
  const { allowed } = canAutoCloseRecord({
    record,
    employeeShift: record.ma_nv ? employeeShiftMap.get(record.ma_nv) : null,
    shiftMap,
    closeAtISO: params.closeAtISO,
    excludeOvernight: params.excludeOvernight ?? false,
  });
  if (!allowed) return { closed: false, recordId: null };

  const { error } = await admin.from('lich_su_cham_cong').insert({
    ma_nv: record.ma_nv,
    ho_ten: record.ho_ten,
    khoa_ghi_nhan: record.khoa_ghi_nhan,
    loai_ca: 'OUT',
    ma_co_so: params.maCoSo ?? record.ma_co_so,
    thoi_gian: params.closeAtISO,
    in_record_id: record.id,
    is_suspicious: false,
    is_test: params.isTest ?? record.is_test ?? false,
    ghi_chu: params.note,
  });
  if (error) throw error;
  return { closed: true, recordId: record.id };
}

export async function closeEligibleOpenInsBeforeDate(
  admin: AdminClient,
  effectiveDateVN: string,
): Promise<{ checked: number; closed: number }> {
  const { startUTC } = getVNDayRangeUTC(effectiveDateVN);
  const previousDateVN = addDaysToVNDate(effectiveDateVN, -1);
  const closeAtISO = getVNDateTimeUTC(previousDateVN, '23:59:59');

  const { data } = await admin
    .from('lich_su_cham_cong')
    .select('id, ma_nv, ho_ten, khoa_ghi_nhan, loai_ca, thoi_gian, ghi_chu, is_test, ma_co_so')
    .in('loai_ca', ['IN_LAM', 'IN_TRUC'])
    .lt('thoi_gian', startUTC)
    .order('thoi_gian', { ascending: false })
    .limit(1000);

  const records = (data ?? []) as OpenInRecord[];
  if (records.length === 0) return { checked: 0, closed: 0 };

  const outChecks = await admin
    .from('lich_su_cham_cong')
    .select('in_record_id')
    .eq('loai_ca', 'OUT')
    .in('in_record_id', records.map((record) => record.id));
  const closedSet = new Set((outChecks.data ?? []).map((row) => row.in_record_id));
  const openRecords = records.filter((record) => !closedSet.has(record.id));

  const [employeeShiftMap, shiftMap] = await Promise.all([
    fetchEmployeeShiftMap(admin, openRecords),
    fetchShiftMap(admin),
  ]);

  let closed = 0;
  for (const record of openRecords) {
    const { allowed, shiftEndISO } = canAutoCloseRecord({
      record,
      employeeShift: record.ma_nv ? employeeShiftMap.get(record.ma_nv) : null,
      shiftMap,
      closeAtISO,
      excludeOvernight: true,
    });
    if (!allowed || !shiftEndISO) continue;

    const { error } = await admin.from('lich_su_cham_cong').insert({
      ma_nv: record.ma_nv,
      ho_ten: record.ho_ten,
      khoa_ghi_nhan: record.khoa_ghi_nhan,
      loai_ca: 'OUT',
      ma_co_so: record.ma_co_so,
      thoi_gian: shiftEndISO,
      in_record_id: record.id,
      is_suspicious: false,
      is_test: record.is_test ?? false,
      ghi_chu: `[AUTO-CLOSE-CONFIG] Chốt IN thiếu OUT trước ngày hiệu lực ${effectiveDateVN}`,
    });
    if (!error) closed += 1;
  }

  return { checked: openRecords.length, closed };
}

export async function applyDueAutoCloseConfig(admin: AdminClient): Promise<AutoCloseConfig> {
  const config = await getAutoCloseConfig(admin);
  if (config.pendingValue === null || !config.effectiveDate) return config;
  if (config.effectiveDate > getTodayVN()) return config;

  await closeEligibleOpenInsBeforeDate(admin, config.effectiveDate);

  const rows = [
    { key: AUTO_CLOSE_KEYS.enabled, value: String(config.pendingValue) },
    { key: AUTO_CLOSE_KEYS.pendingValue, value: '' },
    { key: AUTO_CLOSE_KEYS.effectiveDate, value: '' },
  ].map((row) => ({
    ...row,
    mo_ta: CONFIG_DESCRIPTIONS[row.key].mo_ta,
    kieu_du_lieu: CONFIG_DESCRIPTIONS[row.key].kieu_du_lieu,
    trang_thai: true,
  }));

  const { error } = await admin.from('cau_hinh_he_thong').upsert(rows, { onConflict: 'key' });
  if (error) throw error;

  return {
    ...config,
    enabled: config.pendingValue,
    pendingValue: null,
    effectiveDate: null,
  };
}
