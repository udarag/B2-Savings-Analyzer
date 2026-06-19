import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth/session';

export async function GET() {
  const email = await getSessionUser();
  if (!email) {
    return NextResponse.json({ user: null }, { status: 401 });
  }
  return NextResponse.json({ user: { email } });
}
