import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import { formatVNDateTime, parseVNDateTimeLabel } from '@/lib/timezone';

type AdminClient = SupabaseClient<Database>;

export const MASTER_OTP_KEY = 'MASTER_OTP';

export function getMasterOtpExpiresAt(description: string | null | undefined): Date | null {
  const expireMatch = description?.match(/Hết hạn:\s*(.+)$/);
  return parseVNDateTimeLabel(expireMatch?.[1]);
}

export async function deleteExpiredMasterOtp(admin: AdminClient): Promise<boolean> {
  const { data } = await admin
    .from('cau_hinh_he_thong')
    .select('mo_ta')
    .eq('key', MASTER_OTP_KEY)
    .maybeSingle();

  const expiresAt = getMasterOtpExpiresAt(data?.mo_ta);
  if (!expiresAt || Date.now() <= expiresAt.getTime()) return false;

  await admin.from('cau_hinh_he_thong').delete().eq('key', MASTER_OTP_KEY);
  return true;
}

export function buildMasterOtpDescription(expiresAt: Date): string {
  return `Mã OTP Khẩn Cấp dùng chung | Hết hạn: ${formatVNDateTime(expiresAt)}`;
}
