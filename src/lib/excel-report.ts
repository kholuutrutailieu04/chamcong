import ExcelJS from 'exceljs';
import fs from 'fs';
import path from 'path';
import { normalizeCampusCode } from '@/lib/campus';
import { getAdminClient } from '@/lib/supabase';
import { getVNMonthRangeUTC, toVNDateString } from '@/lib/timezone';
import { getDaysInMonth, translateAttendanceSymbol } from '@/lib/utils';

const PAGE_SIZE = 1000;

type EmpRow = {
  ma_nv: string | null;
  ho_ten: string | null;
  khoa_phong: string | null;
  loai_truc_mac_dinh: string | null;
  trang_thai: boolean | null;
  ma_co_so_mac_dinh: string | null;
};

type RawRecord = {
  id: string;
  ma_nv: string | null;
  loai_ca: string | null;
  thoi_gian: string | null;
  in_record_id: string | null;
  ghi_chu: string | null;
};

type DayRecord = {
  id: string;
  loai_ca: string;
  thoi_gian: string;
  in_record_id: string | null;
  ghi_chu: string | null;
};

type SummaryRow = {
  ma_nv: string;
  ngay: string;
  work_minutes: number;
  payroll_symbol: string | null;
};

export type ExcelReportResult = {
  buffer: ArrayBuffer;
  filename: string;
  monthStr: string;
  khoa: string;
};

function normalizeHeaderMonth(input: string, month: number, year: number): string {
  return input
    .replace(/tháng\s+\d+(?:[./-]\d{4})?/i, `Tháng ${month}.${year}`)
    .replace(/năm\s+\d{4}/i, `năm ${year}`);
}

function toDateLabel(monthStr: string): string {
  const [year, month] = monthStr.split('-');
  return `Tháng ${Number(month)}.${year}`;
}

function isRichTextValue(value: ExcelJS.CellValue): value is ExcelJS.CellRichTextValue {
  return Boolean(value && typeof value === 'object' && 'richText' in value && Array.isArray(value.richText));
}

