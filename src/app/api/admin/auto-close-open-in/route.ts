import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase';
import {
  applyDueAutoCloseConfig,
  scheduleAutoCloseConfigChange,
} from '@/lib/auto-close-open-in';
import { requireAdmin } from '@/lib/auth';

export async function GET() {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: 'Không có quyền truy cập.' }, { status: 401 });

  const admin = getAdminClient();
  const config = await applyDueAutoCloseConfig(admin);
  return NextResponse.json(config);
}

export async function POST(req: NextRequest) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: 'Không có quyền truy cập.' }, { status: 401 });

  const admin = getAdminClient();

  try {
    await applyDueAutoCloseConfig(admin);

    const body = (await req.json()) as { enabled?: boolean; admin_email?: string };
    if (typeof body.enabled !== 'boolean') {
      return NextResponse.json({ error: 'Thiếu trạng thái bật/tắt.' }, { status: 400 });
    }

    const adminEmail = body.admin_email?.trim() || 'unknown-admin';
    const config = await scheduleAutoCloseConfigChange(admin, body.enabled, adminEmail);
    return NextResponse.json(config);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Lỗi cập nhật công tắc tự sinh OUT.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
