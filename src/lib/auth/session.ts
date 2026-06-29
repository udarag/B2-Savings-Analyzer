// Server-side session helpers for reading the signed session cookie in route handlers and RSCs.
// The edge proxy (src/proxy.ts) gates requests up front; these are the in-handler checks.
import { cookies } from 'next/headers';
import { verifySessionToken } from './tokens';

// Must match the cookie name set at sign-in and checked by the proxy.
const COOKIE_NAME = 'b2sa_session';

/** Resolve the signed-in user's email from the session cookie, or null if absent/invalid. */
export async function getSessionUser(): Promise<string | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}

/** Like getSessionUser but throws 'Unauthorized' when no valid session exists; use to guard handlers. */
export async function requireUser(): Promise<string> {
  const email = await getSessionUser();
  if (!email) throw new Error('Unauthorized');
  return email;
}
