/**
 * timezone.ts — Các helper xử lý múi giờ Việt Nam (GMT+7).
 *
 * Supabase lưu timestamp dạng UTC. Vercel runtime cũng chạy theo UTC.
 * Mọi logic so sánh ngày (YYYY-MM-DD) trong hệ thống phải quy về VN time
 * để tránh lệch ngày vào khoảng 17h–24h UTC (= 0h–7h VN hôm sau).
 */

const VN_OFFSET_MS = 7 * 60 * 60 * 1000; // GMT+7

/**
 * Trả về chuỗi YYYY-MM-DD theo múi giờ VN cho một thời điểm bất kỳ.
 * @param date  Đối tượng Date (mặc định: thời điểm hiện tại)
 */
export function toVNDateString(date: Date = new Date()): string {
  const vnDate = new Date(date.getTime() + VN_OFFSET_MS);
  return vnDate.toISOString().split('T')[0];
}

/**
 * Trả về chuỗi YYYY-MM-DD của HÔM NAY theo múi giờ VN.
 * Dùng thay thế cho `new Date().toISOString().split('T')[0]` (UTC).
 */
export function getTodayVN(): string {
  return toVNDateString(new Date());
}

export function getCurrentVNMonth(): string {
  return getTodayVN().slice(0, 7);
}

export function getVNHour(date: Date = new Date()): number {
  const vnDate = new Date(date.getTime() + VN_OFFSET_MS);
  return vnDate.getUTCHours();
}

/**
 * Trả về [startUTC, endUTC] bao trùm toàn bộ ngày YYYY-MM-DD theo VN timezone,
 * dưới dạng ISO string UTC — dùng để query cột timestamp trên Supabase.
 *
 * Ví dụ: ngày "2026-05-21" VN → ["2026-05-20T17:00:00.000Z", "2026-05-21T16:59:59.999Z"]
 */
export function getVNDayRangeUTC(dateStr: string): { startUTC: string; endUTC: string } {
  // dateStr là YYYY-MM-DD theo VN time
  const startVN = new Date(`${dateStr}T00:00:00.000Z`);
  const endVN   = new Date(`${dateStr}T23:59:59.999Z`);
  // Trừ 7h để về UTC
  const startUTC = new Date(startVN.getTime() - VN_OFFSET_MS).toISOString();
  const endUTC   = new Date(endVN.getTime()   - VN_OFFSET_MS).toISOString();
  return { startUTC, endUTC };
}

/**
 * Trả về [startUTC, endUTC] cho toàn bộ tháng YYYY-MM theo VN timezone.
 * @param month  Chuỗi dạng "YYYY-MM"
 */
export function getVNMonthRangeUTC(month: string): { startUTC: string; endUTC: string } {
  const [year, mon] = month.split('-').map(Number);
  const startVN = new Date(Date.UTC(year, mon - 1, 1, 0, 0, 0, 0));
  const endVN   = new Date(Date.UTC(year, mon,     0, 23, 59, 59, 999)); // ngày cuối tháng
  const startUTC = new Date(startVN.getTime() - VN_OFFSET_MS).toISOString();
  const endUTC   = new Date(endVN.getTime()   - VN_OFFSET_MS).toISOString();
  return { startUTC, endUTC };
}

export function addDaysToVNDate(dateStr: string, days: number): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days, 0, 0, 0, 0));
  return date.toISOString().split('T')[0];
}

export function getVNDateTimeUTC(dateStr: string, timeValue: string): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  const [hour = 0, minute = 0, second = 0] = timeValue.split(':').map(Number);
  return new Date(Date.UTC(year, month - 1, day, hour, minute, second, 0) - VN_OFFSET_MS).toISOString();
}

export function formatVNDateTime(date: Date = new Date()): string {
  const vnDate = new Date(date.getTime() + VN_OFFSET_MS);
  const year = vnDate.getUTCFullYear();
  const month = String(vnDate.getUTCMonth() + 1).padStart(2, '0');
  const day = String(vnDate.getUTCDate()).padStart(2, '0');
  const hour = String(vnDate.getUTCHours()).padStart(2, '0');
  const minute = String(vnDate.getUTCMinutes()).padStart(2, '0');
  const second = String(vnDate.getUTCSeconds()).padStart(2, '0');
  return `${year}-${month}-${day} ${hour}:${minute}:${second} GMT+7`;
}

export function parseVNDateTimeLabel(value: string | null | undefined): Date | null {
  if (!value) return null;
  if (/[zZ]|[+-]\d{2}:\d{2}/.test(value)) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }

  const localMatch = value.match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?\s*(?:GMT\+7)?/);
  if (localMatch) {
    const [, year, month, day, hour, minute, second = '0'] = localMatch;
    return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second)) - VN_OFFSET_MS);
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
