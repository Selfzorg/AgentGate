import { Check, FlaskConical, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ApprovalCard() {
  return (
    <section className="max-w-2xl rounded-ui border border-border bg-surface p-5 shadow-panel">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold">No pending approvals</h2>
          <p className="mt-1 text-sm leading-6 text-muted">
            Phase 2 will render approval packets with structured gate checks, dry-run evidence, and critical comment rules.
          </p>
        </div>
        <span className="rounded-ui border border-border px-2 py-1 text-xs text-muted">Phase 2</span>
      </div>
      <div className="mt-5 flex flex-wrap gap-2">
        <Button variant="secondary" disabled>
          <Check className="h-4 w-4" aria-hidden="true" />
          Approve Once
        </Button>
        <Button variant="secondary" disabled>
          <FlaskConical className="h-4 w-4" aria-hidden="true" />
          Force Dry-Run
        </Button>
        <Button variant="secondary" disabled>
          <X className="h-4 w-4" aria-hidden="true" />
          Deny
        </Button>
      </div>
    </section>
  );
}
