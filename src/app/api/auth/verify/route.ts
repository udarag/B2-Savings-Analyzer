import { NextResponse } from 'next/server';
import { verifyMagicLinkToken, createSessionToken } from '@/lib/auth/tokens';

const COOKIE_NAME = 'b2sa_session';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const token = searchParams.get('token');

  if (!token) {
    return NextResponse.redirect(new URL('/login?error=missing-token', req.url));
  }

  try {
    const email = await verifyMagicLinkToken(token);
    const sessionToken = await createSessionToken(email);

    const response = NextResponse.redirect(new URL('/', req.url));
    response.cookies.set(COOKIE_NAME, sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60,
      path: '/',
    });

    return response;
  } catch {
    return NextResponse.redirect(new URL('/login?error=invalid-token', req.url));
  }
}
