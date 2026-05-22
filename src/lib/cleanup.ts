import { SupabaseClient } from '@supabase/supabase-js';
import { Database } from './database.types';
import { deleteFileFromDrive } from './drive';
import { getTodayVN, getVNMonthRangeUTC } from './timezone';

function extractDriveId(url: string | null): string | null {
  if (!url) return null;
  const match = url.match(/\/d\/([a-zA-Z0-9-_]+)\//);
  return match ? match[1] : null;
}

export async function cleanupSandboxData(admin: SupabaseClient<Database>) {
  const report = {
    db_deleted: 0,
    drive_deleted: 0,
    storage_deleted: 0,
    errors: [] as string[],
  };

  try {
    // 1. Tìm các bản ghi chấm công có is_test = true HOẶC ma_nv LIKE 'NV_TEST_%'
    const { data: testRecords, error: fetchErr } = await admin
      .from('lich_su_cham_cong')
      .select('id, link_anh_minh_chung')
      .or('is_test.eq.true,ma_nv.like.NV_TEST_%');

    if (fetchErr) throw fetchErr;

    if (testRecords && testRecords.length > 0) {
      // 2a. Xóa ảnh trên Google Drive
      for (const record of testRecords) {
        if (record.link_anh_minh_chung) {
          const fileId = extractDriveId(record.link_anh_minh_chung);
          if (fileId) {
            try {
              await deleteFileFromDrive(fileId);
              report.drive_deleted++;
            } catch (e) {
              report.errors.push(`Drive delete ${fileId}: ${e instanceof Error ? e.message : 'unknown'}`);
            }
          }
        }
      }
    }

    // 2b. Xóa ảnh trên Supabase Storage — tìm qua image_sync_jobs
    const { data: syncJobs } = await admin
      .from('image_sync_jobs')
      .select('id, supabase_bucket, supabase_path, source_record_id')
      .neq('sync_status', 'DELETED');

    // Lọc các job thuộc bản ghi test
    const testIds = new Set((testRecords ?? []).map((r) => r.id));
    const testJobs = (syncJobs ?? []).filter((j) => testIds.has(j.source_record_id));

    for (const job of testJobs) {
      try {
        const { error: storageErr } = await admin.storage
          .from(job.supabase_bucket)
          .remove([job.supabase_path]);

        if (!storageErr) {
          report.storage_deleted++;
          await admin
            .from('image_sync_jobs')
            .update({ sync_status: 'DELETED', deleted_at: new Date().toISOString() })
            .eq('id', job.id);
        }
      } catch (e) {
        report.errors.push(`Storage delete ${job.supabase_path}: ${e instanceof Error ? e.message : 'unknown'}`);
      }
    }

    // 3. Xóa dữ liệu Test trong các bảng DB
    const tables = [
      'lich_su_cham_cong',
      'yeu_cau_quan_tri',
      'lich_luan_chuyen',
      'don_nghi_phep',
      'log_gian_lan',
    ] as const;

    for (const table of tables) {
      const { error: delErr, count } = await admin
        .from(table)
        .delete({ count: 'exact' })
        .or('is_test.eq.true,ma_nv.like.NV_TEST_%');

      if (delErr) {
        report.errors.push(`DB delete ${table}: ${delErr.message}`);
      } else {
        report.db_deleted += count ?? 0;
      }
    }

    // 4. Xóa image_sync_jobs của test records
    if (testIds.size > 0) {
      await admin
        .from('image_sync_jobs')
        .delete()
        .in('source_record_id', [...testIds]);
    }

    return { success: true, report };
  } catch (error: unknown) {
    console.error('Cleanup Sandbox Error:', error);
    return { success: false, error, report };
  }
}

export async function archivePreviousMonthAttendance(admin: SupabaseClient<Database>) {
  const today = getTodayVN();
  const currentDay = Number(today.slice(8, 10));
  
  // Chỉ chạy khi từ ngày 10 trở đi trong tháng
  if (currentDay < 10) {
    return { success: true, message: 'Chưa đến ngày 10, chưa chạy dọn dẹp tháng cũ.', archived_count: 0 };
  }

  const currentMonth = today.slice(0, 7); // YYYY-MM
  const { startUTC: currentMonthStartUTC } = getVNMonthRangeUTC(currentMonth);

  try {
    // 1. Lấy tất cả các bản ghi của tháng trước trở về trước (tối đa 1000 bản ghi mỗi lần để tránh quá tải)
    const { data: oldRecords, error: fetchErr } = await admin
      .from('lich_su_cham_cong')
      .select('*')
      .lt('thoi_gian', currentMonthStartUTC)
      .limit(1000);

    if (fetchErr) throw fetchErr;

    if (!oldRecords || oldRecords.length === 0) {
      return { success: true, message: 'Không có dữ liệu tháng cũ cần lưu trữ.', archived_count: 0 };
    }

    // 2. Chèn vào bảng archive
    const archiveData = oldRecords.map(r => ({
      id: r.id,
      thoi_gian: r.thoi_gian,
      ma_nv: r.ma_nv,
      ho_ten: r.ho_ten,
      khoa_ghi_nhan: r.khoa_ghi_nhan,
      loai_ca: r.loai_ca,
      link_anh_minh_chung: r.link_anh_minh_chung,
      ghi_chu: r.ghi_chu,
      ma_co_so: r.ma_co_so,
      is_suspicious: r.is_suspicious,
      in_record_id: r.in_record_id,
      is_test: r.is_test,
      ho_tro_boi: r.ho_tro_boi,
    }));

    const { error: insertErr } = await admin
      .from('lich_su_cham_cong_archive' as any)
      .insert(archiveData);

    if (insertErr) throw insertErr;

    // 3. Xóa các bản ghi cũ ở bảng chính
    const oldIds = oldRecords.map(r => r.id);
    const { error: deleteErr } = await admin
      .from('lich_su_cham_cong')
      .delete()
      .in('id', oldIds);

    if (deleteErr) throw deleteErr;

    return { 
      success: true, 
      message: `Đã lưu trữ thành công ${oldRecords.length} bản ghi tháng cũ.`, 
      archived_count: oldRecords.length 
    };
  } catch (error: any) {
    console.error('Archive Previous Month Attendance Error:', error);
    return { success: false, error: error.message || error, archived_count: 0 };
  }
}

