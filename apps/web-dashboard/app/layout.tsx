import type { Metadata } from "next";
import Script from "next/script";
import type { ReactNode } from "react";
import { AppShell } from "@/components/shell/AppShell";
import { branding } from "@/lib/branding";
import { fetchPolyfillScript } from "@/lib/fetch-polyfill";
import "./globals.css";

export const metadata: Metadata = {
  title: branding.productName,
  description: branding.tagline
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <Script id="agentgate-fetch-polyfill" strategy="beforeInteractive">
          {fetchPolyfillScript}
        </Script>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
