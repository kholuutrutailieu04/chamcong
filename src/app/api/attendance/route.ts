/**
 * API: /api/attendance
 *
 * POST: Ghi nhận chấm công (check-in/out)
 * GET:  Kiểm tra trạng thái nhân viên hôm nay
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase';
import { cleanupSyncedSupabaseImages, decodeBase64Image, processImageSyncJobs } from '@/lib/image-sync';
import { uploadAttendanceImageToStorage } from '@/lib/storage';
import { uploadToDriveWithFolderHierarchy } from '@/lib/drive';
import { LEGACY_3CA_CHILD_CODES, is3CaShiftType, normalizeShiftType, SHIFT_TYPE_3CA_PARENT } from '@/lib/shift';
import { calculateAndRecordRest } from '@/lib/rest-logic';
import { autoCloseLatestOpenInForEmployee } from '@/lib/auto-close-open-in';
import { getTodayVN } from '@/lib/timezone';

import {
  findLatestOpenInRecord,
  getSelfCorrectionWindowMinutes,
  isInAttendanceType,
  minutesSince,
} from '@/lib/attendance-correction';
import { haversineMeters } from '@/lib/utils';

type AttendanceType = 'IN_LAM' | 'IN_TRUC' | 'OUT';
type ShiftRow = {
  ma_ca: string;
  gio_bat_dau: string;
  gio_ket_thuc: string;
  vat_qua_nua_dem: boolean | null;
  gio_cho_phep_ve_som: string | null;
};



function parseTimeToMinutes(timeValue: string): number {
  const [hourStr = '0', minuteStr = '0'] = timeValue.split(':');
  return Number(hourStr) * 60 + Number(minuteStr);
}

function getNowMinutesAtVN(): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Ho_Chi_Minh',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? '0');
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? '0');
  return (hour * 60) + minute;
}

function signedMinuteDiff(nowMinutes: number, startMinutes: number): number {
  let diff = nowMinutes - startMinutes;
  if (diff > 720) diff -= 1440;
  if (diff < -720) diff += 1440;
  return diff;
}

function pickNearestShift(shifts: ShiftRow[], nowMinutes: number, toleranceMinutes: number): ShiftRow | null {
  if (shifts.length === 0) return null;

  const scored = shifts.map((shift) => {
    const startMinutes = parseTimeToMinutes(shift.gio_bat_dau);
    const diff = signedMinuteDiff(nowMinutes, startMinutes);
    return { shift, absDiff: Math.abs(diff) };
  });

  const inTolerance = scored
    .filter((item) => item.absDiff <= toleranceMinutes)
    .sort((a, b) => a.absDiff - b.absDiff);

  if (inTolerance.length > 0) return inTolerance[0].shift;

  scored.sort((a, b) => a.absDiff - b.absDiff);
  return scored[0].shift;
}

/**
 * Grace Period: Kiem tra check-out som co hop le khong.
 * Ca truc qua dem co cau hinh gio_cho_phep_ve_som.
 * Neu check-out nam trong [gio_cho_phep_ve_som, gio_ket_thuc] -> hop le.
 * Tra ve so phut vuot GracePeriod (< 0 = qua som, >= 0 = hop le).
 */
function isWithinGracePeriod(nowMinutes: number, shiftEndMinutes: number, gracePeriodStart: string | null): boolean {
  if (!gracePeriodStart) return false; // Khong co grace period -> khong ap dung
  const graceMinutes = parseTimeToMinutes(gracePeriodStart);
  // Hop le neu: graceMinutes <= nowMinutes <= shiftEndMinutes
  // Xu ly truong hop shiftEnd qua nua dem (vi du 09:00 hom sau)
  // Gio hien tai nho hon graceMinutes co the la tinh tu nua dem
  return nowMinutes >= graceMinutes || nowMinutes <= shiftEndMinutes;
}

/**
 * Tinh so phut check-in tre so voi gio bat dau ca Hanh Chinh.
 * Tra ve so phut tre (duong) hoac 0 neu dung gio / som gio.
 * Dung sai cho phep 15 phut.
 */
function calcLateMinutes(nowMinutes: number, shiftStartMinutes: number, toleranceMinutes = 15): number {
  const diff = nowMinutes - shiftStartMinutes;
  return diff > toleranceMinutes ? diff : 0;
}

