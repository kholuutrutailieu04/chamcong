import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase';
import ExcelJS from 'exceljs';
import { translateAttendanceSymbol, getDaysInMonth } from '@/lib/utils';
import { normalizeCampusCode } from '@/lib/campus';
import { getVNMonthRangeUTC, toVNDateString } from '@/lib/timezone';
import path from 'path';
import fs from 'fs';

function normalizeHeaderMonth(input: string, month: number, year: number): string {
  return input
    .replace(/tháng\s+\d+(?:[./-]\d{4})?/i, `Tháng ${month}.${year}`)
    .replace(/năm\s+\d{4}/i, `năm ${year}`);
}

function toDateLabel(monthStr: string): string {
  const [year, month] = monthStr.split('-');
  return `Tháng ${Number(month)}.${year}`;
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

export async function GET(req: NextRequest) {
  const khoa = req.nextUrl.searchParams.get('khoa') || 'ALL';
  const monthStr = req.nextUrl.searchParams.get('month');
  const requestEmail = req.headers.get('x-user-email') || '';

  if (requestEmail.toLowerCase().startsWith('test_')) {
    return NextResponse.json(
      { error: 'Chức năng xuất báo cáo không khả dụng cho tài khoản chạy thử (Sandbox Mode).' },
      { status: 403 },
    );
  }

  if (!monthStr) {
    return NextResponse.json({ error: 'Cần chỉ định tháng (YYYY-MM)' }, { status: 400 });
  }

  const [year, month] = monthStr.split('-').map(Number);
  const admin = getAdminClient();

  try {
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

    // Phân trang để vượt qua giới hạn 1000 dòng mặc định của Supabase
    type EmpRow = {
      ma_nv: string | null;
      ho_ten: string | null;
      khoa_phong: string | null;
      loai_truc_mac_dinh: string | null;
      trang_thai: boolean | null;
      ma_co_so_mac_dinh: string | null;
    };
    const allEmployees: EmpRow[] = [];
    const PAGE_SIZE = 1000;
    let pageFrom = 0;
    while (true) {
      const { data: page, error: pageErr } = await empQuery.range(pageFrom, pageFrom + PAGE_SIZE - 1);
      if (pageErr) throw pageErr;
      if (!page || page.length === 0) break;
      allEmployees.push(...(page as EmpRow[]));
      if (page.length < PAGE_SIZE) break;
      pageFrom += PAGE_SIZE;
    }

    const employees = allEmployees
      .sort((a, b) => {
        const campusA = normalizeCampusCode(a.ma_co_so_mac_dinh);
        const campusB = normalizeCampusCode(b.ma_co_so_mac_dinh);
        if (campusA !== campusB) return campusA.localeCompare(campusB);
        return (a.ho_ten ?? '').localeCompare(b.ho_ten ?? '', 'vi');
      });


    if (employees.length === 0) {
      return NextResponse.json({ error: 'Không tìm thấy nhân sự nào.' }, { status: 404 });
    }

    const { startUTC, endUTC } = getVNMonthRangeUTC(monthStr);
    const startDate = new Date(startUTC);
    const endDate = new Date(endUTC);

    const startDateStr = `${year}-${String(month).padStart(2, '0')}-01`;
    const endDateStr = new Date(Date.UTC(year, month, 0)).toISOString().split('T')[0];

    // Lấy ngày lễ trong tháng
    const { data: holidaysData } = await admin
      .from('ngay_le')
      .select('ngay')
      .gte('ngay', startDateStr)
      .lte('ngay', endDateStr);
      
    const holidaySet = new Set(holidaysData?.map(h => Number(h.ngay.split('-')[2])) || []);

    // Phân trang lấy toàn bộ lịch sử chấm công trong tháng
    type RawRecord = { id: string; ma_nv: string | null; loai_ca: string | null; thoi_gian: string | null; in_record_id: string | null; ghi_chu: string | null; };
    const allRecords: RawRecord[] = [];
    let recFrom = 0;
    while (true) {
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
      recFrom += PAGE_SIZE;
    }

    // cấu trúc: recordMap[ma_nv][day] = mảng các record (kể cả OUT)
    type DayRecord = { id: string; loai_ca: string; thoi_gian: string; in_record_id: string | null; ghi_chu: string | null; };
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


    const templatePath = path.join(process.cwd(), 'public', 'templates', 'Mau Bang cham cong 2026.xlsx');
    const workbook = new ExcelJS.Workbook();

    if (fs.existsSync(templatePath)) {
      await workbook.xlsx.readFile(templatePath);
    } else {
      throw new Error('Không tìm thấy file mẫu Excel tại public/templates/');
    }

    const sheet = workbook.worksheets[0];
    sheet.name = `BangCong_${monthStr}`;

    // Header chuẩn theo tháng + khoa
    for (let row = 1; row <= 10; row++) {
      for (let col = 1; col <= 20; col++) {
        const cell = sheet.getRow(row).getCell(col);
        if (typeof cell.value === 'string') {
          let text = normalizeHeaderMonth(cell.value, month, year);
          if (khoa === 'ALL') {
            text = text.replace(/Khoa\s*(\.{2,}|_+)/i, 'Khoa: Tất cả');
          } else if (tenKhoaExport) {
            text = text.replace(/Khoa\s*(\.{2,}|_+)/i, `Khoa: ${tenKhoaExport}`);
          }
          cell.value = text;
        }
      }
    }
    sheet.getCell('H2').value = toDateLabel(monthStr);

    // Admin xuất toàn viện: thêm cột Mã NV + Khoa phòng trước cột Họ tên
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
    const templateDataRows = 10; // rows 7..16
    const footerAnchorRow = dataStartRow + templateDataRows; // row 17 ("Cộng")
    const extraRows = Math.max(0, employees.length - templateDataRows);
    if (extraRows > 0) {
      sheet.spliceRows(footerAnchorRow, 0, ...Array.from({ length: extraRows }, () => []));
    }

    const totalCol = (khoa === 'ALL' ? 6 : 2) + 32;
    const lastStyledCol = (khoa === 'ALL' ? 40 : 34);

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

      // tongCongMinutes: Tich luy so phut lam viec thuc te (chi dung cho Hanh Chinh)
      // tongCongDays: Dem so ngay di lam day du (ca truc, hoac ngay HC khong di tre)
      let tongCongMinutes = 0; // Dung cho HC tinh gio tich luy
      let tongCongDays = 0;    // Dung cho ca truc va HC tinh ngay tron ven
      let tongTangCuongMinutes = 0; // Dung cho Cong Tang Cuong
      const isHanhChinh = emp.loai_truc_mac_dinh === 'HANH_CHINH';

      // Hang so khung gio nghi trua (tinh theo phut tu 0h00)
      const TRUA_BAT_DAU = 11 * 60 + 30; // 11:30 = 690 phut
      const TRUA_KET_THUC = 13 * 60;     // 13:00 = 780 phut
      const CA_DU_PHUT = 8 * 60;         // 8 tieng = 480 phut

      for (const day of daysInMonth) {
        const dayRecords = emp.ma_nv ? (recordMap[emp.ma_nv]?.[day] || []) : [];

        // Tap hop cac IN_RECORD_ID da co OUT khu
        const completedInIds = new Set(
          dayRecords
            .filter((r) => r.loai_ca === 'OUT' && r.in_record_id)
            .map((r) => r.in_record_id as string)
        );

        // Tim record IN moi nhat
        const latestIn = dayRecords
          .filter((r) => r.loai_ca === 'IN_LAM' || r.loai_ca === 'IN_TRUC')
          .sort((a, b) => new Date(b.thoi_gian).getTime() - new Date(a.thoi_gian).getTime())[0];

        // Tim record OUT tuong ung
        const latestOut = latestIn && completedInIds.has(latestIn.id)
          ? dayRecords.find((r) => r.loai_ca === 'OUT' && r.in_record_id === latestIn.id) ?? null
          : null;

        const types = dayRecords.map((r) => r.loai_ca);
        const hasNghiPhepSang = types.includes('NGHI_PHEP_SANG');
        const hasNghiPhepChieu = types.includes('NGHI_PHEP_CHIEU');
        const hasNghiPhep = types.some((t) => ['NGHI_PHEP', 'NGHI_PHEP_SANG', 'NGHI_PHEP_CHIEU'].includes(t));
        const hasNghiBu = types.includes('NGHI_BU');
        const hasPairedIn = latestIn && latestOut; // Co cap IN-OUT hop le
        const isTCApproved = latestIn?.ghi_chu?.includes('[TC_APPROVED]');

        let finalSymbol = '';

        if (hasPairedIn) {
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
          } else {
            // Co check-in hop le
            if (latestIn.loai_ca === 'IN_TRUC') {
              finalSymbol = 'TR';
              tongCongDays += 1;
            } else {
            // IN_LAM (Hanh Chinh)
            if (hasNghiPhepSang) {
              // Sang nghi phep, chieu di lam co check-in -> +/P (sang nghi, chieu lam)
              finalSymbol = '+/P';
              // Chi tinh 0.5 ngay cong -> 240 phut
              tongCongMinutes += Math.min(CA_DU_PHUT / 2, CA_DU_PHUT / 2);
            } else if (hasNghiPhepChieu) {
              // Chieu nghi phep, sang di lam co check-in -> P/+ (sang lam, chieu nghi)
              finalSymbol = 'P/+';
              tongCongMinutes += CA_DU_PHUT / 2;
            } else {
              // Di lam ca ngay (co the di tre)
              finalSymbol = '+';
              if (isHanhChinh && latestOut) {
                // Tinh gio lam thuc te (co tru nghi trua neu thich hop)
                const inMin = getVNMinutesOfDay(latestIn.thoi_gian);
                const outRaw = getVNMinutesOfDay(latestOut.thoi_gian);
                const outMin = Math.min(outRaw, 17 * 60); // Khong tinh qua 17:00
                const overlap = Math.max(0, Math.min(outMin, TRUA_KET_THUC) - Math.max(inMin, TRUA_BAT_DAU));
                const workedMin = Math.max(0, outMin - inMin - overlap);
                tongCongMinutes += workedMin;
              } else {
                tongCongDays += 1;
              }
            }
          }
        }
        } else if (latestIn && !latestOut) {
          const pendingHours = Math.floor((Date.now() - new Date(latestIn.thoi_gian).getTime()) / (1000 * 60 * 60));
          finalSymbol = pendingHours >= 48
            ? translateAttendanceSymbol('KHONG_LUONG')
            : latestIn.loai_ca === 'IN_TRUC' ? 'in·' : 'in';
        } else if (hasNghiPhep || hasNghiBu) {
          // Khong co check-in nhung co don nghi / nghi bu
          const leaveType = types.find((t) =>
            ['NGHI_PHEP', 'NGHI_PHEP_SANG', 'NGHI_PHEP_CHIEU', 'NGHI_OM', 'THAI_SAN', 'NGHI_BU', 'CON_OM', 'KHONG_LUONG', 'CONG_TAC', 'DUONG_SUC', 'NGHIA_VU', 'TAI_NAN'].includes(t)
          );
          if (leaveType === 'NGHI_PHEP_SANG') {
            // Don nghi sang nhung khong check-in chieu -> sang nghi, chieu vang
            finalSymbol = 'P/v';
          } else if (leaveType === 'NGHI_PHEP_CHIEU') {
            // Don nghi chieu nhung khong check-in sang -> sang vang, chieu nghi
            finalSymbol = 'v/P';
          } else {
            finalSymbol = translateAttendanceSymbol(leaveType || 'NGHI_PHEP');
          }
        } else {
          if (holidaySet.has(day)) {
            finalSymbol = 'NL';
            if (isHanhChinh) tongCongDays += 1;
          } else {
            const dateObj = new Date(Date.UTC(year, month - 1, day));
            const isWeekend = dateObj.getDay() === 0 || dateObj.getDay() === 6;
            finalSymbol = isWeekend ? '-' : '';
          }
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

      // Tinh tong cong cuoi hang
      let tongCongValue: string | number;
      if (isHanhChinh) {
        // Hanh Chinh: cong don so ngay tron (tu ca truc neu co) voi so phut tich luy
        const totalMin = tongCongMinutes + tongCongDays * CA_DU_PHUT;
        const ngayTron = Math.floor(totalMin / CA_DU_PHUT);
        const gioLe = Math.round((totalMin % CA_DU_PHUT) / 60 * 10) / 10;
        if (gioLe > 0) {
          tongCongValue = `${ngayTron} ngay ${gioLe} gio`;
        } else {
          tongCongValue = ngayTron;
        }
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

    return new NextResponse(buffer as ArrayBuffer, {
      status: 200,
      headers: {
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      },
    });
  } catch (error: unknown) {
    console.error('Export Error:', error);
    return NextResponse.json({ error: 'Lỗi sinh báo cáo' }, { status: 500 });
  }
}
