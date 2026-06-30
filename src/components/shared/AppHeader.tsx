'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { UserMenu } from '@/components/shared/UserMenu';

/** App-wide top navigation. Hidden on login and on customer-facing report pages. */
export function AppHeader() {
  const pathname = usePathname();

  // Suppress the internal chrome on the login screen and on the customer-facing
  // report (the report is shared/printed externally and must stand alone).
  if (pathname === '/login' || /^\/analyses\/[^/]+\/report(?:\/|$)/.test(pathname)) return null;

  // The internal analysis dashboard runs wider than the rest of the app to fit its data tables.
  // Mirror each page's content container (max-width + padding) here so the logo and account
  // controls line up with the page edges; the navy band itself stays full-bleed.
  const isDashboard = /^\/analyses\/[^/]+$/.test(pathname) && pathname !== '/analyses/new';
  const containerClass = isDashboard
    ? 'max-w-[1680px] px-3 sm:px-5'
    : 'max-w-[1240px] px-4 sm:px-6';

  return (
    <header className="bg-c-nav print:hidden">
      {/* The header persists across client-side navigation, so animating its max-width/padding lets
          the logo and account controls glide to the new page margins instead of snapping. */}
      <div className={`mx-auto flex h-[58px] items-center justify-between gap-4 transition-[max-width,padding] duration-300 ease-out motion-reduce:transition-none ${containerClass}`}>
        <Link
          href="/"
          className="flex min-w-0 items-center gap-3 transition-opacity hover:opacity-90"
          aria-label="B2 Savings Analyzer home"
        >
          <Image
            src="/flame-white.png"
            alt="Backblaze"
            width={698}
            height={1152}
            className="h-[26px] w-auto shrink-0"
            priority
          />
          <span className="font-display text-[18px] font-semibold tracking-[-0.01em] text-white">Backblaze</span>
          <span className="hidden items-center gap-3 sm:flex">
            <span className="h-[18px] w-px shrink-0 bg-white/20" />
            <span className="whitespace-nowrap text-[13.5px] font-medium tracking-wide text-[#c9c9de]">
              B2 Savings Analyzer
            </span>
          </span>
        </Link>
        <UserMenu />
      </div>
    </header>
  );
}
