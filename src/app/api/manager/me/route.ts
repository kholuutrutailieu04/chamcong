import { NextResponse } from 'next/server';
import { requireManager } from '@/lib/auth';

export async function GET() {
  const session = await requireManager();
  if (!session) return NextResponse.json({ session: null });
  return NextResponse.json({ session });
}
