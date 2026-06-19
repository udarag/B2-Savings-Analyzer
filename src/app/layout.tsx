import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { UserMenu } from "@/components/shared/UserMenu";

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
    >
      <body className="min-h-full flex flex-col bg-gray-50">
        <header className="bg-bb-navy px-6 py-3">
          <div className="max-w-7xl mx-auto flex items-center justify-between">
            <a href="/" className="flex items-center gap-2">
              <img src="/backblaze-webclip.png" alt="Backblaze" className="w-8 h-8" />
              <span className="font-semibold text-white">Savings Analyzer</span>
            </a>
            <div className="flex items-center gap-4">
              <UserMenu />
              <a
                href="/analyses/new"
                className="px-4 py-2 bg-bb-red text-white text-sm font-medium rounded-lg hover:bg-bb-red-dark transition-colors"
              >
                New Analysis
              </a>
            </div>
          </div>
        </header>
        <main className="flex-1">{children}</main>
      </body>
    </html>
  );
}
