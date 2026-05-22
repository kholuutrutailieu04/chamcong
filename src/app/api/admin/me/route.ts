import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';

export async function GET() {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ session: null });
  return NextResponse.json({ session });
}
