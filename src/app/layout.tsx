import type { Metadata } from "next";
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
      <body className="min-h-full flex flex-col bg-gray-50 transition-colors duration-300">
        <Script
          id="b2-theme-init"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: themeInitScript }}
        />
        <ThemeController />
        <header className="bg-bb-navy px-4 sm:px-6 py-2.5 print:hidden">
          <div className="max-w-[1600px] mx-auto flex items-center justify-between">
            <Link href="/" className="flex items-center gap-2 hover:opacity-90 transition-opacity">
              <img src="/backblaze-flame.png" alt="Backblaze" className="w-6 h-6" />
              <span className="text-sm font-medium text-white tracking-wide">Backblaze B2 Savings Analyzer</span>
            </Link>
            <div className="flex items-center gap-3">
              <Link
                href="/analyses/new"
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-white/10 rounded-md hover:bg-bb-red transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M12 5v14m-7-7h14" /></svg>
                New
              </Link>
              <div className="w-px h-5 bg-white/20" />
              <UserMenu />
            </div>
          </div>
        </header>
        <main className="flex-1">{children}</main>
      </body>
    </html>
  );
}
