import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '@/lib/database.types';
import { addDaysToVNDate, getTodayVN, getVNDayRangeUTC, toVNDateString } from '@/lib/timezone';
import { translateAttendanceSymbol } from '@/lib/utils';

export const LEAVE_TRANSACTION_TYPES = {
  debit: 'DEBIT',
  credit: 'CREDIT',
} as const;

export const LEAVE_TRANSACTION_SOURCES = {
  managerCreate: 'MANAGER_CREATE',
  managerCancel: 'MANAGER_CANCEL',
  actualAttendanceRefund: 'ACTUAL_ATTENDANCE_REFUND',
} as const;

export type LeaveHalfDay = 'CA_NGAY' | 'SANG' | 'CHIEU';

type AdminClient = SupabaseClient<Database>;

type EmployeeRow = {
  ma_nv: string;
  ho_ten: string | null;
  khoa_phong: string | null;
  loai_truc_mac_dinh: string | null;
  quy_phep_nam?: number | null;
};

type LeavePlanRow = {
  id: string;
  ma_nv: string;
  ho_ten: string | null;
  loai_nghi: string;
  tu_ngay: string;
  den_ngay: string;
  buoi_nghi: string;
};

type AttendanceLog = {
  id: string;
  ma_nv: string | null;
  loai_ca: string | null;
  thoi_gian: string | null;
  in_record_id: string | null;
  ghi_chu: string | null;
};

type LeaveUnit = {
  ngay: string;
  buoi_nghi: LeaveHalfDay;
  amount_days: number;
};

type LeaveTransactionInsert = Database['public']['Tables']['phep_quota_transactions']['Insert'];

const FULL_WORK_MINUTES = 8 * 60;
const SHIFT_START_MINUTES = 7 * 60 + 30;
const SHIFT_END_MINUTES = 17 * 60;
const LUNCH_START_MINUTES = 11 * 60 + 30;
const LUNCH_END_MINUTES = 13 * 60;

export function normalizeLeaveHalfDay(value: string | null | undefined): LeaveHalfDay {
  return value === 'SANG' || value === 'CHIEU' ? value : 'CA_NGAY';
}

export function listVNDateRange(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  for (let cursor = startDate; cursor <= endDate; cursor = addDaysToVNDate(cursor, 1)) {
    dates.push(cursor);
  }
  return dates;
}

export function buildLeaveUnits(params: {
  leaveId: string;
  maNv: string;
  tuNgay: string;
  denNgay: string;
  buoiNghi: string | null | undefined;
}): LeaveUnit[] {
  const buoiNghi = normalizeLeaveHalfDay(params.buoiNghi);
  return listVNDateRange(params.tuNgay, params.denNgay).map((ngay) => ({
    ngay,
    buoi_nghi: buoiNghi,
    amount_days: buoiNghi === 'CA_NGAY' ? 1 : 0.5,
  }));
}

export function sumLeaveUnits(units: LeaveUnit[]): number {
  return Math.round(units.reduce((sum, unit) => sum + unit.amount_days, 0) * 10) / 10;
}

function getVNMinutesOfDay(isoString: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Ho_Chi_Minh',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(isoString));
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? '0');
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? '0');
  return hour * 60 + minute;
}

function isWeekendVN(dateStr: string): boolean {
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCDay() === 0 || date.getUTCDay() === 6;
}

function roundOneDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}

async function updateEmployeeLeaveQuota(admin: AdminClient, maNv: string, deltaDays: number) {
  if (deltaDays === 0) return;
  const { data: emp, error: fetchError } = await admin
    .from('nhan_vien')
    .select('quy_phep_nam')
    .eq('ma_nv', maNv)
    .single();

  if (fetchError || !emp) {
    throw new Error(`Không thể đọc quỹ phép của nhân viên ${maNv}: ${fetchError?.message || 'không tồn tại'}`);
  }

  const current = emp.quy_phep_nam ?? 12;
  const next = roundOneDecimal(current + deltaDays);
  const { error: updateError } = await admin
    .from('nhan_vien')
    .update({ quy_phep_nam: next })
    .eq('ma_nv', maNv);

  if (updateError) {
    throw new Error(`Không thể cập nhật quỹ phép của nhân viên ${maNv}: ${updateError.message}`);
  }
}

