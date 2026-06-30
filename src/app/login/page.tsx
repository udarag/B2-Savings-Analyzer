'use client';

import { Suspense, type ReactNode, useState } from 'react';
import Image from 'next/image';
import { useSearchParams } from 'next/navigation';
import { useDocumentTitle } from '@/components/shared/useDocumentTitle';

const BUILD_NUMBER = process.env.NEXT_PUBLIC_BUILD_NUMBER ?? 'local';
const GITHUB_REPO_URL = 'https://github.com/udarag/B2-Savings-Analyzer';

/** Magic-link sign-in page. Wraps the form in Suspense because LoginForm reads search params. */
export default function LoginPage() {
  useDocumentTitle('Sign in');

  return (
    <Suspense fallback={<LoginShell />}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const searchParams = useSearchParams();
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  // Start the field read-only and drop it on first focus. Browser/OS autofill
  // (incl. Safari/iCloud Passwords) evaluates eligibility when a field is focused,
  // and skips a field that is read-only at that moment, so no suggestions pop up.
  const [emailReadOnly, setEmailReadOnly] = useState(true);

  const urlError = searchParams.get('error');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus('sending');
    setErrorMsg('');

    try {
      const res = await fetch('/api/auth/send-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to send link');
      }

      // In local dev the API returns the magic link in the response instead of emailing it, so we
      // follow it straight away rather than telling the user to check an inbox no one is watching.
      if (isLocalDevMagicLink(data.devMagicLink)) {
        window.location.assign(data.devMagicLink);
        return;
      }

      setStatus('sent');
    } catch (err) {
      setStatus('error');
      setErrorMsg(err instanceof Error ? err.message : 'Something went wrong');
    }
  }

  return (
    <LoginFrame>
      <div className="w-full">
        {/* Brand lockup — the login screen owns its own branding (the app header is hidden here). */}
        <div className="mb-7 text-center">
          <div className="mb-5 inline-flex items-center gap-3">
            <Image src="/flame-white.png" alt="Backblaze" width={698} height={1152} className="h-[34px] w-auto" priority />
            <span className="font-display text-[26px] font-semibold text-white">Backblaze</span>
          </div>
          <h1 className="font-display text-[26px] font-semibold text-white">Savings Analyzer</h1>
          <p className="mt-2 text-sm text-white/70">Sign in with your Backblaze email</p>
        </div>

        {urlError === 'invalid-token' && (
          <div className="mb-4 rounded-xl border border-white/15 bg-white/10 p-3 text-sm text-red-200">
            That link expired or is invalid. Request a new one below.
          </div>
        )}

        {status === 'sent' ? (
          <div className="rounded-[18px] border border-white/[0.14] bg-white/[0.06] p-6 text-center backdrop-blur-[12px]">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-[#1f8a5b]/25">
              <svg className="h-6 w-6 text-[#8fe9be]" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
              </svg>
            </div>
            <h2 className="text-lg font-semibold text-white">Check your email</h2>
            <p className="mt-1 text-sm text-white/70">
              We sent a secure sign-in link to <span className="font-medium text-white">{email}</span>.
            </p>
            <p className="mt-2 text-sm text-white/50">
              It expires in 15 minutes. If you do not see it in your inbox, check your spam folder.
            </p>
            <button
              onClick={() => { setStatus('idle'); setEmail(''); }}
              className="mt-5 text-sm font-medium text-[#ff8593] transition-colors hover:text-white"
            >
              Use a different email
            </button>
          </div>
        ) : (
          <form
            onSubmit={handleSubmit}
            autoComplete="off"
            className="rounded-[18px] border border-white/[0.14] bg-white/[0.06] p-6 backdrop-blur-[12px]"
          >
            <label htmlFor="b2sa-access-address" className="mb-2 block text-[13px] font-semibold text-white/85">
              Backblaze address
            </label>
            <div className="mb-4 flex items-center gap-2.5 rounded-[11px] border border-white/[0.18] bg-white/[0.08] px-3.5 py-3 transition-colors focus-within:border-white/40">
              <svg className="h-4 w-4 shrink-0 text-white/50" fill="none" viewBox="0 0 24 24" strokeWidth={1.6} stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
              </svg>
              <input
                id="b2sa-access-address"
                name="b2sa-access-address"
                type="text"
                required
                inputMode="email"
                enterKeyHint="send"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
                pattern="[^@\s]+@[^@\s]+\.[^@\s]+"
                title="Enter a valid Backblaze email address."
                data-1p-ignore="true"
                data-lpignore="true"
                data-bwignore="true"
                data-form-type="other"
                readOnly={emailReadOnly}
                onFocus={() => setEmailReadOnly(false)}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@backblaze.com"
                className="min-w-0 flex-1 border-0 bg-transparent! text-sm text-white! outline-none placeholder:text-white/45!"
              />
            </div>

            {errorMsg && <p className="mb-3 text-sm text-red-200">{errorMsg}</p>}

            <button
              type="submit"
              disabled={status === 'sending'}
              className="w-full rounded-[11px] bg-[#e20626] py-3.5 text-sm font-semibold text-white shadow-[0_8px_24px_rgba(226,6,38,0.4)] transition-colors hover:bg-[#b40a23] disabled:opacity-50"
            >
              {status === 'sending' ? 'Sending...' : 'Send sign-in link'}
            </button>
            <p className="mt-3.5 text-center text-[11.5px] text-white/50">A secure magic link, valid for 15 minutes.</p>
          </form>
        )}
      </div>
    </LoginFrame>
  );
}

