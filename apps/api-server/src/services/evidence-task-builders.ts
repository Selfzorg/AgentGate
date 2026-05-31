import type { EvidenceTaskSpec } from "@agentgate/core-types";
import { Prisma, type EvidenceTask, type GateCheckResult } from "@prisma/client";
import { subagentForCheck } from "./evidence-runtimes";
import {
  type EvidenceRuntimeId,
  type EvidenceSkillDefinition,
  normalizeEvidenceRuntimeId
} from "./evidence-skill-registry";
import type { EvidenceRun, EvidenceStatus } from "./evidence-task-types";
import { createId } from "./id";
import { contextSummary, recordFrom, resolvedSkillId, stringFrom } from "./object-utils";

export function evidenceTaskCreateData(input: {
  run: EvidenceRun;
  check: GateCheckResult;
  attempt: number;
  evidenceSkill: EvidenceSkillDefinition;
  selectedRuntime: EvidenceRuntimeId;
  requestedBy: string;
  evidenceTaskSpec?: EvidenceTaskSpec | undefined;
  extraInput?: Record<string, unknown> | undefined;
}): Prisma.EvidenceTaskUncheckedCreateInput {
  const subagent = subagentForCheck(input.check.checkKey);
  const targetSkillId = input.run.skill?.skillId ?? resolvedSkillId(input.run.resolvedSkillSnapshot);
  const attachedInstruction = instructionFromEvidenceSkill(input.evidenceSkill);

  return {
    id: createId("evtsk"),
    tenantId: input.run.tenantId,
    workspaceId: input.run.workspaceId,
    skillRunId: input.run.id,
    approvalRequestId: input.run.approvalRequest?.id ?? null,
    gateCheckResultId: input.check.id,
    traceId: input.run.traceId,
    checkKey: input.check.checkKey,
    label: input.check.label,
    evidenceSkillId: input.evidenceSkill.skillId,
    targetSkillId,
    runtime: input.selectedRuntime,
    status: "queued",
    priority: 0,
    attempt: input.attempt,
    input: {
      check_key: input.check.checkKey,
      label: input.check.label,
      raw_action: input.run.rawAction,
      context: contextSummary(recordFrom(input.run.context)),
      target_skill_id: targetSkillId,
      evidence_skill: evidenceSkillSnapshot(input.evidenceSkill),
      ...(input.evidenceTaskSpec ? { evidence_task: input.evidenceTaskSpec } : {}),
      subagent,
      instruction:
        input.evidenceTaskSpec?.instructions ||
        attachedInstruction ||
        `Verify ${input.check.label} for the requested action. Execute only read-only evidence collection.`,
      success_criteria: input.evidenceTaskSpec?.success_criteria ?? [],
      allowed_actions:
        input.evidenceTaskSpec && input.evidenceTaskSpec.allowed_actions.length > 0
          ? input.evidenceTaskSpec.allowed_actions
          : ["read_files", "rg", "git_show", "safe_shell"],
      target_files: input.evidenceTaskSpec?.target_files ?? [],
      ...(input.extraInput ?? {}),
      forbidden_actions: ["deploy", "merge", "write_files", "mutate_database", "call_production_systems"],
      expected_output_schema: {
        status: "passed | failed | missing",
        reason: "string",
        evidence: "object"
      }
    } as Prisma.InputJsonValue,
    result: {},
    error: {},
    createdBy: input.requestedBy
  };
}

export function evidenceForCompletedTask(input: {
  task: EvidenceTask & { skillRun: { rawAction: string; context: unknown; resolvedSkillSnapshot: unknown; skill: { skillId: string } | null } };
  evidenceSkill: EvidenceSkillDefinition;
  gateStatus: EvidenceStatus;
  reason: string;
  result: Record<string, unknown>;
  agentId: string;
}) {
  const supplied = recordFrom(input.result);
  const suppliedEvidence = recordFrom(supplied.evidence);

  return {
    source: "evidence_task",
    mode: input.task.runtime === "local_deterministic" ? "deterministic_local_runtime" : "async_agent_evidence_task",
    status: input.gateStatus,
    reason: input.reason,
    attempt: input.task.attempt,
    evidence_task_id: input.task.id,
    selected_runtime: input.task.runtime,
    claimed_by_agent_id: input.task.claimedByAgentId ?? input.agentId,
    subagent: subagentForCheck(input.task.checkKey),
    evidence_skill: evidenceSkillSnapshot(input.evidenceSkill),
    evidence_skill_id: input.evidenceSkill.skillId,
    target_skill_id:
      stringFrom(recordFrom(input.task.input).target_skill_id) ??
      input.task.skillRun.skill?.skillId ??
      resolvedSkillId(input.task.skillRun.resolvedSkillSnapshot),
    raw_action: input.task.skillRun.rawAction,
    observed_context: contextSummary(recordFrom(input.task.skillRun.context)),
    collected_at: new Date().toISOString(),
    submitted_by: input.agentId,
    details: Object.keys(suppliedEvidence).length > 0 ? suppliedEvidence : supplied
  };
}

