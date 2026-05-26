import Link from "next/link";
import type { ReactNode } from "react";
import { Activity, ShieldCheck } from "lucide-react";
import { branding, navigationItems } from "@/lib/branding";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <Link href="/" className="flex items-center gap-3" aria-label={branding.productName}>
            <span className="flex h-9 w-9 items-center justify-center rounded-ui bg-foreground text-sm font-semibold text-background">
              {branding.shortName}
            </span>
            <span>
              <span className="block text-sm font-semibold">{branding.productName}</span>
              <span className="block text-xs text-muted">{branding.tagline}</span>
            </span>
          </Link>
          <div className="hidden items-center gap-2 text-xs text-muted md:flex">
            <ShieldCheck className="h-4 w-4 text-success" aria-hidden="true" />
            Observe + Decide Phase 1
            <Activity className="ml-3 h-4 w-4 text-accent" aria-hidden="true" />
            API + runner placeholder
          </div>
        </div>
        <nav className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-6 pb-3" aria-label="Main navigation">
          {navigationItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="whitespace-nowrap rounded-ui px-3 py-2 text-sm text-muted transition-colors hover:bg-muted/10 hover:text-foreground"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </header>
      <main className="mx-auto max-w-7xl px-6 py-8">{children}</main>
    </div>
  );
}
