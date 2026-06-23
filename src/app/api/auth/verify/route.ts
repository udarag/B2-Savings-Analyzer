import { NextResponse } from 'next/server';
import { verifyMagicLinkToken, createSessionToken, SESSION_MAX_AGE_SECONDS } from '@/lib/auth/tokens';
import { getAppBaseUrl } from '@/lib/app-base-url';

const COOKIE_NAME = 'b2sa_session';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const token = searchParams.get('token');
  const appBaseUrl = getAppBaseUrl();

  if (!token) {
    return NextResponse.redirect(new URL('/login?error=missing-token', appBaseUrl));
  }

  try {
    const email = await verifyMagicLinkToken(token);
    const sessionToken = await createSessionToken(email);

    const response = NextResponse.redirect(new URL('/', appBaseUrl));
    response.cookies.set(COOKIE_NAME, sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: SESSION_MAX_AGE_SECONDS,
      path: '/',
    });

    return response;
  } catch {
    return NextResponse.redirect(new URL('/login?error=invalid-token', appBaseUrl));
  }
}
