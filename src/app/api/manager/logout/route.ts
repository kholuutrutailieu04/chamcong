import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export async function POST(req: NextRequest) {
  const cookieStore = await cookies();
  cookieStore.delete('manager_session');
  return NextResponse.json({ success: true });
}
