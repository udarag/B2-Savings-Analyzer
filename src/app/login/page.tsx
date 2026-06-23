'use client';

import { Suspense, useState } from 'react';
import Image from 'next/image';
import { useSearchParams } from 'next/navigation';
import { useDocumentTitle } from '@/components/shared/useDocumentTitle';

export default function LoginPage() {
  useDocumentTitle('Sign In');

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

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to send link');
      }

      setStatus('sent');
    } catch (err) {
      setStatus('error');
      setErrorMsg(err instanceof Error ? err.message : 'Something went wrong');
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <Image
            src="/backblaze-logo.png"
            alt="Backblaze"
            width={800}
            height={286}
            className="mx-auto mb-5 h-auto w-48 max-w-full dark:hidden"
            priority
          />
          <Image
            src="/backblaze-logo-white.png"
            alt="Backblaze"
            width={800}
            height={286}
            className="mx-auto mb-5 hidden h-auto w-48 max-w-full dark:block"
            priority
          />
          <h1 className="text-2xl font-bold text-gray-900">Savings Analyzer</h1>
          <p className="text-gray-500 mt-1">Sign In with Your Backblaze Email</p>
        </div>

        {urlError === 'invalid-token' && (
          <div className="bg-red-50 text-red-700 text-sm rounded-lg p-3 mb-4">
            That link has expired or is invalid. Please request a new one.
          </div>
        )}

        {status === 'sent' ? (
          <div className="bg-white rounded-xl shadow-sm border p-6 text-center">
            <div className="w-12 h-12 bg-green-50 rounded-full flex items-center justify-center mx-auto mb-3">
              <svg className="w-6 h-6 text-green-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
              </svg>
            </div>
            <h2 className="text-lg font-semibold text-gray-900 mb-1">Check Your Email</h2>
            <p className="text-sm text-gray-600 mb-4">
              We sent a sign-in link to <span className="font-medium">{email}</span>
            </p>
            <button
              onClick={() => { setStatus('idle'); setEmail(''); }}
              className="text-sm text-bb-red hover:text-bb-red-dark"
            >
              Use a Different Email
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow-sm border p-6">
            <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1.5">
              Email Address
            </label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@backblaze.com"
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-bb-red focus:border-transparent outline-none"
            />

            {errorMsg && (
              <p className="text-sm text-red-600 mt-2">{errorMsg}</p>
            )}

            <button
              type="submit"
              disabled={status === 'sending'}
              className="w-full mt-4 px-4 py-2.5 bg-bb-red text-white text-sm font-medium rounded-lg hover:bg-bb-red-dark disabled:opacity-50 transition-colors"
            >
              {status === 'sending' ? 'Sending...' : 'Send Sign-In Link'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

function LoginShell() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm rounded-xl border bg-white p-6 shadow-sm">
        <div className="mx-auto mb-5 h-12 w-48 max-w-full rounded bg-gray-100" />
        <div className="mx-auto mb-3 h-6 w-40 rounded bg-gray-100" />
        <div className="mx-auto h-4 w-56 rounded bg-gray-100" />
      </div>
    </div>
  );
}
