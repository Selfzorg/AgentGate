import type { ReactNode } from "react";
import { Activity, ShieldCheck } from "lucide-react";
import { branding, navigationItems } from "@/lib/branding";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b border-white/[0.08] bg-[#080c0a]/95 shadow-[0_1px_0_rgb(255_255_255_/_0.03)] backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <a href="/" className="flex items-center gap-3" aria-label={branding.productName}>
            <span className="flex h-9 w-9 items-center justify-center rounded-ui border border-emerald-200/20 bg-white text-sm font-semibold text-[#07100d] shadow-[0_0_28px_rgb(16_185_129_/_0.18)]">
              {branding.shortName}
            </span>
            <span>
              <span className="block text-sm font-semibold text-white">{branding.productName}</span>
              <span className="block text-xs text-muted">{branding.tagline}</span>
            </span>
          </a>
          <div className="hidden items-center gap-2 text-xs text-muted md:flex">
            <ShieldCheck className="h-4 w-4 text-emerald-300" aria-hidden="true" />
            Governed Execution Phase 3
            <Activity className="ml-3 h-4 w-4 text-accent" aria-hidden="true" />
            DB-backed logs
          </div>
        </div>
        <nav className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-6 pb-3" aria-label="Main navigation">
          {navigationItems.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="whitespace-nowrap rounded-ui px-3 py-2 text-sm text-muted transition-colors hover:bg-white/[0.07] hover:text-white"
            >
              {item.label}
            </a>
          ))}
        </nav>
      </header>
      <main className="mx-auto max-w-7xl px-6 py-8">{children}</main>
    </div>
  );
}