export async function createLeaveDebitTransactions(params: {
  admin: AdminClient;
  leaveId: string;
  maNv: string;
  tuNgay: string;
  denNgay: string;
  buoiNghi: string | null | undefined;
  reason: string;
}) {
  const units = buildLeaveUnits({
    leaveId: params.leaveId,
    maNv: params.maNv,
    tuNgay: params.tuNgay,
    denNgay: params.denNgay,
    buoiNghi: params.buoiNghi,
  });

  const rows: LeaveTransactionInsert[] = units.map((unit) => ({
    leave_id: params.leaveId,
    ma_nv: params.maNv,
    ngay: unit.ngay,
    buoi_nghi: unit.buoi_nghi,
    amount_days: unit.amount_days,
    transaction_type: LEAVE_TRANSACTION_TYPES.debit,
    reason: params.reason,
    source: LEAVE_TRANSACTION_SOURCES.managerCreate,
  }));

  const { error } = await params.admin.from('phep_quota_transactions').insert(rows);
  if (error) {
    throw new Error(`Không thể ghi sổ trừ phép: ${error.message}`);
  }

  return { units, totalDays: sumLeaveUnits(units) };
}

export async function creditLeaveUnits(params: {
  admin: AdminClient;
  leaveId: string;
  maNv: string;
  tuNgay: string;
  denNgay: string;
  buoiNghi: string | null | undefined;
  source: string;
  reason: string;
}) {
  const units = buildLeaveUnits({
    leaveId: params.leaveId,
    maNv: params.maNv,
    tuNgay: params.tuNgay,
    denNgay: params.denNgay,
    buoiNghi: params.buoiNghi,
  });

  if (units.length === 0) return { creditedDays: 0, inserted: 0 };

  const { data: existing, error: existingError } = await params.admin
    .from('phep_quota_transactions')
    .select('ngay, buoi_nghi')
    .eq('leave_id', params.leaveId)
    .eq('ma_nv', params.maNv)
    .eq('transaction_type', LEAVE_TRANSACTION_TYPES.credit)
    .gte('ngay', params.tuNgay)
    .lte('ngay', params.denNgay);

  if (existingError) {
    throw new Error(`Không thể kiểm tra giao dịch hoàn phép: ${existingError.message}`);
  }

  const existingKeys = new Set((existing ?? []).map((row) => `${row.ngay}:${row.buoi_nghi}`));
  const rows: LeaveTransactionInsert[] = units
    .filter((unit) => !existingKeys.has(`${unit.ngay}:${unit.buoi_nghi}`))
    .map((unit) => ({
      leave_id: params.leaveId,
      ma_nv: params.maNv,
      ngay: unit.ngay,
      buoi_nghi: unit.buoi_nghi,
      amount_days: unit.amount_days,
      transaction_type: LEAVE_TRANSACTION_TYPES.credit,
      reason: params.reason,
      source: params.source,
    }));

  if (rows.length === 0) return { creditedDays: 0, inserted: 0 };

  const { error: insertError } = await params.admin.from('phep_quota_transactions').insert(rows);
  if (insertError) {
    throw new Error(`Không thể ghi sổ hoàn phép: ${insertError.message}`);
  }

  const creditedDays = roundOneDecimal(rows.reduce((sum, row) => sum + row.amount_days, 0));
  await updateEmployeeLeaveQuota(params.admin, params.maNv, creditedDays);

  return { creditedDays, inserted: rows.length };
}

