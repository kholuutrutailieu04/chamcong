/**
 * GET /api/cron/cleanup-sandbox
 * Dọn dẹp dữ liệu Sandbox (test data) độc lập,
 * có thể gọi từ Vercel Cron hoặc thủ công.
 */
import { NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase';
import { cleanupSandboxData } from '@/lib/cleanup';

export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization');
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = getAdminClient();
  const result = await cleanupSandboxData(admin);
  return NextResponse.json(result);
}