// Guard before auto-following a dev magic link: only same-origin /api/auth/verify URLs that carry a
// token, so a malformed or attacker-influenced devMagicLink value can't redirect us off-site.
function isLocalDevMagicLink(value: unknown): value is string {
  if (typeof value !== 'string') return false;

  try {
    const url = new URL(value, window.location.origin);
    return (
      url.origin === window.location.origin &&
      url.pathname === '/api/auth/verify' &&
      url.searchParams.has('token')
    );
  } catch {
    return false;
  }
}

// Full-bleed navy gradient backdrop. The login screen is always dark regardless of the app theme,
// so its colors are hard-coded (white/X overlays, brand red) rather than driven by the theme tokens.
function LoginFrame({ children }: { children: ReactNode }) {
  return (
    <div
      className="relative flex flex-1 flex-col items-center justify-center overflow-hidden bg-[#000033] px-4 py-10"
      style={{ backgroundImage: "url('/gradient-dark.png')", backgroundSize: 'cover', backgroundPosition: 'center' }}
    >
      <div className="relative z-[2] flex w-full max-w-[400px] flex-col items-center">
        {children}
        <BuildNumber />
      </div>
    </div>
  );
}

// Footer build stamp. Links the commit SHA to GitHub when running a real build; shows a bare
// "local" (no link) during local dev where BUILD_NUMBER is unset.
function BuildNumber() {
  const hasCommit = BUILD_NUMBER !== 'local';
  return (
    <p className="mt-6 shrink-0 text-center font-mono text-[11px] leading-none text-white/35">
      Build{' '}
      {hasCommit ? (
        <a
          href={`${GITHUB_REPO_URL}/commit/${BUILD_NUMBER}`}
          target="_blank"
          rel="noopener noreferrer"
          className="underline decoration-dotted underline-offset-2 transition-colors hover:text-white/60"
        >
          {BUILD_NUMBER}
        </a>
      ) : (
        BUILD_NUMBER
      )}
    </p>
  );
}

function LoginShell() {
  return (
    <LoginFrame>
      <div className="w-full rounded-[18px] border border-white/[0.14] bg-white/[0.06] p-6 backdrop-blur-[12px]">
        <div className="mx-auto mb-5 h-12 w-48 max-w-full rounded bg-white/10" />
        <div className="mx-auto mb-3 h-6 w-40 rounded bg-white/10" />
        <div className="mx-auto h-4 w-56 rounded bg-white/10" />
      </div>
    </LoginFrame>
  );
}
