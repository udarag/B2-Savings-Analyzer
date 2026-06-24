'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { UserMenu } from '@/components/shared/UserMenu';

export function AppHeader() {
  const pathname = usePathname();

  if (pathname === '/login') return null;

  return (
    <header className="bg-bb-navy px-4 py-2.5 print:hidden sm:px-6">
      <div className="mx-auto flex max-w-[1600px] items-center justify-between">
        <Link href="/" className="flex min-w-0 items-center gap-3 transition-opacity hover:opacity-90" aria-label="B2 Savings Analyzer home">
          <Image
            src="/backblaze-logo-white.png"
            alt="Backblaze"
            width={800}
            height={286}
            className="h-auto w-28 shrink-0 sm:w-32"
            priority
          />
          <span className="hidden items-center gap-3 sm:flex">
            <span className="h-4 w-px shrink-0 bg-white/20" />
            <span className="text-sm font-medium tracking-wide text-gray-200">B2 Savings Analyzer</span>
          </span>
          <span className="min-w-0 truncate text-sm font-medium tracking-wide text-gray-200 sm:hidden">B2 Savings</span>
        </Link>
        <UserMenu />
      </div>
    </header>
  );
}
