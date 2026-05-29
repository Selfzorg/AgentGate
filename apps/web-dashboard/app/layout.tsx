import type { Metadata } from "next";
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
        <script id="agentgate-fetch-polyfill" dangerouslySetInnerHTML={{ __html: fetchPolyfillScript }} />
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
