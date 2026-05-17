export const SHIFT_TYPE_3CA_PARENT = '3CA_4KIP';

export const LEGACY_3CA_CHILD_CODES = ['CA_SANG_3KIP', 'CA_CHIEU_3KIP', 'CA_DEM_3KIP'] as const;

export const SHIFT_TYPE_OPTIONS = [
  'HANH_CHINH',
  'TRUC_12_24',
  'TRUC_16_24',
  'TRUC_24_24',
  SHIFT_TYPE_3CA_PARENT,
] as const;

export type ShiftTypeOption = (typeof SHIFT_TYPE_OPTIONS)[number];

const LEGACY_3CA_SET = new Set<string>(LEGACY_3CA_CHILD_CODES);
const SHIFT_TYPE_SET = new Set<string>(SHIFT_TYPE_OPTIONS);

export function normalizeShiftType(value: string | null | undefined): string | null {
  if (!value) return null;
  return LEGACY_3CA_SET.has(value) ? SHIFT_TYPE_3CA_PARENT : value;
}

export function isSupportedShiftType(value: string | null | undefined): value is ShiftTypeOption {
  const normalized = normalizeShiftType(value);
  return Boolean(normalized && SHIFT_TYPE_SET.has(normalized));
}

export function is3CaShiftType(value: string | null | undefined): boolean {
  const normalized = normalizeShiftType(value);
  return normalized === SHIFT_TYPE_3CA_PARENT;
}

export const SHIFT_TYPE_LABELS: Record<string, string> = {
  HANH_CHINH: 'Hành Chính',
  TRUC_12_24: 'Trực 12/24',
  TRUC_16_24: 'Trực 16/24',
  TRUC_24_24: 'Trực 24/24',
  [SHIFT_TYPE_3CA_PARENT]: '3 Ca 4 Kíp',
};
