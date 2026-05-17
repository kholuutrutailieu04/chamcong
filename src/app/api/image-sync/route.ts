import { NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase';
import { cleanupSyncedSupabaseImages, processImageSyncJobs } from '@/lib/image-sync';

export async function POST(req: Request) {
  const authHeader = req.headers.get('authorization');
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = getAdminClient();

  try {
    const syncResult = await processImageSyncJobs(admin, 20);
    const cleanupCount = await cleanupSyncedSupabaseImages(admin, 50);

    return NextResponse.json({
      success: true,
      processed: syncResult.processed,
      synced: syncResult.synced,
      cleaned_up: cleanupCount,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Image sync failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
