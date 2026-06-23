import { SignJWT, jwtVerify } from 'jose';

export const SESSION_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;
const SESSION_TOKEN_TTL = '365d';

function getSecret() {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error('AUTH_SECRET environment variable is required');
  return new TextEncoder().encode(secret);
}

export async function createMagicLinkToken(email: string): Promise<string> {
  return new SignJWT({ email, purpose: 'magic-link' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('15m')
    .sign(getSecret());
}

export async function verifyMagicLinkToken(token: string): Promise<string> {
  const { payload } = await jwtVerify(token, getSecret());
  if (payload.purpose !== 'magic-link') throw new Error('Invalid token purpose');
  return payload.email as string;
}

export async function createSessionToken(email: string): Promise<string> {
  return new SignJWT({ email, purpose: 'session' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(SESSION_TOKEN_TTL)
    .sign(getSecret());
}

export async function verifySessionToken(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    if (payload.purpose !== 'session') return null;
    return payload.email as string;
  } catch {
    return null;
  }
}
