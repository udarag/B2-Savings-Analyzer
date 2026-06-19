import { NextResponse } from 'next/server';
import { sendMagicLink } from '@/lib/auth/send-magic-link';

const ALLOWED_DOMAINS = (process.env.ALLOWED_EMAIL_DOMAIN || 'backblaze.com')
  .split(',')
  .map((d) => d.trim().toLowerCase());

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

  try {
    await sendMagicLink(normalized);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('Failed to send magic link:', e);
    return NextResponse.json({ error: 'Failed to send email' }, { status: 500 });
  }
}
