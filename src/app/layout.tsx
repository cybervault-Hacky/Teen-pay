import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { AuthProvider } from "@/auth/provider";
import { AppShell } from "@/components/layout/app-shell";
import { SandboxProvider } from "@/sandbox/store";

/**
 * Inter, self-hosted (SIL OFL — see fonts/INTER-LICENSE.txt).
 * The latin variable subset covers the UI; a handful of glyphs
 * (e.g. ₹) gracefully fall back to the system font, same as the
 * Google-hosted version of the font.
 */
const inter = localFont({
  src: "./fonts/inter-latin.woff2",
  weight: "100 900",
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "TeenPay — Money for teens and families",
    template: "%s · TeenPay",
  },
  description:
    "A calm, safe place for teenagers to receive, save, and manage money with their family. Interactive sandbox preview — no real money.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0b0d10" },
    { media: "(prefers-color-scheme: light)", color: "#f5f6f8" },
  ],
};

/**
 * Applies the saved theme before first paint so there is no flash
 * of the wrong theme. Safe to fail silently.
 */
const themeScript = `(function(){try{var t=localStorage.getItem("teenpay-theme");if(t==="light"||t==="dark"){document.documentElement.setAttribute("data-theme",t);}}catch(e){}})();`;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      data-theme="dark"
      className={inter.variable}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-dvh bg-bg font-sans text-ink antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-xl focus:bg-surface-2 focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-ink"
        >
          Skip to content
        </a>
        {/*
          App → Auth (who is acting) → Sandbox data (accounts, family,
          money) → UI. SSR renders a neutral "restoring" state and the
          deterministic seed; after mount, the stored session and data
          are read on the client.
        */}
        <AuthProvider>
          <SandboxProvider>
            <AppShell>{children}</AppShell>
          </SandboxProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
