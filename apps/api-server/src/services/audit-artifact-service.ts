import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { createId } from "./id";

export type CreateAuditArtifactInput = {
  tenantId: string;
  workspaceId: string;
  skillRunId?: string | undefined;
  auditEventId?: string | undefined;
  artifactId: string;
  type: string;
  uri?: string | undefined;
  payload: unknown;
  metadata?: Record<string, unknown> | undefined;
};

export async function createAuditArtifact(prisma: PrismaClient, input: CreateAuditArtifactInput) {
  const canonicalPayload = canonicalJson(input.payload);
  return prisma.auditArtifact.create({
    data: {
      id: createId("artifact"),
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      skillRunId: input.skillRunId ?? null,
      auditEventId: input.auditEventId ?? null,
      artifactId: input.artifactId,
      type: input.type,
      uri: input.uri ?? null,
      metadata: {
        ...(input.metadata ?? {}),
        payload: input.payload,
        payload_sha256: sha256(canonicalPayload),
        canonicalization: "json-stable-v1"
      } as Prisma.InputJsonValue
    }
  });
}

export async function verifyAuditArtifacts(
  prisma: PrismaClient,
  input: { skillRunId?: string | undefined; auditEventId?: string | undefined } = {}
) {
  const artifacts = await prisma.auditArtifact.findMany({
    where: {
      ...(input.skillRunId ? { skillRunId: input.skillRunId } : {}),
      ...(input.auditEventId ? { auditEventId: input.auditEventId } : {})
    },
    orderBy: { createdAt: "asc" }
  });

  const results = artifacts.map((artifact) => {
    const metadata = recordFrom(artifact.metadata);
    const expected = typeof metadata.payload_sha256 === "string" ? metadata.payload_sha256 : null;
    const actual = "payload" in metadata ? sha256(canonicalJson(metadata.payload)) : null;
    const checksumValid = Boolean(expected && actual && expected === actual);
    return {
      artifact_id: artifact.artifactId,
      database_id: artifact.id,
      type: artifact.type,
      checksum_valid: checksumValid,
      expected_sha256: expected,
      actual_sha256: actual,
      issue: checksumValid ? null : "Audit artifact payload checksum mismatch or missing checksum."
    };
  });

  return {
    checked_at: new Date().toISOString(),
    artifact_count: artifacts.length,
    complete: results.every((result) => result.checksum_valid),
    artifacts: results,
    issues: results.flatMap((result) => (result.issue ? [`${result.artifact_id}: ${result.issue}`] : []))
  };
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, sortJson(entry)])
  );
}

function recordFrom(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
