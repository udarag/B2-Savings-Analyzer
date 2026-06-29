import { NextResponse } from 'next/server';
import { createMagicLinkUrl, sendMagicLink } from '@/lib/auth/send-magic-link';

// This is an internal Backblaze tool, so sign-in is gated to company email domains. Configurable via
// ALLOWED_EMAIL_DOMAIN (comma-separated) for staging/other tenants; defaults to backblaze.com.
const ALLOWED_DOMAINS = (process.env.ALLOWED_EMAIL_DOMAIN || 'backblaze.com')
  .split(',')
  .map((d) => d.trim().toLowerCase());

/** Emails a magic sign-in link to an allowed-domain address; in local dev returns the link directly instead. */
export async function POST(req: Request) {
  const { email } = await req.json();

  if (!email || typeof email !== 'string') {
    return NextResponse.json({ error: 'Email is required' }, { status: 400 });
  }

  const normalized = email.trim().toLowerCase();
  const domain = normalized.split('@')[1];

  if (!domain || !ALLOWED_DOMAINS.includes(domain)) {
    return NextResponse.json(
      { error: `Only @${ALLOWED_DOMAINS.join(', @')} addresses are allowed` },
      { status: 403 },
    );
  }

  // Local dev shortcut: skip the email provider entirely and hand the link back in the response so a
  // developer can click through without SMTP configured. Gated to localhost (see below) so it can
  // never leak a usable token over a real network in production.
  if (isLocalDevelopmentRequest(req)) {
    const magicLink = await createMagicLinkUrl(normalized, new URL(req.url).origin);
    return NextResponse.json({ ok: true, devMagicLink: magicLink });
  }

  try {
    await sendMagicLink(normalized);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('Failed to send magic link:', e);
    // Return a generic message; the underlying error may carry provider/env details we don't expose to clients.
    return NextResponse.json({ error: 'Failed to send email' }, { status: 500 });
  }
}

// Guards the dev shortcut above: never active in production, and only for loopback hostnames so a
// request proxied in from elsewhere can't trigger the link-in-response path.
function isLocalDevelopmentRequest(req: Request): boolean {
  if (process.env.NODE_ENV === 'production') return false;

  const { hostname } = new URL(req.url);
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]';
}
