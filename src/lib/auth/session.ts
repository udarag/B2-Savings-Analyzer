import { cookies } from 'next/headers';
import { verifySessionToken } from './tokens';

const COOKIE_NAME = 'b2sa_session';

export async function getSessionUser(): Promise<string | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}

export async function requireUser(): Promise<string> {
  const email = await getSessionUser();
  if (!email) throw new Error('Unauthorized');
  return email;
}
