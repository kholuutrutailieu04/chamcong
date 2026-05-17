import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import { uploadBufferToGas } from '@/lib/gas';

type AdminClient = SupabaseClient<Database>;

const RETENTION_HOURS = 24;

function nextRetryIso(attemptCount: number): string {
  const delayMinutes = Math.min(60, Math.max(1, 2 ** Math.min(attemptCount, 6)));
  return new Date(Date.now() + delayMinutes * 60 * 1000).toISOString();
}

export function decodeBase64Image(raw: string): { buffer: Buffer; mimeType: string; extension: string } {
  const match = raw.match(/^data:(.*?);base64,(.*)$/);
  const mimeType = match?.[1] || 'image/jpeg';
  const base64Content = match?.[2] || raw;
  const buffer = Buffer.from(base64Content, 'base64');
  const extension = mimeType.includes('png') ? 'png' : 'jpg';
  return { buffer, mimeType, extension };
}

export async function processImageSyncJobs(admin: AdminClient, batchSize = 5): Promise<{ processed: number; synced: number }> {
  const nowIso = new Date().toISOString();
  const { data: jobs } = await admin
    .from('image_sync_jobs')
    .select('*')
    .in('sync_status', ['PENDING', 'FAILED'])
    .lte('next_retry_at', nowIso)
    .order('created_at', { ascending: true })
    .limit(batchSize);

  if (!jobs || jobs.length === 0) {
    return { processed: 0, synced: 0 };
  }

  let processed = 0;
  let synced = 0;

  for (const job of jobs) {
    const lockResult = await admin
      .from('image_sync_jobs')
      .update({ sync_status: 'PROCESSING', updated_at: new Date().toISOString() })
      .eq('id', job.id)
      .in('sync_status', ['PENDING', 'FAILED'])
      .select('*')
      .maybeSingle();

    if (!lockResult.data) continue;

    processed += 1;

    try {
      const { data: fileData, error: downloadError } = await admin.storage
        .from(job.supabase_bucket)
        .download(job.supabase_path);

      if (downloadError || !fileData) {
        throw new Error(downloadError?.message || 'Cannot download source image from Supabase Storage');
      }

      const arrayBuffer = await fileData.arrayBuffer();
      const driveResult = await uploadBufferToGas({
        buffer: Buffer.from(arrayBuffer),
        fileName: job.drive_file_name,
        mimeType: fileData.type || 'image/jpeg',
        folderHint: job.drive_folder_hint,
        sourceRecordId: job.source_record_id,
        supabasePath: job.supabase_path,
      });
      const driveLink = driveResult.driveLink;

      await admin
        .from('lich_su_cham_cong')
        .update({ link_anh_minh_chung: driveLink })
        .eq('id', job.source_record_id);

      const now = new Date();
      const deleteAfter = new Date(now.getTime() + RETENTION_HOURS * 60 * 60 * 1000).toISOString();
      await admin
        .from('image_sync_jobs')
        .update({
          sync_status: 'SYNCED',
          drive_link: driveLink,
          synced_at: now.toISOString(),
          delete_after: deleteAfter,
          last_error: null,
          updated_at: now.toISOString(),
        })
        .eq('id', job.id);

      synced += 1;
    } catch (error) {
      const attemptCount = (job.attempt_count || 0) + 1;
      const exhausted = attemptCount >= (job.max_attempts || 12);
      await admin
        .from('image_sync_jobs')
        .update({
          sync_status: 'FAILED',
          attempt_count: attemptCount,
          next_retry_at: exhausted ? '9999-12-31T00:00:00.000Z' : nextRetryIso(attemptCount),
          last_error: error instanceof Error ? error.message : 'Unknown GAS sync error',
          updated_at: new Date().toISOString(),
        })
        .eq('id', job.id);
    }
  }

  return { processed, synced };
}

export async function cleanupSyncedSupabaseImages(admin: AdminClient, batchSize = 20): Promise<number> {
  const nowIso = new Date().toISOString();
  const { data: jobs } = await admin
    .from('image_sync_jobs')
    .select('id, supabase_bucket, supabase_path')
    .eq('sync_status', 'SYNCED')
    .is('deleted_at', null)
    .lte('delete_after', nowIso)
    .order('delete_after', { ascending: true })
    .limit(batchSize);

  if (!jobs || jobs.length === 0) return 0;

  let deleted = 0;

  for (const job of jobs) {
    const { error } = await admin.storage.from(job.supabase_bucket).remove([job.supabase_path]);
    if (error) continue;

    await admin
      .from('image_sync_jobs')
      .update({
        sync_status: 'DELETED',
        deleted_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', job.id);

    deleted += 1;
  }

  return deleted;
}
