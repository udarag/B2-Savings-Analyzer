import { createMagicLinkToken } from './tokens';
import { getAppBaseUrl } from '@/lib/app-base-url';

export async function sendMagicLink(email: string): Promise<void> {
  const token = await createMagicLinkToken(email);
  const baseUrl = getAppBaseUrl();
  const url = `${baseUrl}/api/auth/verify?token=${token}`;

  if (process.env.RESEND_API_KEY) {
    const { Resend } = await import('resend');
    const resend = new Resend(process.env.RESEND_API_KEY);
    const { data, error } = await resend.emails.send({
      from: getEmailSender(),
      to: email,
      subject: 'Sign in to B2 Savings Analyzer',
      html: `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
          <div style="background: #0E0A2A; padding: 20px; border-radius: 8px 8px 0 0;">
            <span style="color: white; font-weight: bold; font-size: 18px;">B2 Savings Analyzer</span>
          </div>
          <div style="padding: 24px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
            <p style="color: #374151; margin: 0 0 16px;">Click the button below to sign in. This link expires in 15 minutes.</p>
            <a href="${url}" style="display: inline-block; background: #D1232A; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 500;">
              Sign in
            </a>
            <p style="color: #9ca3af; font-size: 12px; margin: 24px 0 0;">If you didn't request this, you can safely ignore this email.</p>
          </div>
        </div>
      `,
    });

    if (error) {
      throw new Error(`Resend failed to send magic link: ${error.message}`);
    }

    console.info('Magic link email queued by Resend', { id: data?.id });
  } else {
    console.log('\n========================================');
    console.log('  MAGIC LINK (no RESEND_API_KEY set)');
    console.log('========================================');
    console.log(`  Email: ${email}`);
    console.log(`  Link:  ${url}`);
    console.log('========================================\n');
  }
}

function getEmailSender(): string {
  const configuredSender = process.env.EMAIL_FROM?.trim();
  if (configuredSender) return configuredSender;

  if (process.env.NODE_ENV === 'production') {
    throw new Error('EMAIL_FROM is required in production and must use a verified Resend domain.');
  }

  return 'B2 Savings Analyzer <onboarding@resend.dev>';
}
