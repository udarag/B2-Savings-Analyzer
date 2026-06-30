import type { Metadata } from "next";
import Script from "next/script";
import localFont from "next/font/local";
import "./globals.css";
import { AppHeader } from "@/components/shared/AppHeader";
import { ThemeController } from "@/components/shared/ThemeController";

// Self-hosted Backblaze brand fonts: DM Sans for body copy, Space Grotesk for
// display headings. Loading them locally keeps the internal VM deployment free
// of any external Google Fonts request.
const dmSans = localFont({
  variable: "--font-dm-sans",
  display: "swap",
  src: [
    { path: "./fonts/DMSans-Regular.ttf", weight: "400", style: "normal" },
    { path: "./fonts/DMSans-Medium.ttf", weight: "500", style: "normal" },
    { path: "./fonts/DMSans-SemiBold.ttf", weight: "600", style: "normal" },
    { path: "./fonts/DMSans-Bold.ttf", weight: "700", style: "normal" },
  ],
});

const spaceGrotesk = localFont({
  variable: "--font-space-grotesk",
  display: "swap",
  src: [
    { path: "./fonts/SpaceGrotesk-Regular.ttf", weight: "400", style: "normal" },
    { path: "./fonts/SpaceGrotesk-Medium.ttf", weight: "500", style: "normal" },
    { path: "./fonts/SpaceGrotesk-SemiBold.ttf", weight: "600", style: "normal" },
    { path: "./fonts/SpaceGrotesk-Bold.ttf", weight: "700", style: "normal" },
  ],
});

export const metadata: Metadata = {
  title: "B2 Savings Analyzer",
  description: "Model storage cost savings when migrating to Backblaze B2",
  icons: {
    icon: "/backblaze-flame.png",
    apple: "/backblaze-webclip.png",
  },
};

// Inlined and run before first paint (strategy="beforeInteractive") so the stored theme is applied
// to <html> before React hydrates, avoiding a light-to-dark flash. The customer-facing report
// (/analyses/[id]/report) is always forced light regardless of the saved preference, since dark
// styling must never leak into a customer deliverable.
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

/** App-wide shell: fonts, theme bootstrap, and the persistent header above all routed pages. */
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // suppressHydrationWarning: themeInitScript mutates <html> before hydration, so the server-rendered
    // light defaults intentionally differ from the client DOM and must not be treated as a mismatch.
    <html
      lang="en"
      data-theme="light"
      className={`${dmSans.variable} ${spaceGrotesk.variable} h-full antialiased`}
      style={{ colorScheme: 'light' }}
      suppressHydrationWarning
    >
      <body className="min-h-dvh flex flex-col bg-c-bg transition-colors duration-300">
        <Script
          id="b2-theme-init"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: themeInitScript }}
        />
        <ThemeController />
        <AppHeader />
        <main className="flex min-h-0 flex-1 flex-col">{children}</main>
      </body>
    </html>
  );
}
