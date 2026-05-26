import { generateAttendanceExcelReport } from '@/lib/excel-report';
import { sendReportEmailViaGas } from '@/lib/gas';
import { getAdminClient } from '@/lib/supabase';
import { formatVNDateTime, getTodayVN } from '@/lib/timezone';

export const AUTO_EMAIL_REPORT_KEY = 'AUTO_EMAIL_REPORT_ENABLED';

const REPORT_SEND_DAY = Number(process.env.AUTO_EMAIL_REPORT_DAY_OF_MONTH || '5');
const REPORT_SEND_HOUR = Number(process.env.AUTO_EMAIL_REPORT_HOUR || '8');
const REPORT_SEND_MINUTE = Number(process.env.AUTO_EMAIL_REPORT_MINUTE || '0');
const REPORT_CC = splitEmailList(process.env.AUTO_EMAIL_REPORT_CC);
const REPORT_BCC = splitEmailList(process.env.AUTO_EMAIL_REPORT_BCC);
const REPORT_FROM_LABEL = process.env.AUTO_EMAIL_REPORT_FROM_LABEL || 'Hệ thống chấm công';

let lastRunKeyInProcess: string | null = null;

type AdminClient = ReturnType<typeof getAdminClient>;

type DepartmentReportTarget = {
  ma_khoa: string;
  ten_khoa: string | null;
  email_truong_khoa: string | null;
};

export type AutoEmailReportConfig = {
  enabled: boolean;
  scheduleLabel: string;
};

export type AutoEmailReportRunResult = {
  enabled: boolean;
  due: boolean;
  month: string;
  runKey: string;
  sent: number;
  skipped: number;
  failed: number;
  errors: string[];
};

function splitEmailList(value: string | undefined): string[] {
  return (value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function isValidEmail(value: string | null | undefined): value is string {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value || '');
}

function getPreviousVNMonth(today = getTodayVN()): string {
  const [year, month] = today.split('-').map(Number);
  const previous = new Date(Date.UTC(year, month - 2, 1));
  return `${previous.getUTCFullYear()}-${String(previous.getUTCMonth() + 1).padStart(2, '0')}`;
}

function getVNParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);

  return {
    year: Number(parts.find((part) => part.type === 'year')?.value ?? '0'),
    month: Number(parts.find((part) => part.type === 'month')?.value ?? '0'),
    day: Number(parts.find((part) => part.type === 'day')?.value ?? '0'),
    hour: Number(parts.find((part) => part.type === 'hour')?.value ?? '0'),
    minute: Number(parts.find((part) => part.type === 'minute')?.value ?? '0'),
  };
}

function getCurrentRunState(now = new Date()) {
  const parts = getVNParts(now);
  const targetMonth = process.env.AUTO_EMAIL_REPORT_TARGET_MONTH || getPreviousVNMonth();
  const scheduledTotalMinutes = REPORT_SEND_HOUR * 60 + REPORT_SEND_MINUTE;
  const currentTotalMinutes = parts.hour * 60 + parts.minute;
  const due = parts.day === REPORT_SEND_DAY && currentTotalMinutes >= scheduledTotalMinutes;
  const runKey = `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}:${targetMonth}`;
  return { due, runKey, targetMonth };
}

export function getAutoEmailReportScheduleLabel(): string {
  return `Ngày ${REPORT_SEND_DAY} lúc ${String(REPORT_SEND_HOUR).padStart(2, '0')}:${String(REPORT_SEND_MINUTE).padStart(2, '0')} GMT+7`;
}

export async function getAutoEmailReportConfig(admin: AdminClient): Promise<AutoEmailReportConfig> {
  const { data } = await admin
    .from('cau_hinh_he_thong')
    .select('value')
    .eq('key', AUTO_EMAIL_REPORT_KEY)
    .maybeSingle();

  return {
    enabled: data?.value === 'true',
    scheduleLabel: getAutoEmailReportScheduleLabel(),
  };
}

export async function setAutoEmailReportEnabled(admin: AdminClient, enabled: boolean): Promise<AutoEmailReportConfig> {
  const { error } = await admin.from('cau_hinh_he_thong').upsert(
    {
      key: AUTO_EMAIL_REPORT_KEY,
      value: String(enabled),
      mo_ta: 'Bật/tắt gửi tự động báo cáo Excel khoa qua email',
      kieu_du_lieu: 'boolean',
      trang_thai: true,
    },
    { onConflict: 'key' },
  );
  if (error) throw error;
  return getAutoEmailReportConfig(admin);
}

function buildMailContent(params: { month: string; departmentName: string }) {
  const subject = `[${REPORT_FROM_LABEL}] Bảng công tháng ${params.month} - ${params.departmentName}`;
  const body = [
    `Kính gửi ${params.departmentName},`,
    '',
    `Hệ thống gửi kèm file bảng công tháng ${params.month}.`,
    'Nếu khoa/phòng không nhận được email tự động hoặc cần tải lại file, vui lòng dùng chức năng xuất Excel thủ công trên dashboard.',
    '',
    `Thời điểm gửi: ${formatVNDateTime()}`,
  ].join('\n');
  return { subject, body };
}

export async function runDueAutoEmailReports(admin: AdminClient = getAdminClient()): Promise<AutoEmailReportRunResult> {
  const config = await getAutoEmailReportConfig(admin);
  const { due, runKey, targetMonth } = getCurrentRunState();
  const result: AutoEmailReportRunResult = {
    enabled: config.enabled,
    due,
    month: targetMonth,
    runKey,
    sent: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  };

  if (!config.enabled || !due) return result;
  if (lastRunKeyInProcess === runKey) {
    result.skipped += 1;
    return result;
  }

  const { data: departments, error } = await admin
    .from('dm_khoa_phong')
    .select('ma_khoa, ten_khoa, email_truong_khoa')
    .eq('trang_thai', true)
    .order('ten_khoa');

  if (error) throw error;

  for (const department of (departments ?? []) as DepartmentReportTarget[]) {
    const email = department.email_truong_khoa?.trim() || '';
    const departmentName = department.ten_khoa || department.ma_khoa;

    if (!isValidEmail(email)) {
      result.skipped += 1;
      console.warn(`[AutoEmailReport] Bỏ qua ${department.ma_khoa}: email_truong_khoa không hợp lệ.`);
      continue;
    }

    try {
      const report = await generateAttendanceExcelReport({ khoa: department.ma_khoa, monthStr: targetMonth });
      const { subject, body } = buildMailContent({ month: targetMonth, departmentName });
      await sendReportEmailViaGas({
        to: email,
        cc: REPORT_CC,
        bcc: REPORT_BCC,
        subject,
        body,
        fileName: report.filename,
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        buffer: Buffer.from(report.buffer),
      });
      result.sent += 1;
    } catch (error) {
      result.failed += 1;
      const message = error instanceof Error ? error.message : 'Lỗi không xác định';
      result.errors.push(`${department.ma_khoa}: ${message}`);
      console.error(`[AutoEmailReport] Gửi báo cáo thất bại cho ${department.ma_khoa}:`, error);
    }
  }

  lastRunKeyInProcess = runKey;
  return result;
}