function findPairedWork(records: AttendanceLog[]) {
  const workIns = records
    .filter((record) => record.loai_ca === 'IN_LAM' || record.loai_ca === 'IN_TRUC')
    .filter((record): record is AttendanceLog & { thoi_gian: string; id: string; loai_ca: string } => Boolean(record.thoi_gian && record.id && record.loai_ca))
    .sort((a, b) => new Date(b.thoi_gian).getTime() - new Date(a.thoi_gian).getTime());

  const completedInIds = new Set(
    records
      .filter((record) => record.loai_ca === 'OUT' && record.in_record_id)
      .map((record) => record.in_record_id as string),
  );

  const latestIn = workIns[0] ?? null;
  const latestOut = latestIn && completedInIds.has(latestIn.id)
    ? records.find((record) => record.loai_ca === 'OUT' && record.in_record_id === latestIn.id && record.thoi_gian) ?? null
    : null;

  return { latestIn, latestOut };
}

function calculateWorkMinutes(latestIn: AttendanceLog & { thoi_gian: string }, latestOut: AttendanceLog | null) {
  if (!latestOut?.thoi_gian) return 0;
  const inMin = getVNMinutesOfDay(latestIn.thoi_gian);
  const outRaw = getVNMinutesOfDay(latestOut.thoi_gian);
  const outMin = Math.min(outRaw, SHIFT_END_MINUTES);
  const overlap = Math.max(0, Math.min(outMin, LUNCH_END_MINUTES) - Math.max(inMin, LUNCH_START_MINUTES));
  return Math.max(0, outMin - inMin - overlap);
}

function leaveUnitCoveredByActualWork(unit: LeaveUnit, latestIn: AttendanceLog | null, latestOut: AttendanceLog | null): boolean {
  if (!latestIn?.thoi_gian || !latestOut?.thoi_gian) return false;
  if (latestIn.loai_ca === 'IN_TRUC') return true;

  const inMin = getVNMinutesOfDay(latestIn.thoi_gian);
  const outMin = getVNMinutesOfDay(latestOut.thoi_gian);

  if (unit.buoi_nghi === 'CA_NGAY') return outMin > inMin;
  if (unit.buoi_nghi === 'SANG') return inMin < LUNCH_START_MINUTES && outMin > SHIFT_START_MINUTES;
  return outMin > LUNCH_END_MINUTES;
}

function resolveLeaveSymbol(leaveType: string, buoiNghi: LeaveHalfDay, hasPairedWork: boolean): string {
  if (leaveType === 'NGHI_PHEP') {
    if (buoiNghi === 'SANG') return hasPairedWork ? '+/P' : 'P/v';
    if (buoiNghi === 'CHIEU') return hasPairedWork ? 'P/+' : 'v/P';
  }
  return translateAttendanceSymbol(leaveType);
}

async function fetchLogsForDate(admin: AdminClient, dateStr: string) {
  const { startUTC, endUTC } = getVNDayRangeUTC(dateStr);
  const select = 'id, ma_nv, loai_ca, thoi_gian, in_record_id, ghi_chu';
  const [current, archived] = await Promise.all([
    admin
      .from('lich_su_cham_cong')
      .select(select)
      .gte('thoi_gian', startUTC)
      .lte('thoi_gian', endUTC)
      .eq('is_test', false),
    admin
      .from('lich_su_cham_cong_archive')
      .select(select)
      .gte('thoi_gian', startUTC)
      .lte('thoi_gian', endUTC)
      .eq('is_test', false),
  ]);

  if (current.error) throw new Error(`Không thể đọc log chấm công: ${current.error.message}`);
  if (archived.error) throw new Error(`Không thể đọc log chấm công archive: ${archived.error.message}`);
  return [...((current.data ?? []) as AttendanceLog[]), ...((archived.data ?? []) as AttendanceLog[])];
}

