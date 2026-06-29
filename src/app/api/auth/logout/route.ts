import { NextResponse } from 'next/server';

// Shared session cookie name; must match the value set on login (verify route) and read by getSessionUser.
const COOKIE_NAME = 'b2sa_session';

/** Logs the user out by clearing the session cookie. */
export async function POST() {
  const response = NextResponse.json({ ok: true });
  // Overwrite with an empty, immediately-expired cookie (maxAge 0) using the same attributes the
  // login route set it with, so the browser actually drops it rather than keeping a stale value.
  response.cookies.set(COOKIE_NAME, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 0,
    path: '/',
  });
  return response;
}
