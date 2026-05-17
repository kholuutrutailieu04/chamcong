import { getAdminClient } from '@/lib/supabase';

export const DEFAULT_SELF_CORRECTION_WINDOW_MINUTES = 10;
export const OPEN_IN_LOOKBACK_HOURS = 48;

export type InAttendanceType = 'IN_LAM' | 'IN_TRUC';
export type CorrectionScope = 'EMPLOYEE' | 'MANAGER';

export type OpenInRecord = {
  id: string;
  ma_nv: string | null;
  ho_ten: string | null;
  khoa_ghi_nhan: string | null;
  loai_ca: string | null;
  thoi_gian: string | null;
  ghi_chu: string | null;
  is_test: boolean | null;
};

export function isInAttendanceType(value: string | null | undefined): value is InAttendanceType {
  return value === 'IN_LAM' || value === 'IN_TRUC';
}



export function minutesSince(isoString: string): number {
  const diffMs = Date.now() - new Date(isoString).getTime();
  return Math.max(0, Math.floor(diffMs / 60000));
}

export function buildCorrectionNote(params: {
  scope: CorrectionScope;
  fromType: InAttendanceType;
  toType: InAttendanceType;
  reason?: string | null;
  actor?: string | null;
}): string {
  const actor = params.scope === 'EMPLOYEE' ? 'Nhân viên tự sửa' : `Quản lý sửa (${params.actor ?? 'N/A'})`;
  const reasonSuffix = params.reason ? ` | Lý do: ${params.reason}` : '';
  return `[SUA_NHAM_${params.scope}] ${actor}: ${params.fromType} -> ${params.toType}${reasonSuffix}`;
}

export async function getSelfCorrectionWindowMinutes(admin: ReturnType<typeof getAdminClient>): Promise<number> {
  const { data, error } = await admin
    .from('cau_hinh_he_thong')
    .select('value')
    .eq('key', 'employee_correction_window_min')
    .single();

  if (error || !data?.value) return DEFAULT_SELF_CORRECTION_WINDOW_MINUTES;

  const parsed = Number(data.value);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_SELF_CORRECTION_WINDOW_MINUTES;
  return Math.floor(parsed);
}

export async function findLatestOpenInRecord(
  admin: ReturnType<typeof getAdminClient>,
  maNv: string,
): Promise<OpenInRecord | null> {
  const past48h = new Date(Date.now() - OPEN_IN_LOOKBACK_HOURS * 60 * 60 * 1000).toISOString();

  const { data: latestIns, error: inError } = await admin
    .from('lich_su_cham_cong')
    .select('id, ma_nv, ho_ten, khoa_ghi_nhan, loai_ca, thoi_gian, ghi_chu, is_test')
    .eq('ma_nv', maNv)
    .in('loai_ca', ['IN_LAM', 'IN_TRUC'])
    .gte('thoi_gian', past48h)
    .order('thoi_gian', { ascending: false })
    .limit(1);

  if (inError || !latestIns || latestIns.length === 0) return null;

  const latestIn = latestIns[0] as OpenInRecord;
  const { data: linkedOuts } = await admin
    .from('lich_su_cham_cong')
    .select('id')
    .eq('in_record_id', latestIn.id)
    .limit(1);

  if (linkedOuts && linkedOuts.length > 0) return null;
  return latestIn;
}
