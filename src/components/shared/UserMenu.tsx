'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';

export function UserMenu() {
  const [email, setEmail] = useState<string | null>(null);
  const pathname = usePathname();

  useEffect(() => {
    if (pathname === '/login') return;
    fetch('/api/auth/me')
      .then((r) => r.json())
      .then((d) => setEmail(d.user?.email ?? null))
      .catch(() => setEmail(null));
  }, [pathname]);

  if (!email) return null;

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login';
  }

  const initials = email.split('@')[0].slice(0, 2).toUpperCase();

  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center gap-2">
        <div className="w-7 h-7 rounded-full bg-bb-red/20 flex items-center justify-center">
          <span className="text-xs font-semibold text-bb-red-light">{initials}</span>
        </div>
        <span className="text-sm text-gray-300 hidden sm:inline">{email.split('@')[0]}</span>
      </div>
      <button
        onClick={handleLogout}
        className="text-xs text-gray-400 hover:text-white transition-colors"
      >
        Sign out
      </button>
    </div>
  );
}
