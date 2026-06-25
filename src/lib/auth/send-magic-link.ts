import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createMagicLinkToken } from './tokens';
import { getAppBaseUrl } from '@/lib/app-base-url';

const BACKBLAZE_LOGO_CONTENT_ID = 'backblaze-logo-white';
const BACKBLAZE_EMAIL_LOGO_FILENAME = 'backblaze-logo-white-email.png';

export async function sendMagicLink(email: string): Promise<void> {
  const url = await createMagicLinkUrl(email);

  if (process.env.RESEND_API_KEY) {
    const { Resend } = await import('resend');
    const resend = new Resend(process.env.RESEND_API_KEY);
    const { data, error } = await resend.emails.send({
      from: getEmailSender(),
      to: email,
      subject: 'Sign in to B2 Savings Analyzer',
      html: buildMagicLinkHtml(url),
      text: buildMagicLinkText(url),
      attachments: [await getBackblazeLogoAttachment()],
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

export async function createMagicLinkUrl(email: string, baseUrl = getAppBaseUrl()): Promise<string> {
  const token = await createMagicLinkToken(email);
  return `${baseUrl}/api/auth/verify?token=${token}`;
}

function getEmailSender(): string {
  const configuredSender = process.env.EMAIL_FROM?.trim();
  if (configuredSender) return configuredSender;

  if (process.env.NODE_ENV === 'production') {
    throw new Error('EMAIL_FROM is required in production and must use a verified Resend domain.');
  }

  return 'B2 Savings Analyzer <onboarding@resend.dev>';
}

function buildMagicLinkHtml(url: string): string {
  const escapedUrl = escapeHtml(url);

  return `<!doctype html>
<html>
  <head>
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
    <title>Sign in to B2 Savings Analyzer</title>
  </head>
  <body style="margin:0; padding:0; background:#f4f6fb; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif; color:#111827;">
    <div style="display:none; max-height:0; overflow:hidden; opacity:0; color:transparent;">
      Your secure B2 Savings Analyzer sign-in link expires in 15 minutes.
    </div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f4f6fb; margin:0; padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%; max-width:560px;">
            <tr>
              <td style="border:1px solid #e5e7eb; border-radius:14px; background:#ffffff; overflow:hidden; box-shadow:0 18px 44px rgba(15,23,42,0.08);">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                  <tr>
                    <td style="background:#0e0a2a; padding:28px 32px;">
                      <img src="cid:${BACKBLAZE_LOGO_CONTENT_ID}" width="160" alt="Backblaze" style="display:block; width:160px; max-width:100%; height:auto; border:0; margin:0 0 24px;">
                      <div style="font-size:12px; line-height:16px; color:#ffb4b7; font-weight:700; letter-spacing:.08em; text-transform:uppercase;">Secure sign-in</div>
                      <h1 style="margin:8px 0 0; font-size:26px; line-height:32px; color:#ffffff; font-weight:800;">Open B2 Savings Analyzer</h1>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:32px;">
                      <p style="margin:0 0 22px; font-size:16px; line-height:24px; color:#374151;">
                        Use the button below to sign in to your Backblaze B2 savings workspace. This link expires in 15 minutes.
                      </p>
                      <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 26px;">
                        <tr>
                          <td style="border-radius:9px; background:#d1232a;">
                            <a href="${escapedUrl}" style="display:inline-block; padding:14px 22px; color:#ffffff; font-size:15px; line-height:20px; font-weight:700; text-decoration:none; border-radius:9px;">
                              Sign in securely
                            </a>
                          </td>
                        </tr>
                      </table>
                      <div style="border-top:1px solid #eef2f7; padding-top:20px;">
                        <p style="margin:0 0 10px; font-size:13px; line-height:20px; color:#6b7280;">
                          If the button does not work, copy and paste this URL into your browser:
                        </p>
                        <p style="margin:0; font-size:12px; line-height:18px; word-break:break-all;">
                          <a href="${escapedUrl}" style="color:#b91c22; text-decoration:underline;">${escapedUrl}</a>
                        </p>
                      </div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 4px 0; font-size:12px; line-height:18px; color:#8a94a6; text-align:center;">
                If you did not request this email, you can safely ignore it.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function buildMagicLinkText(url: string): string {
  return [
    'Sign in to B2 Savings Analyzer',
    '',
    'Use this secure link to sign in. It expires in 15 minutes:',
    url,
    '',
    "If you didn't request this email, you can safely ignore it.",
  ].join('\n');
}

async function getBackblazeLogoAttachment() {
  const content = await readFile(join(process.cwd(), 'public', BACKBLAZE_EMAIL_LOGO_FILENAME));

  return {
    filename: BACKBLAZE_EMAIL_LOGO_FILENAME,
    content,
    contentType: 'image/png',
    contentId: BACKBLAZE_LOGO_CONTENT_ID,
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