async function resolve3CaChildShift(admin: ReturnType<typeof getAdminClient>): Promise<ShiftRow | null> {
  const nowMinutes = getNowMinutesAtVN();
  const toleranceMinutes = 90;

  const { data: byParent, error: byParentError } = await admin
    .from('cau_hinh_ca_truc')
    .select('ma_ca, gio_bat_dau, gio_ket_thuc, vat_qua_nua_dem, gio_cho_phep_ve_som')
    .eq('ma_ca_cha', SHIFT_TYPE_3CA_PARENT);

  if (!byParentError && byParent && byParent.length > 0) {
    return pickNearestShift(byParent as ShiftRow[], nowMinutes, toleranceMinutes);
  }

  const { data: byLegacyCodes, error: legacyError } = await admin
    .from('cau_hinh_ca_truc')
    .select('ma_ca, gio_bat_dau, gio_ket_thuc, vat_qua_nua_dem, gio_cho_phep_ve_som')
    .in('ma_ca', [...LEGACY_3CA_CHILD_CODES]);

  if (legacyError || !byLegacyCodes || byLegacyCodes.length === 0) return null;
  return pickNearestShift(byLegacyCodes as ShiftRow[], nowMinutes, toleranceMinutes);
}

export async function GET(req: NextRequest) {
  const emp_id = req.nextUrl.searchParams.get('emp_id');
  if (!emp_id) {
    return NextResponse.json({ error: 'Thiếu emp_id' }, { status: 400 });
  }

  const admin = getAdminClient();
  const past48h = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

  const { data: employee } = await admin
    .from('nhan_vien')
    .select('ho_ten, khoa_phong, dm_khoa_phong(ten_khoa)')
    .eq('ma_nv', emp_id)
    .single();

  const { data: recentRecords } = await admin
    .from('lich_su_cham_cong')
    .select('id, loai_ca, thoi_gian, in_record_id')
    .eq('ma_nv', emp_id)
    .gte('thoi_gian', past48h)
    .order('thoi_gian', { ascending: false });

  let showButtons: AttendanceType[] = ['IN_LAM', 'IN_TRUC'];

  if (recentRecords && recentRecords.length > 0) {
    const lastRecord = recentRecords[0];
    if ((lastRecord.loai_ca === 'IN_LAM' || lastRecord.loai_ca === 'IN_TRUC') && lastRecord.thoi_gian) {
      showButtons = ['OUT', 'IN_LAM', 'IN_TRUC'];
    }
  }

  let selfCorrection: {
    can_correct: boolean;
    record_id: string;
    current_type: 'IN_LAM' | 'IN_TRUC';
    window_minutes: number;
    minutes_since_checkin: number;
    expires_in_minutes: number;
  } | null = null;

  const latestOpenIn = await findLatestOpenInRecord(admin, emp_id);
  if (latestOpenIn && latestOpenIn.thoi_gian && isInAttendanceType(latestOpenIn.loai_ca)) {
    const windowMinutes = await getSelfCorrectionWindowMinutes(admin);
    const elapsedMinutes = minutesSince(latestOpenIn.thoi_gian);
    const canCorrect = elapsedMinutes <= windowMinutes;
    selfCorrection = {
      can_correct: canCorrect,
      record_id: latestOpenIn.id,
      current_type: latestOpenIn.loai_ca,
      window_minutes: windowMinutes,
      minutes_since_checkin: elapsedMinutes,
      expires_in_minutes: Math.max(0, windowMinutes - elapsedMinutes),
    };
  }

  const { data: rejectedRecords } = await admin
    .from('lich_su_cham_cong')
    .select('id, thoi_gian, loai_ca, ghi_chu, in_record_id')
    .eq('ma_nv', emp_id)
    .ilike('ghi_chu', '%[TC_REJECTED:%')
    .order('thoi_gian', { ascending: false })
    .limit(3);

  return NextResponse.json({
    employee: employee ?? null,
    show_buttons: showButtons,
    records_recent: recentRecords ?? [],
    self_correction: selfCorrection,
    rejected_special: rejectedRecords ?? [],
  });
}

