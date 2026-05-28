import type { EvidenceWorker } from "@prisma/client";
import { recordFrom, stringFrom } from "./object-utils";

export type EvidenceWorkerCapabilities = {
  runtimeIds: string[];
  allowedTools: string[];
  sideEffectLevels: string[];
  maxParallelTasks: number | null;
  supportsJsonSchema: boolean;
};

export function normalizeEvidenceWorkerCapabilities(input: {
  runtime: string;
  metadata?: Record<string, unknown> | undefined;
  capabilities?: Record<string, unknown> | undefined;
}): EvidenceWorkerCapabilities {
  const metadata = recordFrom(input.metadata);
  const capabilities = {
    ...recordFrom(metadata.capabilities),
    ...recordFrom(input.capabilities)
  };

  return {
    runtimeIds: uniqueStrings(capabilities.runtime_ids ?? capabilities.runtimes ?? capabilities.runtimeIds, [input.runtime]),
    allowedTools: uniqueStrings(capabilities.allowed_tools ?? capabilities.allowedTools, []),
    sideEffectLevels: uniqueStrings(capabilities.side_effect_levels ?? capabilities.sideEffectLevels, ["read_only"]),
    maxParallelTasks: positiveNumber(capabilities.max_parallel_tasks ?? capabilities.maxParallelTasks),
    supportsJsonSchema: booleanFrom(capabilities.supports_json_schema ?? capabilities.supportsJsonSchema)
  };
}

export function metadataWithCapabilities(input: {
  runtime: string;
  metadata?: Record<string, unknown> | undefined;
  capabilities?: Record<string, unknown> | undefined;
}) {
  const metadata = recordFrom(input.metadata);
  const capabilities = normalizeEvidenceWorkerCapabilities(input);
  return {
    ...metadata,
    capabilities: serializeEvidenceWorkerCapabilities(capabilities)
  };
}

export function serializeEvidenceWorkerCapabilities(capabilities: EvidenceWorkerCapabilities) {
  return {
    runtime_ids: capabilities.runtimeIds,
    allowed_tools: capabilities.allowedTools,
    side_effect_levels: capabilities.sideEffectLevels,
    max_parallel_tasks: capabilities.maxParallelTasks,
    supports_json_schema: capabilities.supportsJsonSchema
  };
}

export function capabilitiesForWorker(worker: Pick<EvidenceWorker, "runtime" | "metadata">): EvidenceWorkerCapabilities {
  return normalizeEvidenceWorkerCapabilities({
    runtime: worker.runtime,
    metadata: recordFrom(worker.metadata)
  });
}

export function workerCapabilityClaimError(input: {
  worker: Pick<EvidenceWorker, "runtime" | "metadata"> | null;
  requestedRuntime: string;
  sideEffectLevel: string;
}): string | null {
  if (!input.worker) return null;

  const capabilities = capabilitiesForWorker(input.worker);
  if (!capabilities.runtimeIds.includes(input.requestedRuntime)) {
    return `Worker capabilities do not allow runtime ${input.requestedRuntime}.`;
  }

  if (!capabilities.sideEffectLevels.includes(input.sideEffectLevel)) {
    return `Worker capabilities do not allow ${input.sideEffectLevel} evidence skills.`;
  }

  return null;
}

function uniqueStrings(value: unknown, fallback: string[]): string[] {
  const values = Array.isArray(value) ? value : [];
  const normalized = values.flatMap((entry) => {
    const resolved = stringFrom(entry);
    return resolved ? [resolved] : [];
  });
  return normalized.length > 0 ? [...new Set(normalized)] : fallback;
}

function positiveNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function booleanFrom(value: unknown): boolean {
  return value === true || value === "true";
}
