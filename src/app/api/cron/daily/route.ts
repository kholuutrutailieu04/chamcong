import { NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase';
import { cleanupSandboxData, archivePreviousMonthAttendance } from '@/lib/cleanup';
import { getTodayVN } from '@/lib/timezone';
import { applyDueAutoCloseConfig } from '@/lib/auto-close-open-in';
import { runDueAutoEmailReports } from '@/lib/auto-email-report';
import { recomputeAttendanceSummaryForRecentDays } from '@/lib/attendance-summary';

// Helper: Ensure the API requires a cron secret for security (optional but recommended)
export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization');
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = getAdminClient();
  const today = getTodayVN(); // YYYY-MM-DD theo múi giờ VN (GMT+7)

  try {
    const autoCloseConfig = await applyDueAutoCloseConfig(admin);
    const autoEmailReport = await runDueAutoEmailReports(admin);
    const currentDay = Number(today.slice(8, 10));
    const autoExportReachedReportStep = autoEmailReport.enabled
      && autoEmailReport.due
      && (autoEmailReport.sent + autoEmailReport.failed + autoEmailReport.skipped > 0);
    const shouldRunMaintenance = currentDay >= 10 || autoExportReachedReportStep;

    // 0. Kiểm tra ngày lễ
    const { data: isHoliday } = await admin
      .from('ngay_le')
      .select('ten_ngay_le')
      .eq('ngay', today)
      .maybeSingle();

    // 1. Tim cac don vang (phep, om, thai san...) dang co hieu luc hom nay
    // Doc them buoi_nghi de phan loai nghi theo buoi sang / chieu
    const { data: activeLeaves, error: activeError } = await admin
      .from('don_nghi_phep')
      .select('ma_nv, ho_ten, loai_nghi, buoi_nghi')
      .lte('tu_ngay', today)
      .gte('den_ngay', today);

    if (activeError) throw activeError;

    // 1.5 Tim cac ca nghi bu tu lich nghi bu hom nay
    const { data: restLeaves, error: restError } = await admin
      .from('lich_nghi_bu')
      .select('ma_nv')
      .eq('ngay_nghi', today);

    if (restError) throw restError;

    // Lay them ho_ten cho restLeaves
    const restLogs: { ma_nv: string | null; ho_ten: string | null; loai_nghi: string; buoi_nghi: string }[] = [];
    if (restLeaves && restLeaves.length > 0) {
      const ma_nvs = restLeaves.map((r) => r.ma_nv);
      const { data: empData } = await admin.from('nhan_vien').select('ma_nv, ho_ten').in('ma_nv', ma_nvs);
      if (empData) {
        for (const emp of empData) {
          restLogs.push({ ma_nv: emp.ma_nv, ho_ten: emp.ho_ten, loai_nghi: 'NGHI_BU', buoi_nghi: 'CA_NGAY' });
        }
      }
    }

    // Mang chuan hoa: resolve loai_ca thuc te dua vao loai_nghi + buoi_nghi
    type LeaveRow = { ma_nv: string | null; ho_ten: string | null; loai_nghi: string; buoi_nghi?: string | null };
    const allLeaves: LeaveRow[] = isHoliday ? [] : [...(activeLeaves ?? []), ...restLogs];

    /**
     * Resolve loai_ca thuc te se ghi vao lich_su_cham_cong:
     *   NGHI_PHEP + SANG   -> NGHI_PHEP_SANG
     *   NGHI_PHEP + CHIEU  -> NGHI_PHEP_CHIEU
     *   NGHI_PHEP + CA_NGAY (mac dinh) -> NGHI_PHEP
     *   Cac loai khac (NGHI_OM, THAI_SAN...) -> giu nguyen loai_nghi
     */
    function resolveLoaiCa(loai_nghi: string, buoi_nghi?: string | null): string {
      if (loai_nghi === 'NGHI_PHEP') {
        if (buoi_nghi === 'SANG') return 'NGHI_PHEP_SANG';
        if (buoi_nghi === 'CHIEU') return 'NGHI_PHEP_CHIEU';
      }
      return loai_nghi;
    }

    // 2. Chen log vao lich_su_cham_cong cho tung nhan su
    const logsToInsert = allLeaves.map(leave => ({
      ma_nv: leave.ma_nv,
      ho_ten: leave.ho_ten,
      loai_ca: resolveLoaiCa(leave.loai_nghi, leave.buoi_nghi),
      thoi_gian: `${today}T01:30:00.000Z`,
      is_suspicious: false,
      ghi_chu: '[CRON-BOT] Ghi phep tu dong'
    }));

    // Bo qua cac ca da duoc chen (tranh chay cron nhieu lan bi duplicate)
    // Duplicate-check theo loai_ca da resolve (phan biet NGHI_PHEP_SANG voi NGHI_PHEP_CHIEU)
    let insertedCount = 0;
    for (const log of logsToInsert) {
      if (!log.ma_nv) continue; // Bo qua neu khong co ma_nv
      const { data: existing } = await admin
        .from('lich_su_cham_cong')
        .select('id')
        .eq('ma_nv', log.ma_nv)
        .eq('loai_ca', log.loai_ca)
        .gte('thoi_gian', `${today}T00:00:00.000Z`)
        .lte('thoi_gian', `${today}T23:59:59.000Z`);

      if (!existing || existing.length === 0) {
        await admin.from('lich_su_cham_cong').insert(log);
        insertedCount += 1;
      }
    }

    // 3. Recompute summary gần nhất để hoàn phép theo từng ngày/buổi và làm nền payroll/export.
    const summaryResult = await recomputeAttendanceSummaryForRecentDays(admin, 7);

    // 4. Maintenance chỉ chạy sau mốc an toàn tháng mới, hoặc sau auto export đã sinh báo cáo.
    const cleanupResult = shouldRunMaintenance ? await cleanupSandboxData(admin) : {
      success: true,
      skipped: true,
      message: 'Chưa đến mốc maintenance an toàn.',
    };

    const archiveResult = shouldRunMaintenance
      ? await archivePreviousMonthAttendance(admin, { force: autoExportReachedReportStep })
      : { success: true, skipped: true, message: 'Chưa đến mốc archive an toàn.', archived_count: 0, archived_summary_count: 0 };

    return NextResponse.json({ 
      success: true, 
      message: isHoliday
        ? `Hôm nay là ngày lễ (${isHoliday.ten_ngay_le}), không ghi phép tự động.`
        : allLeaves.length === 0
          ? 'Không có đơn phép/nghỉ bù nào trong hôm nay.'
          : 'Đã xử lý phép/nghỉ bù trong ngày.',
      inserted_count: insertedCount,
      auto_close_open_in: autoCloseConfig,
      auto_email_report: autoEmailReport,
      summary: summaryResult,
      cleanup: cleanupResult,
      archive: archiveResult
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Lỗi chạy cron';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
