import { SupabaseClient } from '@supabase/supabase-js';
import { Database } from './database.types';
import { deleteFileFromDrive } from './drive';

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
