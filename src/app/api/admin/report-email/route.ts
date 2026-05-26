import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { getAutoEmailReportConfig, setAutoEmailReportEnabled } from '@/lib/auto-email-report';
import { getAdminClient } from '@/lib/supabase';

export async function GET() {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: 'Không có quyền truy cập.' }, { status: 401 });

  try {
    const config = await getAutoEmailReportConfig(getAdminClient());
    return NextResponse.json(config);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Lỗi máy chủ';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: 'Không có quyền truy cập.' }, { status: 401 });

  try {
    const body = (await req.json()) as { enabled?: boolean };
    if (typeof body.enabled !== 'boolean') {
      return NextResponse.json({ error: 'Thiếu trạng thái bật/tắt.' }, { status: 400 });
    }

    const config = await setAutoEmailReportEnabled(getAdminClient(), body.enabled);
    return NextResponse.json(config);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Lỗi máy chủ';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
