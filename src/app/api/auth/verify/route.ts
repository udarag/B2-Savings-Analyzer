import { NextResponse } from 'next/server';
import { verifyMagicLinkToken, createSessionToken, SESSION_MAX_AGE_SECONDS } from '@/lib/auth/tokens';
import { getAppBaseUrl } from '@/lib/app-base-url';

// Shared session cookie name; must match the value the logout route clears and getSessionUser reads.
const COOKIE_NAME = 'b2sa_session';

/**
 * Magic-link landing endpoint: validates the emailed token, mints a session cookie, and redirects
 * into the app. On any failure it redirects back to /login with an error code rather than returning
 * an error body, since the user reaches this URL directly from their email client.
 *
 * Redirects target getAppBaseUrl() (the canonical app origin), not the request origin, so a tampered
 * Host header can't bounce a freshly-issued session cookie to an attacker-controlled domain.
 */
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
    // Covers both expired and malformed/forged tokens; deliberately collapsed to one generic
    // error code so we don't reveal which check failed.
    return NextResponse.redirect(new URL('/login?error=invalid-token', appBaseUrl));
  }
}
