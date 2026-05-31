"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, Loader2, Power, PowerOff, Save, Search, X } from "lucide-react";
import { getPolicies, setPolicyStatus, upsertPolicy, type PolicyRecord } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";

type PolicyForm = {
  policy_id: string;
  name: string;
  priority: string;
  decision: PolicyRecord["decision"];
  reason: string;
  skill: string;
  environment: string;
  role: string;
  target_branch: string;
  dry_run_completed: "any" | "true" | "false";
  required_checks: string;
  approvers: string;
};

const emptyForm: PolicyForm = {
  policy_id: "",
  name: "",
  priority: "100",
  decision: "REQUIRE_APPROVAL",
  reason: "",
  skill: "",
  environment: "",
  role: "",
  target_branch: "",
  dry_run_completed: "any",
  required_checks: "",
  approvers: ""
};

function listValue(value: unknown): string {
  if (Array.isArray(value)) return value.join(", ") || "none";
  return "none";
}

export function PolicyViewer() {
  const [policies, setPolicies] = useState<PolicyRecord[]>([]);
  const [form, setForm] = useState<PolicyForm>(emptyForm);
  const [editingPolicyId, setEditingPolicyId] = useState<string | null>(null);
  const [policySearchText, setPolicySearchText] = useState("");
  const [status, setStatus] = useState("Loading seeded policies...");
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const editorRef = useRef<HTMLElement | null>(null);

  const sortedPolicies = useMemo(() => policies.slice().sort((left, right) => right.priority - left.priority), [policies]);
  const filteredPolicies = useMemo(() => {
    const query = policySearchText.trim().toLowerCase();
    if (!query) return sortedPolicies;
    return sortedPolicies.filter((policy) => policySearchHaystack(policy).includes(query));
  }, [policySearchText, sortedPolicies]);

  useEffect(() => {
    void loadPolicies();
  }, []);

  async function loadPolicies() {
    try {
      const response = await getPolicies({ includeInactive: true });
      setPolicies(response.policies);
      setStatus(`${response.policies.length} policies loaded from the API.`);
    } catch {
      setStatus("API unavailable. Start the Phase 1 dev server.");
    }
  }

  function editPolicy(policy: PolicyRecord) {
    const when = recordFrom(policy.when ?? recordFrom(policy.definition).when);
    setEditingPolicyId(policy.policy_id);
    setForm({
      policy_id: policy.policy_id,
      name: policy.name,
      priority: String(policy.priority),
      decision: policy.decision,
      reason: policy.reason,
      skill: stringFrom(when.skill),
      environment: stringFrom(when.environment),
      role: stringFrom(when.role),
      target_branch: stringFrom(when.target_branch),
      dry_run_completed: typeof when.dry_run_completed === "boolean" ? String(when.dry_run_completed) as "true" | "false" : "any",
      required_checks: listValue(policy.required_checks) === "none" ? "" : listValue(policy.required_checks),
      approvers: listValue(policy.approvers) === "none" ? "" : listValue(policy.approvers)
    });
    setStatus(`Editing ${policy.policy_id}. Saving creates a new active policy version.`);
    window.requestAnimationFrame(() => {
      editorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      editorRef.current?.querySelector<HTMLInputElement>("input")?.focus({ preventScroll: true });
    });
  }

  function resetEditor() {
    setEditingPolicyId(null);
    setForm(emptyForm);
    setStatus(`${policies.length} policies loaded from the API.`);
  }

  async function savePolicy() {
    const when: Record<string, unknown> = {};
    if (form.skill.trim()) when.skill = form.skill.trim();
    if (form.environment.trim()) when.environment = form.environment.trim();
    if (form.role.trim()) when.role = form.role.trim();
    if (form.target_branch.trim()) when.target_branch = form.target_branch.trim();
    if (form.dry_run_completed !== "any") when.dry_run_completed = form.dry_run_completed === "true";

    setPendingAction("save-policy");
    try {
      const response = await upsertPolicy({
        policy_id: form.policy_id.trim(),
        name: form.name.trim(),
        priority: Number.parseInt(form.priority, 10),
        decision: form.decision,
        reason: form.reason.trim(),
        when,
        required_checks: splitCsv(form.required_checks),
        approvers: splitCsv(form.approvers)
      });
      const warningText = response.warnings?.length ? ` Warnings: ${response.warnings.join(" ")}` : "";
      setStatus(`Saved ${response.policy.policy_id}. A new active policy version is available.${warningText}`);
      setEditingPolicyId(null);
      setForm(emptyForm);
      await loadPolicies();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Policy save failed.");
    } finally {
      setPendingAction(null);
    }
  }

  async function togglePolicy(policy: PolicyRecord) {
    const next = policy.status === "inactive" ? "enable" : "disable";
    setPendingAction(`${next}:${policy.id}`);
    try {
      await setPolicyStatus(policy.policy_id, next);
      setStatus(`${policy.policy_id} ${next === "enable" ? "enabled" : "disabled"}.`);
      await loadPolicies();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Policy status update failed.");
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <div className="grid min-w-0 gap-5">
      <section ref={editorRef} className="min-w-0 scroll-mt-24 rounded-ui border border-border bg-surface p-5 shadow-panel">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">Policy Editor</h2>
            <p className="mt-1 text-sm text-muted">Create or edit policy rules. Saves create a new active PolicyVersion.</p>
          </div>
          {editingPolicyId ? <StatusBadge kind="gate" value="preview" label={`Editing ${editingPolicyId}`} /> : null}
        </div>
        <div className="mt-4 grid gap-3 lg:grid-cols-2 xl:grid-cols-4">
          <PolicyField label="Policy ID" value={form.policy_id} onChange={(value) => setForm((current) => ({ ...current, policy_id: value }))} />
          <PolicyField label="Name" value={form.name} onChange={(value) => setForm((current) => ({ ...current, name: value }))} />
          <PolicyField label="Priority" value={form.priority} onChange={(value) => setForm((current) => ({ ...current, priority: value }))} />
          <label className="min-w-0">
            <span className="text-xs font-semibold uppercase text-muted">Decision</span>
            <select
              suppressHydrationWarning
              value={form.decision}
              onChange={(event) => setForm((current) => ({ ...current, decision: event.target.value as PolicyRecord["decision"] }))}
              className="mt-1 h-9 w-full rounded-ui border border-border bg-background px-2 text-sm outline-none focus:border-accent"
            >
              <option value="ALLOW">ALLOW</option>
              <option value="DENY">DENY</option>
              <option value="REQUIRE_APPROVAL">REQUIRE_APPROVAL</option>
              <option value="FORCE_DRY_RUN">FORCE_DRY_RUN</option>
            </select>
          </label>
          <PolicyField label="Reason" value={form.reason} onChange={(value) => setForm((current) => ({ ...current, reason: value }))} multiline className="lg:col-span-2 xl:col-span-4" />
          <PolicyField label="when.skill" value={form.skill} onChange={(value) => setForm((current) => ({ ...current, skill: value }))} />
          <PolicyField label="when.environment" value={form.environment} onChange={(value) => setForm((current) => ({ ...current, environment: value }))} />
          <PolicyField label="when.role" value={form.role} onChange={(value) => setForm((current) => ({ ...current, role: value }))} />
          <PolicyField label="when.target_branch" value={form.target_branch} onChange={(value) => setForm((current) => ({ ...current, target_branch: value }))} />
          <label>
            <span className="text-xs font-semibold uppercase text-muted">when.dry_run_completed</span>
            <select
              suppressHydrationWarning
              value={form.dry_run_completed}
              onChange={(event) => setForm((current) => ({ ...current, dry_run_completed: event.target.value as PolicyForm["dry_run_completed"] }))}
              className="mt-1 h-9 w-full rounded-ui border border-border bg-background px-2 text-sm outline-none focus:border-accent"
            >
              <option value="any">Any</option>
              <option value="true">true</option>
              <option value="false">false</option>
            </select>
          </label>
          <PolicyField label="Required Checks" value={form.required_checks} onChange={(value) => setForm((current) => ({ ...current, required_checks: value }))} />
          <PolicyField label="Approvers" value={form.approvers} onChange={(value) => setForm((current) => ({ ...current, approvers: value }))} />
          <div className="flex flex-wrap gap-2 lg:col-span-2 xl:col-span-4">
            <Button disabled={pendingAction === "save-policy"} onClick={() => void savePolicy()}>
              {pendingAction === "save-policy" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {editingPolicyId ? "Save Policy Version" : "Save Policy"}
            </Button>
            <Button variant="secondary" onClick={resetEditor}>
              {editingPolicyId ? "Cancel Edit" : "New Policy"}
            </Button>
            {editingPolicyId ? (
              <Button variant="ghost" onClick={() => setPolicySearchText(editingPolicyId)}>
                <Search className="h-4 w-4" />
                Find In List
              </Button>
            ) : null}
          </div>
          <p className="text-sm text-muted lg:col-span-2 xl:col-span-4">{status}</p>
        </div>
      </section>

      <section className="min-w-0 overflow-hidden rounded-ui border border-border bg-surface shadow-panel">
        <div className="border-b border-border p-5">
          <h2 className="text-base font-semibold">Policy Precedence</h2>
          <p className="mt-1 text-sm text-muted">Higher priority policies win after DENY precedence is applied by the policy engine.</p>
          <div className="mt-4 flex flex-col gap-2 md:flex-row md:items-center">
            <label className="relative min-w-0 flex-1">
              <span className="sr-only">Search Policies</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden="true" />
              <input
                suppressHydrationWarning
                value={policySearchText}
                onChange={(event) => setPolicySearchText(event.target.value)}
                placeholder="Search policies by name, ID, decision, condition, check, or approver"
                className="h-10 w-full rounded-ui border border-border bg-background pl-9 pr-3 text-sm outline-none focus:border-accent"
              />
            </label>
            <Button variant="secondary" disabled={!policySearchText} onClick={() => setPolicySearchText("")}>
              <X className="h-4 w-4" />
              Clear Search
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted">
            Showing {filteredPolicies.length} of {policies.length} policies.
          </p>
        </div>
        <div className="grid gap-0 divide-y divide-border">
          {filteredPolicies.map((policy) => (
            <article
              key={policy.id}
              className="grid min-w-0 gap-4 p-5 xl:grid-cols-[minmax(180px,0.9fr)_minmax(150px,auto)_minmax(0,1.4fr)_auto] xl:items-start"
            >
              <div className="min-w-0">
                <h3 className="text-sm font-semibold">{policy.name}</h3>
                <p className="mt-1 break-all font-mono text-xs text-muted">{policy.policy_id}</p>
                <p className="mt-1 font-mono text-xs text-muted">v{policy.version}</p>
              </div>
              <div className="flex min-w-0 flex-wrap gap-2 xl:justify-end">
                <StatusBadge kind="decision" value={policy.decision} />
                <StatusBadge kind="gate" value={policy.status ?? "active"} />
                <div className="font-mono text-xs text-muted">priority {policy.priority}</div>
              </div>
              <div className="min-w-0 text-sm leading-6 text-muted">
                <p className="break-words">{policy.reason}</p>
                <p className="mt-2 break-words font-mono text-xs">
                  when: {stableJson(policy.when ?? recordFrom(policy.definition).when)}
                  <br />
                  checks: {listValue(policy.required_checks)}
                  <br />
                  approvers: {listValue(policy.approvers)}
                </p>
              </div>
              <div className="flex flex-wrap gap-2 xl:justify-end">
                <Button variant="secondary" onClick={() => editPolicy(policy)}>
                  <CheckCircle2 className="h-4 w-4" />
                  {editingPolicyId === policy.policy_id ? "Editing" : "Edit"}
                </Button>
                <Button
                  variant="secondary"
                  disabled={pendingAction === `enable:${policy.id}` || pendingAction === `disable:${policy.id}`}
                  onClick={() => void togglePolicy(policy)}
                >
                  {pendingAction === `enable:${policy.id}` || pendingAction === `disable:${policy.id}` ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : policy.status === "inactive" ? (
                    <Power className="h-4 w-4" />
                  ) : (
                    <PowerOff className="h-4 w-4" />
                  )}
                  {policy.status === "inactive" ? "Enable" : "Disable"}
                </Button>
              </div>
            </article>
          ))}
          {policies.length === 0 ? <div className="p-5 text-sm text-muted">No policies loaded yet. Run migration and seed before the demo.</div> : null}
          {policies.length > 0 && filteredPolicies.length === 0 ? (
            <div className="p-5 text-sm text-muted">No policies match the current search.</div>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function PolicyField({
  label,
  value,
  multiline,
  className,
  onChange
}: {
  label: string;
  value: string;
  multiline?: boolean;
  className?: string;
  onChange: (value: string) => void;
}) {
  const fieldClassName = "mt-1 w-full rounded-ui border border-border bg-background px-2 py-1 text-sm outline-none focus:border-accent";
  return (
    <label className={className}>
      <span className="text-xs font-semibold uppercase text-muted">{label}</span>
      {multiline ? (
        <textarea suppressHydrationWarning value={value} rows={3} onChange={(event) => onChange(event.target.value)} className={fieldClassName} />
      ) : (
        <input suppressHydrationWarning value={value} onChange={(event) => onChange(event.target.value)} className={fieldClassName} />
      )}
    </label>
  );
}

function splitCsv(value: string) {
  return value.split(",").map((entry) => entry.trim()).filter(Boolean);
}

function recordFrom(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function stringFrom(value: unknown) {
  return typeof value === "string" ? value : "";
}

function policySearchHaystack(policy: PolicyRecord) {
  return [
    policy.policy_id,
    policy.name,
    policy.status,
    policy.version,
    policy.version_status,
    policy.decision,
    String(policy.priority),
    policy.reason,
    stableJson(policy.when ?? recordFrom(policy.definition).when),
    stableJson(policy.definition),
    listValue(policy.required_checks),
    listValue(policy.approvers)
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function stableJson(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return JSON.stringify(value);
  const record = value as Record<string, unknown>;
  return JSON.stringify(Object.fromEntries(Object.keys(record).sort().map((key) => [key, record[key]])));
}
