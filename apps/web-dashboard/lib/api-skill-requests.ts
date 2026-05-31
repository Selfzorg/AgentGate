import type { EvidenceTaskSpec, SkillImportBatch, SkillRecord, SkillRegistryScan } from "./api-types";
import { apiBaseUrl } from "./api-config";

export async function getSkills(options: { source?: string; includeInactive?: boolean } = {}): Promise<{ skills: SkillRecord[] }> {
  const params = new URLSearchParams();
  if (options.source) params.set("source", options.source);
  if (options.includeInactive) params.set("include_inactive", "true");
  const response = await fetch(`${apiBaseUrl}/api/v1/skills${params.size > 0 ? `?${params.toString()}` : ""}`, {
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`Failed to load skills: ${response.status}`);
  }

  return (await response.json()) as { skills: SkillRecord[] };
}

export async function scanSkillRegistry(input: {
  rootDir?: string;
  includeUserScopes?: boolean;
  persistSnapshot?: boolean;
}): Promise<{ scan: SkillRegistryScan; import_batch: SkillImportBatch | null }> {
  const response = await fetch(`${apiBaseUrl}/api/v1/registry/scan`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      root_dir: input.rootDir || undefined,
      include_user_scopes: input.includeUserScopes,
      persist_snapshot: input.persistSnapshot
    }),
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return (await response.json()) as { scan: SkillRegistryScan; import_batch: SkillImportBatch | null };
}

export async function createSkillImport(input: {
  rootDir?: string;
  includeUserScopes?: boolean;
}): Promise<{ import_batch: SkillImportBatch; scan: SkillRegistryScan }> {
  const response = await fetch(`${apiBaseUrl}/api/v1/registry/import`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      root_dir: input.rootDir || undefined,
      include_user_scopes: input.includeUserScopes
    }),
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return (await response.json()) as { import_batch: SkillImportBatch; scan: SkillRegistryScan };
}

export async function getSkillImportBatch(batchId: string): Promise<{ import_batch: SkillImportBatch }> {
  const response = await fetch(`${apiBaseUrl}/api/v1/registry/import-batches/${encodeURIComponent(batchId)}`, {
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return (await response.json()) as { import_batch: SkillImportBatch };
}

export async function approveSkillImportBatch(
  batchId: string,
  input: {
    candidateIds?: string[];
    candidateReviews?: Array<{
      candidateId: string;
      requiredChecks?: string[];
      policyAliases?: string[];
      evidenceTasks?: EvidenceTaskSpec[];
    }>;
    owners?: string[];
    approverRoles?: string[];
    comment?: string;
  } = {}
): Promise<{ import_batch: SkillImportBatch; imported: unknown[]; skipped: unknown[]; disabled: unknown[] }> {
  const response = await fetch(`${apiBaseUrl}/api/v1/registry/import-batches/${encodeURIComponent(batchId)}/approve`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      candidate_ids: input.candidateIds,
      candidate_reviews: input.candidateReviews?.map((review) => ({
        candidate_id: review.candidateId,
        required_checks: review.requiredChecks,
        policy_aliases: review.policyAliases,
        evidence_tasks: review.evidenceTasks
      })),
      owners: input.owners,
      approver_roles: input.approverRoles,
      comment: input.comment
    }),
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return (await response.json()) as { import_batch: SkillImportBatch; imported: unknown[]; skipped: unknown[]; disabled: unknown[] };
}

export async function updateSkillEvidenceTasks(
  skillId: string,
  evidenceTasks: EvidenceTaskSpec[]
): Promise<{ skill_version: { id: string; skill_id: string; version: string; status: string; evidence_tasks: EvidenceTaskSpec[] } }> {
  const response = await fetch(`${apiBaseUrl}/api/v1/skills/${encodeURIComponent(skillId)}/evidence-tasks`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      evidence_tasks: evidenceTasks
    }),
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return (await response.json()) as {
    skill_version: { id: string; skill_id: string; version: string; status: string; evidence_tasks: EvidenceTaskSpec[] };
  };
}

export async function updateSkillPolicyBindings(
  skillId: string,
  policyAliases: string[]
): Promise<{
  skill_version: { id: string; skill_id: string; version: string; status: string; policy_aliases: string[] };
  warnings?: string[];
  noop?: boolean;
}> {
  const response = await fetch(`${apiBaseUrl}/api/v1/skills/${encodeURIComponent(skillId)}/policy-bindings`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      policy_aliases: policyAliases
    }),
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return (await response.json()) as {
    skill_version: { id: string; skill_id: string; version: string; status: string; policy_aliases: string[] };
    warnings?: string[];
    noop?: boolean;
  };
}

export async function rejectSkillImportBatch(batchId: string, comment?: string): Promise<{ import_batch: SkillImportBatch }> {
  const response = await fetch(`${apiBaseUrl}/api/v1/registry/import-batches/${encodeURIComponent(batchId)}/reject`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ comment }),
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return (await response.json()) as { import_batch: SkillImportBatch };
}

export async function setSkillVersionStatus(
  skillId: string,
  version: string,
  status: "enable" | "disable"
): Promise<{ skill_version: { id: string; skill_id: string; version: string; status: string } }> {
  const response = await fetch(
    `${apiBaseUrl}/api/v1/skills/${encodeURIComponent(skillId)}/versions/${encodeURIComponent(version)}/${status}`,
    {
      method: "POST",
      cache: "no-store"
    }
  );

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return (await response.json()) as { skill_version: { id: string; skill_id: string; version: string; status: string } };
}
