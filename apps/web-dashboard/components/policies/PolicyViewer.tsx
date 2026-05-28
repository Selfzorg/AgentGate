"use client";

import { useEffect, useState } from "react";
import { getPolicies, type PolicyRecord } from "@/lib/api-client";
import { StatusBadge } from "@/components/ui/status-badge";

function listValue(value: unknown): string {
  if (Array.isArray(value)) return value.join(", ") || "none";
  return "none";
}

export function PolicyViewer() {
  const [policies, setPolicies] = useState<PolicyRecord[]>([]);
  const [status, setStatus] = useState("Loading seeded policies...");

  useEffect(() => {
    void getPolicies()
      .then((response) => {
        setPolicies(response.policies);
        setStatus(`${response.policies.length} policies loaded from the API.`);
      })
      .catch(() => setStatus("API unavailable. Start the Phase 1 dev server."));
  }, []);

  return (
    <section className="overflow-hidden rounded-ui border border-border bg-surface shadow-panel">
      <div className="border-b border-border p-5">
        <h2 className="text-base font-semibold">Policy Precedence</h2>
        <p className="mt-1 text-sm text-muted">{status}</p>
      </div>
      <div className="grid gap-0 divide-y divide-border">
        {policies
          .slice()
          .sort((left, right) => right.priority - left.priority)
          .map((policy) => (
            <article key={policy.id} className="grid gap-4 p-5 lg:grid-cols-[1.1fr_auto_1.5fr] lg:items-start">
              <div>
                <h3 className="text-sm font-semibold">{policy.name}</h3>
                <p className="mt-1 font-mono text-xs text-muted">{policy.policy_id}</p>
              </div>
              <div className="lg:text-right">
                <StatusBadge kind="decision" value={policy.decision} />
                <div className="font-mono text-xs text-muted">priority {policy.priority}</div>
              </div>
              <div className="text-sm leading-6 text-muted">
                <p>{policy.reason}</p>
                <p className="mt-2 font-mono text-xs">
                  checks: {listValue(policy.required_checks)}
                  <br />
                  approvers: {listValue(policy.approvers)}
                </p>
              </div>
            </article>
          ))}
        {policies.length === 0 ? (
          <div className="p-5 text-sm text-muted">
            No policies loaded yet. Run migration and seed before the demo.
          </div>
        ) : null}
      </div>
    </section>
  );
}