export async function recomputeAttendanceSummaryForDate(admin: AdminClient, dateStr: string) {
  const [employeeResult, leaveResult, holidayResult, logs] = await Promise.all([
    admin
      .from('nhan_vien')
      .select('ma_nv, ho_ten, khoa_phong, loai_truc_mac_dinh')
      .not('ma_nv', 'like', 'NV_TEST_%')
      .not('trang_thai', 'is', false),
    admin
      .from('don_nghi_phep')
      .select('id, ma_nv, ho_ten, loai_nghi, tu_ngay, den_ngay, buoi_nghi')
      .lte('tu_ngay', dateStr)
      .gte('den_ngay', dateStr),
    admin
      .from('ngay_le')
      .select('ngay')
      .eq('ngay', dateStr)
      .maybeSingle(),
    fetchLogsForDate(admin, dateStr),
  ]);

  if (employeeResult.error) throw new Error(`Không thể đọc danh sách nhân viên: ${employeeResult.error.message}`);
  if (leaveResult.error) throw new Error(`Không thể đọc đơn nghỉ phép: ${leaveResult.error.message}`);
  if (holidayResult.error) throw new Error(`Không thể đọc ngày lễ: ${holidayResult.error.message}`);

  const employees = (employeeResult.data ?? []) as EmployeeRow[];
  const leavePlans = (leaveResult.data ?? []) as LeavePlanRow[];
  const logsByEmployee = new Map<string, AttendanceLog[]>();
  const leavesByEmployee = new Map<string, LeavePlanRow[]>();
  let refundedDays = 0;
  let refundTransactions = 0;

  for (const log of logs) {
    if (!log.ma_nv) continue;
    const list = logsByEmployee.get(log.ma_nv) ?? [];
    list.push(log);
    logsByEmployee.set(log.ma_nv, list);
  }

  for (const leave of leavePlans) {
    const list = leavesByEmployee.get(leave.ma_nv) ?? [];
    list.push(leave);
    leavesByEmployee.set(leave.ma_nv, list);
  }

  const isHoliday = Boolean(holidayResult.data);
  const summaries: Database['public']['Tables']['bang_cong_ngay']['Insert'][] = [];

  for (const employee of employees) {
    const dayLogs = logsByEmployee.get(employee.ma_nv) ?? [];
    const dayLeaves = leavesByEmployee.get(employee.ma_nv) ?? [];
    const { latestIn, latestOut } = findPairedWork(dayLogs);
    const hasPairedWork = Boolean(latestIn && latestOut);
    const hasPendingIn = Boolean(latestIn && !latestOut);
    const isHanhChinh = employee.loai_truc_mac_dinh === 'HANH_CHINH';
    const rawRecordIds = dayLogs.map((log) => log.id).filter(Boolean);

    let workMinutes = 0;
    let lateMinutes = 0;
    let earlyLeaveMinutes = 0;
    let overtimeMinutes = 0;
    let leavePaidDays = 0;
    let leaveRefundedDays = 0;
    let unpaidAbsenceMinutes = 0;
    let payrollSymbol = '';
    let sourceStatus = 'RAW_LOG';

    if (latestIn && latestOut) {
      if (latestIn.loai_ca === 'IN_TRUC') {
        payrollSymbol = 'TR';
        workMinutes = FULL_WORK_MINUTES;
      } else {
        payrollSymbol = '+';
        workMinutes = isHanhChinh ? calculateWorkMinutes(latestIn, latestOut) : FULL_WORK_MINUTES;
        const inMin = getVNMinutesOfDay(latestIn.thoi_gian);
        const outMin = getVNMinutesOfDay(latestOut.thoi_gian as string);
        lateMinutes = isHanhChinh ? Math.max(0, inMin - SHIFT_START_MINUTES) : 0;
        earlyLeaveMinutes = isHanhChinh ? Math.max(0, SHIFT_END_MINUTES - outMin) : 0;
        overtimeMinutes = Math.max(0, outMin - SHIFT_END_MINUTES);
      }
    } else if (latestIn) {
      payrollSymbol = latestIn.loai_ca === 'IN_TRUC' ? 'in·' : 'in';
      sourceStatus = 'PENDING_IN';
    }

    for (const leave of dayLeaves) {
      const units = buildLeaveUnits({
        leaveId: leave.id,
        maNv: leave.ma_nv,
        tuNgay: dateStr,
        denNgay: dateStr,
        buoiNghi: leave.buoi_nghi,
      });

      const buoiNghi = normalizeLeaveHalfDay(leave.buoi_nghi);
      if (leave.loai_nghi === 'NGHI_PHEP') {
        leavePaidDays += sumLeaveUnits(units);
        const coveredUnits = units.filter((unit) => leaveUnitCoveredByActualWork(unit, latestIn, latestOut));
        if (coveredUnits.length > 0) {
          const creditResult = await creditLeaveUnits({
            admin,
            leaveId: leave.id,
            maNv: leave.ma_nv,
            tuNgay: dateStr,
            denNgay: dateStr,
            buoiNghi: leave.buoi_nghi,
            source: LEAVE_TRANSACTION_SOURCES.actualAttendanceRefund,
            reason: 'Hoàn phép vì có công thực tế trong ngày/buổi đã đăng ký nghỉ',
          });
          refundedDays += creditResult.creditedDays;
          refundTransactions += creditResult.inserted;
          leaveRefundedDays += sumLeaveUnits(coveredUnits);
          if (buoiNghi === 'CA_NGAY') payrollSymbol = hasPairedWork ? payrollSymbol || '+' : 'P';
        } else if (!payrollSymbol) {
          payrollSymbol = resolveLeaveSymbol(leave.loai_nghi, buoiNghi, hasPairedWork);
        } else if (buoiNghi !== 'CA_NGAY') {
          payrollSymbol = resolveLeaveSymbol(leave.loai_nghi, buoiNghi, hasPairedWork);
        }
        sourceStatus = hasPairedWork ? 'MIXED' : 'LEAVE';
      } else if (!payrollSymbol) {
        payrollSymbol = resolveLeaveSymbol(leave.loai_nghi, buoiNghi, hasPairedWork);
        sourceStatus = 'LEAVE';
      }
    }

    if (!payrollSymbol) {
      if (isHoliday) {
        payrollSymbol = 'NL';
        sourceStatus = 'HOLIDAY';
      } else if (isWeekendVN(dateStr)) {
        payrollSymbol = '-';
        sourceStatus = 'WEEKEND';
      } else {
        payrollSymbol = '';
        unpaidAbsenceMinutes = FULL_WORK_MINUTES;
        sourceStatus = 'ABSENT';
      }
    }

    summaries.push({
      ma_nv: employee.ma_nv,
      ngay: dateStr,
      thang: dateStr.slice(0, 7),
      ma_khoa: employee.khoa_phong,
      work_minutes: workMinutes,
      late_minutes: lateMinutes,
      early_leave_minutes: earlyLeaveMinutes,
      overtime_minutes: overtimeMinutes,
      leave_paid_days: roundOneDecimal(leavePaidDays),
      leave_refunded_days: roundOneDecimal(leaveRefundedDays),
      unpaid_absence_minutes: unpaidAbsenceMinutes,
      payroll_symbol: payrollSymbol,
      source_status: sourceStatus,
      needs_review: hasPendingIn,
      raw_record_ids: rawRecordIds as Json,
      computed_at: new Date().toISOString(),
    });
  }

  if (summaries.length > 0) {
    const { error } = await admin
      .from('bang_cong_ngay')
      .upsert(summaries, { onConflict: 'ma_nv,ngay' });
    if (error) throw new Error(`Summary recompute thất bại: ${error.message}`);
  }

  return {
    success: true,
    date: dateStr,
    employees: employees.length,
    summaries: summaries.length,
    refunded_days: refundedDays,
    refund_transactions: refundTransactions,
  };
}

export async function recomputeAttendanceSummaryForRecentDays(admin: AdminClient, days = 7) {
  const today = getTodayVN();
  const results = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = addDaysToVNDate(today, -offset);
    results.push(await recomputeAttendanceSummaryForDate(admin, date));
  }
  return {
    success: true,
    from: results[0]?.date ?? today,
    to: results[results.length - 1]?.date ?? today,
    results,
  };
}

export function buildCronLeaveTimestamp(dateStr: string): string {
  return new Date(`${dateStr}T01:30:00.000Z`).toISOString();
}

export function getReportDateFromTimestamp(value: string | null): string | null {
  return value ? toVNDateString(new Date(value)) : null;
}
