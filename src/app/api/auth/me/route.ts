import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth/session';

/** Returns the signed-in user (email only) for the client to hydrate auth state, or 401 if no valid session. */
export async function GET() {
  const email = await getSessionUser();
  if (!email) {
    // 401 with an explicit null user lets the client distinguish "signed out" from a fetch error.
    return NextResponse.json({ user: null }, { status: 401 });
  }
  return NextResponse.json({ user: { email } });
}
