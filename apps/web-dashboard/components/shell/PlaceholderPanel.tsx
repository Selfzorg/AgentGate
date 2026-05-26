import type { ReactNode } from "react";

export function PlaceholderPanel({
  title,
  children
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-ui border border-border bg-surface p-5 shadow-panel">
      <h2 className="text-base font-semibold text-foreground">{title}</h2>
      <div className="mt-3 text-sm leading-6 text-muted">{children}</div>
    </section>
  );
}
