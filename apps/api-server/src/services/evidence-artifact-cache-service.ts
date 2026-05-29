import { createHash } from "node:crypto";
import { Prisma, type GateCheckStatus, type PrismaClient } from "@prisma/client";
import { recordFrom, stringFrom } from "./object-utils";

const DEFAULT_EVIDENCE_CACHE_TTL_SECONDS = 600;

export type EvidenceCacheTargetIdentity = {
  repo: string | null;
  commitSha: string | null;
  environment: "dev" | "staging" | "production" | null;
  hash: string;
  cacheable: boolean;
};

export function evidenceCacheTargetIdentity(input: {
  checkKey: string;
  context: unknown;
  environment?: string | null | undefined;
}): EvidenceCacheTargetIdentity {
  const context = recordFrom(input.context);
  const repo = firstString(context.repo, context.repository, context.repo_url);
  const commitSha = firstString(context.commit_sha, context.commit, context.head_sha, context.pr_head_sha);
  const environment = environmentFrom(input.environment ?? context.environment);
  const cacheable = Boolean(commitSha);
  const hash = createHash("sha256")
    .update(
      JSON.stringify({
        check_key: input.checkKey,
        repo,
        commit_sha: commitSha,
        environment
      })
    )
    .digest("hex");

  return {
    repo,
    commitSha,
    environment,
    hash,
    cacheable
  };
}

export async function findReusableEvidenceArtifact(
  prisma: PrismaClient,
  input: {
    tenantId: string;
    workspaceId: string;
    checkKey: string;
    context: unknown;
    environment?: string | null | undefined;
  }
) {
  const identity = evidenceCacheTargetIdentity(input);
  if (!identity.cacheable) return null;

  const cached = await prisma.evidenceArtifactCache.findUnique({
    where: {
      tenantId_workspaceId_checkKey_targetIdentityHash: {
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        checkKey: input.checkKey,
        targetIdentityHash: identity.hash
      }
    }
  });

  if (!cached || cached.expiresAt <= new Date()) return null;

  return {
    id: cached.id,
    status: cached.status,
    reason: cached.reason,
    evidence: cached.evidence,
    confidence: cached.confidence,
    collected_at: cached.collectedAt.toISOString(),
    expires_at: cached.expiresAt.toISOString(),
    target_identity: identity
  };
}

export async function upsertEvidenceArtifactCache(
  prisma: Prisma.TransactionClient,
  input: {
    tenantId: string;
    workspaceId: string;
    checkKey: string;
    context: unknown;
    environment?: string | null | undefined;
    status: GateCheckStatus;
    reason: string;
    evidence: Record<string, unknown>;
    sourceTaskId: string;
  }
) {
  const identity = evidenceCacheTargetIdentity(input);
  if (!identity.cacheable) return null;

  const now = new Date();
  const ttlSeconds = ttlSecondsFrom(input.evidence);
  const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);

  return prisma.evidenceArtifactCache.upsert({
    where: {
      tenantId_workspaceId_checkKey_targetIdentityHash: {
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        checkKey: input.checkKey,
        targetIdentityHash: identity.hash
      }
    },
    create: {
      id: createHash("sha256").update(`${input.tenantId}:${input.workspaceId}:${input.checkKey}:${identity.hash}`).digest("hex").slice(0, 24),
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      checkKey: input.checkKey,
      targetIdentityHash: identity.hash,
      repo: identity.repo,
      commitSha: identity.commitSha,
      environment: identity.environment,
      status: input.status,
      reason: input.reason,
      evidence: input.evidence as Prisma.InputJsonValue,
      confidence: confidenceFrom(input.evidence),
      sourceTaskId: input.sourceTaskId,
      collectedAt: now,
      expiresAt
    },
    update: {
      repo: identity.repo,
      commitSha: identity.commitSha,
      environment: identity.environment,
      status: input.status,
      reason: input.reason,
      evidence: input.evidence as Prisma.InputJsonValue,
      confidence: confidenceFrom(input.evidence),
      sourceTaskId: input.sourceTaskId,
      collectedAt: now,
      expiresAt
    }
  });
}

function ttlSecondsFrom(evidence: Record<string, unknown>) {
  const explicit = Number(evidence.freshness_ttl_seconds ?? evidence.ttl_seconds);
  if (Number.isFinite(explicit) && explicit > 0) return Math.min(explicit, 86_400);
  return DEFAULT_EVIDENCE_CACHE_TTL_SECONDS;
}

function confidenceFrom(evidence: Record<string, unknown>) {
  const explicit = Number(evidence.confidence);
  if (Number.isFinite(explicit) && explicit >= 0 && explicit <= 1) return explicit;
  return 0.8;
}

function environmentFrom(value: unknown): "dev" | "staging" | "production" | null {
  if (value === "dev" || value === "staging" || value === "production") return value;
  return null;
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    const resolved = stringFrom(value);
    if (resolved) return resolved;
  }
  return null;
}