export function evidenceSkillFromTask(task: EvidenceTask): EvidenceSkillDefinition {
  const input = recordFrom(task.input);
  const evidenceSkill = recordFrom(input.evidence_skill);
  return {
    checkKey: stringFrom(evidenceSkill.check_key) ?? task.checkKey,
    skillId: stringFrom(evidenceSkill.skill_id) ?? task.evidenceSkillId,
    name: stringFrom(evidenceSkill.name) ?? task.evidenceSkillId,
    description: stringFrom(evidenceSkill.description),
    version: stringFrom(evidenceSkill.version) ?? "unknown",
    connectorId: null,
    skillType: evidenceSkill.skill_type === "evidence" ? "evidence" : "execution",
    sideEffectLevel:
      evidenceSkill.side_effect_level === "read_only" || evidenceSkill.side_effect_level === "simulated"
        ? evidenceSkill.side_effect_level
        : "mutating",
    allowedRuntimes: runtimeListFrom(evidenceSkill.allowed_runtimes),
    preferredRuntimes: runtimeListFrom(evidenceSkill.preferred_runtimes),
    registrySource: evidenceSkill.registry_source === "database" ? "database" : "built_in_fallback",
    executionSnapshot: recordFrom(evidenceSkill.execution_snapshot)
  };
}

export function taskAllowsRuntime(task: EvidenceTask, runtime: EvidenceRuntimeId): boolean {
  const allowed = allowedRuntimesForTask(task);
  return allowed.includes(runtime);
}

export function allowedRuntimesForTask(task: EvidenceTask): EvidenceRuntimeId[] {
  const skill = evidenceSkillFromTask(task);
  return skill.allowedRuntimes.length > 0 ? skill.allowedRuntimes : ["local_deterministic"];
}

export function preferredRuntime(skill: EvidenceSkillDefinition, context: Record<string, unknown>, checkKey: string): EvidenceRuntimeId {
  const overrides = recordFrom(context.evidence_runtime_overrides);
  const overridePlan = runtimeListFrom(overrides[checkKey]);
  const allowed = new Set(skill.allowedRuntimes);
  const runtime = (overridePlan.length > 0 ? overridePlan : skill.preferredRuntimes).find((candidate) => allowed.has(candidate));
  return runtime ?? skill.allowedRuntimes[0] ?? "local_deterministic";
}

export function evidenceSkillSnapshot(skill: EvidenceSkillDefinition) {
  return {
    skill_id: skill.skillId,
    name: skill.name,
    description: skill.description ?? null,
    version: skill.version,
    check_key: skill.checkKey,
    skill_type: skill.skillType,
    side_effect_level: skill.sideEffectLevel,
    registry_source: skill.registrySource,
    allowed_runtimes: skill.allowedRuntimes,
    preferred_runtimes: skill.preferredRuntimes,
    ...(skill.executionSnapshot ? { execution_snapshot: skill.executionSnapshot } : {})
  };
}

function instructionFromEvidenceSkill(skill: EvidenceSkillDefinition) {
  const snapshot = recordFrom(skill.executionSnapshot);
  const body = stringFrom(snapshot.body);
  const entrypointContent = stringFrom(snapshot.entrypoint_content);
  return body ?? entrypointContent ?? skill.description ?? null;
}

function runtimeListFrom(value: unknown): EvidenceRuntimeId[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value.flatMap((entry) => {
        const runtime = normalizeEvidenceRuntimeId(entry);
        return runtime ? [runtime] : [];
      })
    )
  ];
}
