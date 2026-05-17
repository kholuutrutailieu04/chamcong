/**
 * Dịch loại ca/trạng thái chấm công sang ký hiệu bảng công chuẩn.
 */
export function translateAttendanceSymbol(status: string): string {
  const symbolMap: Record<string, string> = {
    IN_LAM: '+',
    IN_HOC: 'H',
    IN_TRUC: 'TR',
    NGHI_PHEP: 'P',
    NGHI_OM: 'Ô',
    THAI_SAN: 'Ts',
    NGHI_BU: 'NB',
    CON_OM: 'Cô',
    KHONG_LUONG: 'No',
    NGUNG_VIEC: 'N',
    TAI_NAN: 'T',
    NGHIA_VU: 'Lđ',
    CONG_TAC: 'Ct',
    DUONG_SUC: 'Ds',
  };

  return symbolMap[status] || status;
}

export function formatTime(dateString: string | null): string {
  if (!dateString) return '--:--';
  const date = new Date(dateString);
  return date.toLocaleTimeString('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const dPhi = ((lat2 - lat1) * Math.PI) / 180;
  const dLambda = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function getDaysInMonth(month: number, year: number): number[] {
  const date = new Date(year, month, 0);
  const days = date.getDate();
  return Array.from({ length: days }, (_, i) => i + 1);
}

export function getCurrentMonthLabel(): string {
  const now = new Date();
  return `Tháng ${now.getMonth() + 1} năm ${now.getFullYear()}`;
}