function replaceCellTextPreserveRichText(cell: ExcelJS.Cell, replaceText: (text: string) => string) {
  if (typeof cell.value === 'string') {
    cell.value = replaceText(cell.value);
    return;
  }

  if (isRichTextValue(cell.value)) {
    const originalText = cell.value.richText.map((part) => part.text).join('');
    const replacedText = replaceText(originalText);
    if (replacedText !== originalText) {
      cell.value = replacedText;
      return;
    }

    cell.value = {
      richText: cell.value.richText.map((part) => ({
        ...part,
        text: replaceText(part.text),
      })),
    };
  }
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

export async function generateAttendanceExcelReport(params: {
  khoa?: string;
  monthStr: string;
}): Promise<ExcelReportResult> {
  const khoa = params.khoa || 'ALL';
  const monthStr = params.monthStr;
  const [year, month] = monthStr.split('-').map(Number);
  if (!year || !month) {
    throw new Error('Tháng báo cáo không hợp lệ.');
  }

  const admin = getAdminClient();
  const { data: khoaRows } = await admin
    .from('dm_khoa_phong')
    .select('ma_khoa, ten_khoa');
  const khoaNameByCode = new Map((khoaRows ?? []).map((k) => [k.ma_khoa, k.ten_khoa || k.ma_khoa]));
  let tenKhoaExport: string | null = null;
  let empQuery = admin
    .from('nhan_vien')
    .select('ma_nv, ho_ten, khoa_phong, loai_truc_mac_dinh, trang_thai, ma_co_so_mac_dinh')
    .not('ma_nv', 'like', 'NV_TEST_%')
    .not('trang_thai', 'is', false);

  if (khoa !== 'ALL') {
    tenKhoaExport = (khoaNameByCode.get(khoa) || khoa).trim();
    empQuery = empQuery.eq('khoa_phong', khoa);
  }

  const allEmployees: EmpRow[] = [];
  for (let pageFrom = 0; ; pageFrom += PAGE_SIZE) {
    const { data: page, error: pageErr } = await empQuery.range(pageFrom, pageFrom + PAGE_SIZE - 1);
    if (pageErr) throw pageErr;
    if (!page || page.length === 0) break;
    allEmployees.push(...(page as EmpRow[]));
    if (page.length < PAGE_SIZE) break;
  }

  const employees = allEmployees.sort((a, b) => {
    const campusA = normalizeCampusCode(a.ma_co_so_mac_dinh);
    const campusB = normalizeCampusCode(b.ma_co_so_mac_dinh);
    if (campusA !== campusB) return campusA.localeCompare(campusB);
    return (a.ho_ten ?? '').localeCompare(b.ho_ten ?? '', 'vi');
  });

  if (employees.length === 0) {
    throw new Error('Không tìm thấy nhân sự nào.');
  }

  const { startUTC, endUTC } = getVNMonthRangeUTC(monthStr);
  const startDate = new Date(startUTC);
  const endDate = new Date(endUTC);

  const startDateStr = `${year}-${String(month).padStart(2, '0')}-01`;
  const endDateStr = new Date(Date.UTC(year, month, 0)).toISOString().split('T')[0];

  const { data: holidaysData } = await admin
    .from('ngay_le')
    .select('ngay')
    .gte('ngay', startDateStr)
    .lte('ngay', endDateStr);

  const holidaySet = new Set(holidaysData?.map((h) => Number(h.ngay.split('-')[2])) || []);

  const allRecords: RawRecord[] = [];
  for (let recFrom = 0; ; recFrom += PAGE_SIZE) {
    const { data: recPage, error: recErr } = await admin
      .from('lich_su_cham_cong')
      .select('ma_nv, loai_ca, thoi_gian, id, in_record_id, ghi_chu')
      .gte('thoi_gian', startDate.toISOString())
      .lte('thoi_gian', endDate.toISOString())
      .eq('is_test', false)
      .range(recFrom, recFrom + PAGE_SIZE - 1);
    if (recErr) throw recErr;
    if (!recPage || recPage.length === 0) break;
    allRecords.push(...(recPage as RawRecord[]));
    if (recPage.length < PAGE_SIZE) break;
  }

  for (let recFrom = 0; ; recFrom += PAGE_SIZE) {
    const { data: recPage, error: recErr } = await admin
      .from('lich_su_cham_cong_archive')
      .select('ma_nv, loai_ca, thoi_gian, id, in_record_id, ghi_chu')
      .gte('thoi_gian', startDate.toISOString())
      .lte('thoi_gian', endDate.toISOString())
      .eq('is_test', false)
      .range(recFrom, recFrom + PAGE_SIZE - 1);
    if (recErr) throw recErr;
    if (!recPage || recPage.length === 0) break;
    allRecords.push(...(recPage as RawRecord[]));
    if (recPage.length < PAGE_SIZE) break;
  }

  const allSummaries: SummaryRow[] = [];
  for (const table of ['bang_cong_ngay', 'bang_cong_ngay_archive'] as const) {
    for (let sumFrom = 0; ; sumFrom += PAGE_SIZE) {
      const { data: sumPage, error: sumErr } = await admin
        .from(table)
        .select('ma_nv, ngay, work_minutes, payroll_symbol')
        .gte('ngay', startDateStr)
        .lte('ngay', endDateStr)
        .in('ma_nv', employees.map((employee) => employee.ma_nv).filter((maNv): maNv is string => Boolean(maNv)))
        .range(sumFrom, sumFrom + PAGE_SIZE - 1);
      if (sumErr) throw sumErr;
      if (!sumPage || sumPage.length === 0) break;
      allSummaries.push(...(sumPage as SummaryRow[]));
      if (sumPage.length < PAGE_SIZE) break;
    }
  }

  const recordMap: Record<string, Record<number, DayRecord[]>> = {};
  employees.forEach((e) => {
    if (e.ma_nv) recordMap[e.ma_nv] = {};
  });

  allRecords.forEach((r) => {
    if (!r.ma_nv || !r.thoi_gian || !r.loai_ca) return;
    const day = Number(toVNDateString(new Date(r.thoi_gian)).split('-')[2]);
    if (!recordMap[r.ma_nv]) return;
    if (!recordMap[r.ma_nv][day]) recordMap[r.ma_nv][day] = [];
    recordMap[r.ma_nv][day].push({
      id: r.id,
      loai_ca: r.loai_ca,
      thoi_gian: r.thoi_gian,
      in_record_id: r.in_record_id ?? null,
      ghi_chu: r.ghi_chu ?? null,
    });
  });

  const summaryMap: Record<string, Record<number, SummaryRow>> = {};
  employees.forEach((e) => {
    if (e.ma_nv) summaryMap[e.ma_nv] = {};
  });

  allSummaries.forEach((summary) => {
    const day = Number(summary.ngay.split('-')[2]);
    if (!summaryMap[summary.ma_nv]) return;
    if (!summaryMap[summary.ma_nv][day]) summaryMap[summary.ma_nv][day] = summary;
  });

  const templatePath = path.join(process.cwd(), 'public', 'templates', 'Mau Bang cham cong 2026.xlsx');
  const workbook = new ExcelJS.Workbook();

  if (fs.existsSync(templatePath)) {
    await workbook.xlsx.readFile(templatePath);
  } else {
    throw new Error('Không tìm thấy file mẫu Excel tại public/templates/');
  }

  const sheet = workbook.worksheets[0];
  sheet.name = `BangCong_${monthStr}`;

  for (let row = 1; row <= 10; row += 1) {
    for (let col = 1; col <= 20; col += 1) {
      const cell = sheet.getRow(row).getCell(col);
      replaceCellTextPreserveRichText(cell, (input) => {
        let text = normalizeHeaderMonth(input, month, year);
        if (khoa === 'ALL') {
          text = text.replace(/Khoa\s*:?\s*(\.{2,}|_+)?/i, 'Khoa: Tất cả');
        } else if (tenKhoaExport) {
          text = text.replace(/Khoa\s*:?\s*(\.{2,}|_+)?/i, `Khoa: ${tenKhoaExport}`);
        }
        return text;
      });
    }
  }
  sheet.getCell('H2').value = toDateLabel(monthStr);

  if (khoa === 'ALL') {
    sheet.spliceColumns(3, 0, [], []);
    sheet.getCell('B3').value = 'Mã NV';
    sheet.getCell('C3').value = 'Khoa phòng';
    sheet.getCell('D3').value = 'HỌ VÀ TÊN';
    sheet.getCell('B4').value = 'Mã NV';
    sheet.getCell('C4').value = 'Khoa phòng';
    sheet.getCell('D4').value = 'HỌ VÀ TÊN';
    sheet.getCell('B5').value = 'Mã NV';
    sheet.getCell('C5').value = 'Khoa phòng';
    sheet.getCell('D5').value = 'HỌ VÀ TÊN';
    sheet.getCell('B6').value = 'B';
    sheet.getCell('C6').value = 'C';
    sheet.getCell('D6').value = 'D';
  }

  const daysInMonth = getDaysInMonth(month, year);
  const dataStartRow = 7;
  const templateDataRows = 10;
  const footerAnchorRow = dataStartRow + templateDataRows;
  const extraRows = Math.max(0, employees.length - templateDataRows);
  if (extraRows > 0) {
    sheet.spliceRows(footerAnchorRow, 0, ...Array.from({ length: extraRows }, () => []));
  }

  const totalCol = (khoa === 'ALL' ? 6 : 2) + 32;
  const lastStyledCol = khoa === 'ALL' ? 40 : 34;

  employees.forEach((emp, index) => {
    const currentRow = dataStartRow + index;
    sheet.getCell(`A${currentRow}`).value = index + 1;

    if (khoa === 'ALL') {
      sheet.getCell(`B${currentRow}`).value = emp.ma_nv ?? '';
      sheet.getCell(`C${currentRow}`).value = emp.khoa_phong ? (khoaNameByCode.get(emp.khoa_phong) ?? emp.khoa_phong) : '';
      sheet.getCell(`D${currentRow}`).value = emp.ho_ten ?? '';
      sheet.getCell(`D${currentRow}`).alignment = { horizontal: 'left', vertical: 'middle' };
    } else {
      sheet.getCell(`B${currentRow}`).value = emp.ho_ten ?? '';
      sheet.getCell(`B${currentRow}`).alignment = { horizontal: 'left', vertical: 'middle' };
    }

    let tongCongMinutes = 0;
    let tongCongDays = 0;
    let tongTangCuongMinutes = 0;
    const isHanhChinh = emp.loai_truc_mac_dinh === 'HANH_CHINH';

    const TRUA_BAT_DAU = 11 * 60 + 30;
    const TRUA_KET_THUC = 13 * 60;
    const CA_DU_PHUT = 8 * 60;

    for (const day of daysInMonth) {
      const summary = emp.ma_nv ? summaryMap[emp.ma_nv]?.[day] : null;
      const dayRecords = emp.ma_nv ? (recordMap[emp.ma_nv]?.[day] || []) : [];

      const completedInIds = new Set(
        dayRecords
          .filter((r) => r.loai_ca === 'OUT' && r.in_record_id)
          .map((r) => r.in_record_id as string),
      );

      const latestIn = dayRecords
        .filter((r) => r.loai_ca === 'IN_LAM' || r.loai_ca === 'IN_TRUC')
        .sort((a, b) => new Date(b.thoi_gian).getTime() - new Date(a.thoi_gian).getTime())[0];

      const latestOut = latestIn && completedInIds.has(latestIn.id)
        ? dayRecords.find((r) => r.loai_ca === 'OUT' && r.in_record_id === latestIn.id) ?? null
        : null;

      const types = dayRecords.map((r) => r.loai_ca);
      const hasNghiPhepSang = types.includes('NGHI_PHEP_SANG');
      const hasNghiPhepChieu = types.includes('NGHI_PHEP_CHIEU');
      const hasNghiPhep = types.some((t) => ['NGHI_PHEP', 'NGHI_PHEP_SANG', 'NGHI_PHEP_CHIEU'].includes(t));
      const hasNghiBu = types.includes('NGHI_BU');
      const hasPairedIn = latestIn && latestOut;
      const isTCApproved = latestIn?.ghi_chu?.includes('[TC_APPROVED]');

      let finalSymbol = '';

      if (summary) {
        finalSymbol = summary.payroll_symbol ?? '';
        if (isHanhChinh) {
          tongCongMinutes += finalSymbol === 'NL' ? CA_DU_PHUT : Math.max(0, summary.work_minutes ?? 0);
        } else if ((summary.work_minutes ?? 0) > 0) {
          tongCongDays += Math.min(1, (summary.work_minutes ?? 0) / CA_DU_PHUT);
        }
      } else if (hasPairedIn) {
        if (hasNghiBu) {
          if (isTCApproved) {
            finalSymbol = '+';
            const inTime = new Date(latestIn.thoi_gian).getTime();
            const outTime = new Date(latestOut.thoi_gian).getTime();
            const workedMins = Math.max(0, Math.floor((outTime - inTime) / 60000));
            tongTangCuongMinutes += Math.min(workedMins, 480);
          } else {
            finalSymbol = translateAttendanceSymbol('NGHI_BU');
          }
        } else if (latestIn.loai_ca === 'IN_TRUC') {
          finalSymbol = 'TR';
          tongCongDays += 1;
        } else if (hasNghiPhepSang) {
          finalSymbol = '+/P';
          tongCongMinutes += Math.min(CA_DU_PHUT / 2, CA_DU_PHUT / 2);
        } else if (hasNghiPhepChieu) {
          finalSymbol = 'P/+';
          tongCongMinutes += CA_DU_PHUT / 2;
        } else {
          finalSymbol = '+';
          if (isHanhChinh && latestOut) {
            const inMin = getVNMinutesOfDay(latestIn.thoi_gian);
            const outRaw = getVNMinutesOfDay(latestOut.thoi_gian);
            const outMin = Math.min(outRaw, 17 * 60);
            const overlap = Math.max(0, Math.min(outMin, TRUA_KET_THUC) - Math.max(inMin, TRUA_BAT_DAU));
            const workedMin = Math.max(0, outMin - inMin - overlap);
            tongCongMinutes += workedMin;
          } else {
            tongCongDays += 1;
          }
        }
      } else if (latestIn && !latestOut) {
        const pendingHours = Math.floor((Date.now() - new Date(latestIn.thoi_gian).getTime()) / (1000 * 60 * 60));
        finalSymbol = pendingHours >= 48
          ? translateAttendanceSymbol('KHONG_LUONG')
          : latestIn.loai_ca === 'IN_TRUC' ? 'in·' : 'in';
      } else if (hasNghiPhep || hasNghiBu) {
        const leaveType = types.find((t) =>
          ['NGHI_PHEP', 'NGHI_PHEP_SANG', 'NGHI_PHEP_CHIEU', 'NGHI_OM', 'THAI_SAN', 'NGHI_BU', 'CON_OM', 'KHONG_LUONG', 'CONG_TAC', 'DUONG_SUC', 'NGHIA_VU', 'TAI_NAN'].includes(t),
        );
        if (leaveType === 'NGHI_PHEP_SANG') {
          finalSymbol = 'P/v';
        } else if (leaveType === 'NGHI_PHEP_CHIEU') {
          finalSymbol = 'v/P';
        } else {
          finalSymbol = translateAttendanceSymbol(leaveType || 'NGHI_PHEP');
        }
      } else if (holidaySet.has(day)) {
        finalSymbol = 'NL';
        if (isHanhChinh) tongCongDays += 1;
      } else {
        const dateObj = new Date(Date.UTC(year, month - 1, day));
        const isWeekend = dateObj.getDay() === 0 || dateObj.getDay() === 6;
        finalSymbol = isWeekend ? '-' : '';
      }

      const colNumber = (khoa === 'ALL' ? 6 : 2) + day;
      const cell = sheet.getRow(currentRow).getCell(colNumber);
      cell.value = finalSymbol;
      if (finalSymbol === 'in' || finalSymbol === 'in·') {
        cell.font = { italic: true, color: { argb: 'FF888888' }, size: 8 };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
      } else {
        cell.font = {};
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
      }
    }

    let tongCongValue: string | number;
    if (isHanhChinh) {
      const totalMin = tongCongMinutes + tongCongDays * CA_DU_PHUT;
      const ngayTron = Math.floor(totalMin / CA_DU_PHUT);
      const gioLe = Math.round(((totalMin % CA_DU_PHUT) / 60) * 10) / 10;
      tongCongValue = gioLe > 0 ? `${ngayTron} ngay ${gioLe} gio` : ngayTron;
    } else {
      tongCongValue = tongCongDays;
    }

    if (tongTangCuongMinutes > 0) {
      const tangCuongDays = Math.round((tongTangCuongMinutes / CA_DU_PHUT) * 10) / 10;
      tongCongValue = `${tongCongValue} (TC: ${tangCuongDays} ngày)`;
    }

    sheet.getRow(currentRow).getCell(totalCol).value = tongCongValue;

    sheet.getRow(currentRow).eachCell({ includeEmpty: true }, (cell, colNumber) => {
      if (colNumber <= lastStyledCol) {
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' },
        };
      }
    });
  });

  const buffer = await workbook.xlsx.writeBuffer();
  const filename = khoa === 'ALL'
    ? `BangCong_ToanVien_${monthStr}.xlsx`
    : `BangCong_Khoa${khoa}_${monthStr}.xlsx`;

  return {
    buffer: buffer as ArrayBuffer,
    filename,
    monthStr,
    khoa,
  };
}
