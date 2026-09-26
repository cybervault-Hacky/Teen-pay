import type { Metadata, Viewport } from "next";
import "@fontsource-variable/inter";
import "@fontsource-variable/sora";
import "./globals.css";
import { AppShell } from "@/components/shell";
import { Providers, ThemeInitScript } from "./providers";

export const metadata: Metadata = {
  title: {
    default: "TeenPay — Money that grows with you",
    template: "%s · TeenPay",
  },
  description:
    "TeenPay is a teen-focused money platform for pocket money, spending, saving and goals — built with families, not just for them.",
  applicationName: "TeenPay",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "TeenPay" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#07090d",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        <ThemeInitScript />
      </head>
      <body>
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