export async function POST(req: NextRequest) {
  const admin = getAdminClient();

  try {
    const body = await req.json();
    const { emp_id, type, image, gps, is_suspicious: clientSuspicious, device_id, gps_accuracy } = body as {
      emp_id: string;
      type: AttendanceType;
      image: string;
      gps: string;
      is_suspicious: boolean;
      device_id?: string;
      gps_accuracy?: number;
    };

    if (!emp_id || !type || !image || !gps) {
      return NextResponse.json({ error: 'Thiếu thông tin bắt buộc' }, { status: 400 });
    }

    const [latStr, lonStr] = gps.split(',');
    const userLat = parseFloat(latStr);
    const userLon = parseFloat(lonStr);

    if (isNaN(userLat) || isNaN(userLon)) {
      return NextResponse.json({ error: 'Tọa độ GPS sai định dạng' }, { status: 400 });
    }

    const { data: employee } = await admin
      .from('nhan_vien')
      .select('ho_ten, khoa_phong, trang_thai, loai_truc_mac_dinh, ma_co_so_mac_dinh, cho_phep_di_chuyen_tu_do')
      .eq('ma_nv', emp_id)
      .single();

    if (!employee || !employee.trang_thai) {
      return NextResponse.json({ error: 'Tài khoản không hợp lệ' }, { status: 403 });
    }

    // --- CHỐNG SPAM CHẤM CÔNG (DUPLICATE CHECK TRONG 10 GIÂY) ---
    const tenSecondsAgo = new Date(Date.now() - 10000).toISOString();
    const { data: duplicateCheck } = await admin
      .from('lich_su_cham_cong')
      .select('id')
      .eq('ma_nv', emp_id)
      .eq('loai_ca', type)
      .gte('thoi_gian', tenSecondsAgo)
      .limit(1);

    if (duplicateCheck && duplicateCheck.length > 0) {
      return NextResponse.json({ error: 'Thao tác quá nhanh. Vui lòng đợi 10 giây giữa các lần nhấn.' }, { status: 409 });
    }

    // --- KIỂM TRA GIAN LẬN THIẾT BỊ & GPS SPOOFING ---
    let finalSuspicious = clientSuspicious;
    let loaiGianLan: string | null = null;
    let ghiChuGianLan: string | null = null;
    let maNvKeGian: string | null = null;
    let khoaKeGian: string | null = null;

    // 1. Kiểm tra GPS Accuracy
    if (gps_accuracy === 0) {
      finalSuspicious = true;
      loaiGianLan = 'GPS_SPOOFING';
      ghiChuGianLan = 'Độ chính xác định vị GPS bằng 0 (Nghi ngờ giả lập/Fake GPS)';
    }

    // 2. Kiểm tra Thiết bị
    if (!device_id) {
      finalSuspicious = true;
      if (!loaiGianLan) {
        loaiGianLan = 'THIET_BI_LA';
        ghiChuGianLan = 'Không gửi device_id từ trình duyệt (Xóa cache hoặc dùng trình duyệt ẩn danh)';
      } else {
        ghiChuGianLan += ' | Không gửi device_id từ trình duyệt';
      }
    } else {
      const { data: devRecords } = await admin
        .from('thiet_bi_nhan_vien')
        .select('ma_nv, is_active')
        .eq('device_id', device_id);

      const isOwnActive = devRecords?.find(d => d.ma_nv === emp_id && d.is_active);
      const isOtherOwner = devRecords?.find(d => d.ma_nv !== emp_id);

      if (!isOwnActive) {
        finalSuspicious = true;
        if (isOtherOwner) {
          if (!loaiGianLan) {
            loaiGianLan = 'SHARED_DEVICE_FRAUD';
            ghiChuGianLan = `Dùng chung thiết bị với nhân viên ${isOtherOwner.ma_nv}`;
          } else {
            ghiChuGianLan += ` | Dùng chung thiết bị với nhân viên ${isOtherOwner.ma_nv}`;
          }
          maNvKeGian = isOtherOwner.ma_nv;
        } else {
          if (!loaiGianLan) {
            loaiGianLan = 'THIET_BI_LA';
            ghiChuGianLan = 'Thiết bị chưa được đăng ký OTP hoặc đã bị vô hiệu hóa do vượt quota';
          } else {
            ghiChuGianLan += ' | Thiết bị chưa đăng ký hoặc bị vô hiệu hóa';
          }
        }
      }
    }

    // Tự động phân giải khoa của kẻ gian nếu phát hiện dùng chung thiết bị
    if (maNvKeGian) {
      const { data: keGianEmp } = await admin
        .from('nhan_vien')
        .select('khoa_phong')
        .eq('ma_nv', maNvKeGian)
        .single();

      if (keGianEmp) {
        khoaKeGian = keGianEmp.khoa_phong;
        const today = getTodayVN();
        const { data: keGianRotations } = await admin
          .from('lich_luan_chuyen')
          .select('khoa_den')
          .eq('ma_nv', maNvKeGian)
          .lte('tu_ngay', today)
          .or(`den_ngay.is.null,den_ngay.gte.${today}`)
          .order('tu_ngay', { ascending: false })
          .limit(1);

        if (keGianRotations && keGianRotations.length > 0) {
          khoaKeGian = keGianRotations[0].khoa_den;
        }
      }
    }

    const { data: campuses } = await admin
      .from('co_so')
      .select('ma_co_so, latitude, longitude, ban_kinh_met')
      .eq('trang_thai', true);

    let detectedCampus: string | null = null;
    for (const campus of campuses ?? []) {
      const dist = haversineMeters(userLat, userLon, campus.latitude, campus.longitude);
      if (dist <= campus.ban_kinh_met) {
        detectedCampus = campus.ma_co_so;
        break;
      }
    }

    if (!detectedCampus) {
      return NextResponse.json({ error: 'Bạn đang ở ngoài khuôn viên bệnh viện.' }, { status: 403 });
    }

    const today = getTodayVN();
    const { data: rotation } = await admin
      .from('lich_luan_chuyen')
      .select('khoa_den, loai_truc_moi, ma_co_so_dich')
      .eq('ma_nv', emp_id)
      .lte('tu_ngay', today)
      .or(`den_ngay.is.null,den_ngay.gte.${today}`)
      .order('tu_ngay', { ascending: false })
      .limit(1)
      .single();

    const khoaGhiNhan = rotation?.khoa_den ?? employee.khoa_phong;
    const allowedCampusOverride = rotation?.ma_co_so_dich ?? null;
    const effectiveShiftType = normalizeShiftType(rotation?.loai_truc_moi ?? employee.loai_truc_mac_dinh);

    if (allowedCampusOverride) {
      if (detectedCampus !== allowedCampusOverride) {
        return NextResponse.json(
          { error: `Bạn đang trong lịch luân chuyển tại ${allowedCampusOverride}. Vui lòng chấm công tại đúng cơ sở này.` },
          { status: 403 },
        );
      }
    } else if (!employee.cho_phep_di_chuyen_tu_do) {
      const requiredCampus = employee.ma_co_so_mac_dinh || 'CS1';
      if (detectedCampus !== requiredCampus) {
        return NextResponse.json(
          { error: `Bạn không có quyền chấm công ngoài cơ sở mặc định (${requiredCampus}). Vui lòng liên hệ TCCB.` },
          { status: 403 },
        );
      }
    }

    const nowTimeISO = new Date().toISOString();
    let oldInRecordIdToLink: string | null = null;
    let matchedShiftCode: string | null = null;

    if ((type === 'IN_LAM' || type === 'IN_TRUC') && is3CaShiftType(effectiveShiftType)) {
      const matchedShift = await resolve3CaChildShift(admin);
      matchedShiftCode = matchedShift?.ma_ca ?? null;
    }

    if (type === 'IN_LAM' || type === 'IN_TRUC') {
      await autoCloseLatestOpenInForEmployee(admin, {
        maNv: emp_id,
        closeAtISO: nowTimeISO,
        maCoSo: detectedCampus,
        note: '[HỆ THỐNG] Tự động OUT do Check-in ca mới',
        isTest: emp_id.startsWith('NV_TEST_'),
      });
    } // end if IN_LAM || IN_TRUC

    let closestInRecord: { id: string; loai_ca: string; ghi_chu: string | null } | null = null;
    if (type === 'OUT') {
      const { data: closestIn } = await admin
        .from('lich_su_cham_cong')
        .select('id, loai_ca, ghi_chu')
        .eq('ma_nv', emp_id)
        .in('loai_ca', ['IN_LAM', 'IN_TRUC'])
        .order('thoi_gian', { ascending: false })
        .limit(1);
      if (closestIn && closestIn.length > 0) {
        oldInRecordIdToLink = closestIn[0].id;
        closestInRecord = closestIn[0] as { id: string; loai_ca: string; ghi_chu: string | null };
      }
    }

    // ── Grace Period: Kiem tra check-out som cho ca truc qua dem ──────────────
    // Neu type=OUT va ca IN tuong ung la IN_TRUC, kiem tra gio_cho_phep_ve_som
    if (type === 'OUT' && closestInRecord?.loai_ca === 'IN_TRUC') {
      // Lay cau hinh ca truc hien tai de kiem tra grace period
      const shiftCode = effectiveShiftType ?? employee.loai_truc_mac_dinh;
      if (shiftCode) {
        const { data: shiftCfg } = await admin
          .from('cau_hinh_ca_truc')
          .select('gio_ket_thuc, gio_cho_phep_ve_som')
          .eq('ma_ca', shiftCode)
          .single();
        if (shiftCfg?.gio_cho_phep_ve_som) {
          const nowVnMin = getNowMinutesAtVN();
          const shiftEndMin = parseTimeToMinutes(shiftCfg.gio_ket_thuc);
          const graceOk = isWithinGracePeriod(nowVnMin, shiftEndMin, shiftCfg.gio_cho_phep_ve_som);
          if (!graceOk) {
            // Check-out truoc ca grace period -> tra loi
            return NextResponse.json(
              { error: 'Check-out qua som. Ca truc nay cho phep ve som tu ' + shiftCfg.gio_cho_phep_ve_som.substring(0, 5) + '.' },
              { status: 400 },
            );
          }
        }
      }
    }

    // Xay dung ghi_chu truoc khi insert: 3 ca kip va/hoac di tre Hanh Chinh
    let ghi_chu: string | null = matchedShiftCode ? `[HE THONG] Tu nhan dien ca 3 kip: ${matchedShiftCode}` : null;

    if (type === 'IN_LAM' && effectiveShiftType === 'HANH_CHINH') {
      const { data: hcShift } = await admin
        .from('cau_hinh_ca_truc')
        .select('gio_bat_dau')
        .eq('ma_ca', 'HANH_CHINH')
        .single();
      if (hcShift?.gio_bat_dau) {
        const nowVnMin = getNowMinutesAtVN();
        const shiftStartMin = parseTimeToMinutes(hcShift.gio_bat_dau);
        const lateMin = calcLateMinutes(nowVnMin, shiftStartMin);
        if (lateMin > 0) {
          const lateSuffix = `[DI TRE ${lateMin} phut]`;
          ghi_chu = ghi_chu ? `${ghi_chu} | ${lateSuffix}` : lateSuffix;
        }
      }
    }

    const { data: record, error: recordError } = await admin
      .from('lich_su_cham_cong')
      .insert({
        ma_nv: emp_id,
        ho_ten: employee.ho_ten,
        khoa_ghi_nhan: khoaGhiNhan,
        loai_ca: type,
        ma_co_so: detectedCampus,
        is_suspicious: finalSuspicious ?? false,
        thoi_gian: nowTimeISO,
        in_record_id: oldInRecordIdToLink,
        is_test: emp_id.startsWith('NV_TEST_'),
        ghi_chu: ghi_chu,
      })
      .select('id')
      .single();

    if (recordError) throw recordError;

    if (type === 'OUT' && closestInRecord?.loai_ca === 'IN_TRUC') {
      let outShiftCode = effectiveShiftType;
      if (closestInRecord.ghi_chu && closestInRecord.ghi_chu.includes('ca 3 kíp:')) {
         const match = closestInRecord.ghi_chu.match(/ca 3 kíp: (\w+)/);
         if (match && match[1]) outShiftCode = match[1];
      }
      if (outShiftCode) {
         await calculateAndRecordRest(admin, emp_id, outShiftCode, nowTimeISO, khoaGhiNhan).catch(console.error);
      }
    }

    // ────────────────────────────────────────────────────────────
    // Luồng Song Mã: Supabase Storage (Backup) + Google Drive (Primary)
    // ────────────────────────────────────────────────────────────

    // Bước 1: Upload lên Supabase Storage làm bản dự phòng tạm thời
    const storageUpload = await uploadAttendanceImageToStorage(admin, {
      recordId: record.id,
      empId: emp_id,
      type,
      isTest: emp_id.startsWith('NV_TEST_'),
      rawBase64: image,
    });


    await admin
      .from('lich_su_cham_cong')
      .update({ link_anh_minh_chung: storageUpload.publicUrl })
      .eq('id', record.id);

    // Lấy ngày giờ theo múi giờ Việt Nam (GMT+7)
    const vnDate = new Date(new Date().getTime() + 7 * 60 * 60 * 1000);
    const yearStr = String(vnDate.getUTCFullYear());
    const monthStr = String(vnDate.getUTCMonth() + 1).padStart(2, '0');
    const dayStr = String(vnDate.getUTCDate()).padStart(2, '0');
    const hourStr = String(vnDate.getUTCHours()).padStart(2, '0');
    const minuteStr = String(vnDate.getUTCMinutes()).padStart(2, '0');
    const secondStr = String(vnDate.getUTCSeconds()).padStart(2, '0');

    const driveFolderHint = emp_id.startsWith('NV_TEST_')
      ? `SANDBOX_TEST_FILES/${detectedCampus}/${khoaGhiNhan}/Ngay_${dayStr}`
      : `Thang_${Number(monthStr)}_${yearStr}/${detectedCampus}/${khoaGhiNhan}/Ngay_${dayStr}`;

    const driveFileName = `${emp_id}_${yearStr}${monthStr}${dayStr}_${hourStr}${minuteStr}${secondStr}.${storageUpload.mimeType.includes('png') ? 'png' : 'jpg'}`;

    // Bước 2: Thử đẩy thẳng lên Drive ngay lập tức
    let directDriveSuccess = false;
    let directDriveLink: string | null = null;

    try {
      const decoded = decodeBase64Image(image);
      const imgBuffer = Buffer.from(decoded.buffer);

      directDriveLink = await uploadToDriveWithFolderHierarchy(
        imgBuffer,
        driveFileName,
        storageUpload.mimeType,
        driveFolderHint,
      );
      directDriveSuccess = true;
    } catch (driveErr) {
      console.warn('[Drive] Direct upload failed, will fallback to async worker:', driveErr);
    }

    if (directDriveSuccess && directDriveLink) {
      // ── Luồng thành công: Ghi link Drive vào DB, xóa Supabase ngay ──
      await admin
        .from('lich_su_cham_cong')
        .update({ link_anh_minh_chung: directDriveLink })
        .eq('id', record.id);

      // Xóa file Supabase ngay lập tức (bỏ qua 24h retention)
      await admin.storage.from(storageUpload.bucket).remove([storageUpload.path]);

      // Ghi job đã SYNCED để lịch sử đầy đủ, không cần worker xử lý
      await admin.from('image_sync_jobs').upsert(
        {
          source_record_id: record.id,
          supabase_bucket: storageUpload.bucket,
          supabase_path: storageUpload.path,
          supabase_public_url: storageUpload.publicUrl,
          drive_file_name: driveFileName,
          drive_folder_hint: driveFolderHint,
          sync_status: 'SYNCED',
          next_retry_at: new Date().toISOString(),
          attempt_count: 0,
          max_attempts: 12,
          last_error: null,
          drive_link: directDriveLink,
          synced_at: new Date().toISOString(),
          // Đặt delete_after = now vì đã xóa rồi
          delete_after: new Date().toISOString(),
          deleted_at: new Date().toISOString(),
        },
        { onConflict: 'source_record_id' },
      );
    } else {
      // ── Luồng dự phòng: Giữ link Supabase, enqueue job để worker thử lại ──
      await admin.from('image_sync_jobs').upsert(
        {
          source_record_id: record.id,
          supabase_bucket: storageUpload.bucket,
          supabase_path: storageUpload.path,
          supabase_public_url: storageUpload.publicUrl,
          drive_file_name: driveFileName,
          drive_folder_hint: driveFolderHint,
          sync_status: 'PENDING',
          next_retry_at: new Date().toISOString(),
          attempt_count: 0,
          max_attempts: 12,
          last_error: null,
          drive_link: null,
          synced_at: null,
          delete_after: null,
          deleted_at: null,
        },
        { onConflict: 'source_record_id' },
      );

      // Khởi động worker nền để thử đẩy Drive theo tiến trình bất đồng bộ
      setImmediate(async () => {
        try {
          await processImageSyncJobs(admin, 2);
          await cleanupSyncedSupabaseImages(admin, 2);
        } catch {
          // noop - worker sẽ tự retry sau
        }
      });
    }

    // Ghi log gian lận nếu có
    if (finalSuspicious) {
      await admin.from('log_gian_lan').insert({
        ma_nv_bi_ho: emp_id,
        ho_ten_bi_ho: employee.ho_ten,
        khoa_bi_ho: khoaGhiNhan,
        link_anh_ke_gian: directDriveLink ?? storageUpload.publicUrl,
        is_test: emp_id.startsWith('NV_TEST_'),
        loai_gian_lan: loaiGianLan ?? 'KHONG_XAC_DINH',
        id_thiet_bi: device_id ?? 'KHONG_CO',
        ghi_chu: ghiChuGianLan,
        ma_nv_ke_gian: maNvKeGian,
        khoa_ke_gian: khoaKeGian,
      });
    }

    return NextResponse.json({
      success: true,
      message: 'Thành công',
      data: { name: employee.ho_ten, type, matched_shift: matchedShiftCode, record_id: record.id },
    });
  } catch {
    return NextResponse.json({ error: 'Lỗi máy chủ' }, { status: 500 });
  }
}
