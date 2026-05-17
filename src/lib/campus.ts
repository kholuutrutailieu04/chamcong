export type CampusCode = 'CS1' | 'CS2' | 'UNKNOWN';

export function normalizeCampusCode(value: string | null | undefined): CampusCode {
  if (!value) return 'UNKNOWN';
  const compact = value.toUpperCase().replace(/[\s_-]/g, '');
  if (compact === 'CS1' || compact === 'COSO1') return 'CS1';
  if (compact === 'CS2' || compact === 'COSO2') return 'CS2';
  return 'UNKNOWN';
}
