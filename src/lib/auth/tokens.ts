// Signs and verifies the two HS256 JWTs this app uses: short-lived magic-link tokens (email
// sign-in) and long-lived session tokens (the browser cookie). Both are signed with AUTH_SECRET;
// the `purpose` claim keeps the two kinds from being used interchangeably.
import { SignJWT, jwtVerify } from 'jose';

/** Session token lifetime in seconds; also the session cookie's Max-Age (kept in sync with SESSION_TOKEN_TTL). */
export const SESSION_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;
const SESSION_TOKEN_TTL = '365d';

function getSecret() {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error('AUTH_SECRET environment variable is required');
  return new TextEncoder().encode(secret);
}

/** Mint a single-use email sign-in token. Short 15m TTL bounds the window if the link is intercepted. */
export async function createMagicLinkToken(email: string): Promise<string> {
  return new SignJWT({ email, purpose: 'magic-link' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('15m')
    .sign(getSecret());
}

/**
 * Verify a magic-link token and return its email. Throws on a bad signature, expiry, or a token
 * minted for another purpose (e.g. a session cookie replayed against the verify endpoint).
 */
export async function verifyMagicLinkToken(token: string): Promise<string> {
  const { payload } = await jwtVerify(token, getSecret());
  if (payload.purpose !== 'magic-link') throw new Error('Invalid token purpose');
  return payload.email as string;
}

/** Mint the long-lived session token stored in the browser cookie after a successful sign-in. */
export async function createSessionToken(email: string): Promise<string> {
  return new SignJWT({ email, purpose: 'session' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(SESSION_TOKEN_TTL)
    .sign(getSecret());
}

/**
 * Verify a session token and return its email, or null on any failure. Unlike the magic-link
 * verifier this never throws — callers treat null as "not signed in" rather than an error.
 */
export async function verifySessionToken(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    if (payload.purpose !== 'session') return null;
    return payload.email as string;
  } catch {
    return null;
  }
}
