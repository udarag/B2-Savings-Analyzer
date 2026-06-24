import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import Script from "next/script";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { UserMenu } from "@/components/shared/UserMenu";
import { ThemeController } from "@/components/shared/ThemeController";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "B2 Savings Analyzer",
  description: "Model storage cost savings when migrating to Backblaze B2",
  icons: {
    icon: "/backblaze-flame.png",
    apple: "/backblaze-webclip.png",
  },
};

const themeInitScript = `
(function(){
  try {
    var path = window.location.pathname;
    var isReport = /^\\/analyses\\/[^/]+\\/report(?:\\/|$)/.test(path);
    var stored = window.localStorage.getItem('b2-savings-theme');
    var theme = stored === 'dark' || stored === 'light'
      ? stored
      : (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    var darkEnabled = theme === 'dark' && !isReport;
    var root = document.documentElement;
    root.classList.toggle('dark', darkEnabled);
    root.dataset.theme = darkEnabled ? 'dark' : 'light';
    root.style.colorScheme = darkEnabled ? 'dark' : 'light';
  } catch (e) {}
})();
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      data-theme="light"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      style={{ colorScheme: 'light' }}
      suppressHydrationWarning
    >
      <body className="min-h-dvh flex flex-col bg-gray-50 transition-colors duration-300">
        <Script
          id="b2-theme-init"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: themeInitScript }}
        />
        <ThemeController />
        <header className="bg-bb-navy px-4 sm:px-6 py-2.5 print:hidden">
          <div className="max-w-[1600px] mx-auto flex items-center justify-between">
            <Link href="/" className="flex min-w-0 items-center gap-3 hover:opacity-90 transition-opacity" aria-label="B2 Savings Analyzer home">
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
        <main className="flex min-h-0 flex-1 flex-col">{children}</main>
      </body>
    </html>
  );
}
