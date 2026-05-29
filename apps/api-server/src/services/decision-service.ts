import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { NormalizedActionRequest } from "@agentgate/core-types";
import { loadDemoFixtures } from "@agentgate/config-loader";
import { evaluatePolicy } from "@agentgate/policy-engine";
import { scoreRisk } from "@agentgate/risk-engine";
import { resolveSkill } from "@agentgate/skill-resolver";
import { Prisma, type PrismaClient } from "@prisma/client";
import { normalizeActionRequest, prismaAgentSource } from "./action-request-schema";
import { createOrUpdateApprovalRequest } from "./approval-service";
import { collectEvidenceForRun } from "./evidence-collection-service";
import { createGateCheckResults } from "./gate-check-service";
import { createId } from "./id";
import { mergeRequiredChecks } from "./imported-skill-governance";
import { loadActivePolicyRules } from "./policy-registry-service";
import { resolveImportedRegistrySkill } from "./registry-resolution-service";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

export type DecisionServiceResult = {
  decision: "ALLOW" | "DENY" | "REQUIRE_APPROVAL" | "FORCE_DRY_RUN";
  skill_id: string;
  skill_version: string;
  risk_level: "low" | "medium" | "high" | "critical";
  risk_score: number;
  risk_reasons: string[];
  reason: string;
  trace_id: string;
  run_id: string;
  mode: "observe" | "warn" | "enforce";
  policy_decision?: "ALLOW" | "DENY" | "REQUIRE_APPROVAL" | "FORCE_DRY_RUN";
  dry_run_required?: boolean;
  missing_checks?: string[];
};

export type DecisionService = {
  evaluate(rawRequest: unknown): Promise<DecisionServiceResult>;
};

export function createDecisionService({
  prisma,
  configDir = join(repoRoot, "configs")
}: {
  prisma: PrismaClient;
  configDir?: string;
}): DecisionService {
  return {
    async evaluate(rawRequest) {
      const request = normalizeActionRequest(rawRequest);
      const fixtures = await loadDemoFixtures(configDir);
      const traceId = createId("trc");
      const runId = createId("run");

      const importedResolution = await resolveImportedRegistrySkill(prisma, {
        tenantId: request.tenant_id,
        workspaceId: request.workspace_id,
        rawAction: request.raw_action,
        toolName: request.tool.tool_name,
        source: request.source,
        context: request.context
      });
      const resolvedSkill = importedResolution.resolvedSkill ?? resolveSkill({
        rawAction: request.raw_action,
        toolName: request.tool.tool_name,
        context: request.context
      });

      const risk = scoreRisk({
        resolvedSkill,
        rawAction: request.raw_action,
        context: request.context
      });

      const policyRules = await loadActivePolicyRules(prisma, {
        tenantId: request.tenant_id,
        workspaceId: request.workspace_id,
        fallbackRules: fixtures.policies.rules
      });
      const policy = evaluatePolicy({
        rules: policyRules,
        role: request.agent.role,
        skill_id: resolvedSkill.skill_id,
        skill_aliases: resolvedSkill.policy_aliases,
        risk_level: risk.risk_level,
        context: request.context
      });
      const importedRequiredChecks = Array.isArray(resolvedSkill.required_checks) ? resolvedSkill.required_checks : [];
      const requiredChecks = mergeRequiredChecks(policy.required_checks, importedRequiredChecks);
      const mode = governanceModeFromContext(request.context);
      const effectiveDecision = mode === "enforce" ? policy.decision : "ALLOW";
      const effectiveReason =
        mode === "enforce" ? policy.reason : `${mode} mode observed policy decision ${policy.decision}: ${policy.reason}`;

      const [agent, skill, matchedPolicy] = await Promise.all([
        prisma.agent.findUnique({
          where: {
            tenantId_workspaceId_externalAgentId: {
              tenantId: request.tenant_id,
              workspaceId: request.workspace_id,
              externalAgentId: request.agent.agent_id
            }
          }
        }),
        prisma.skill.findUnique({
          where: {
            tenantId_workspaceId_skillId: {
              tenantId: request.tenant_id,
              workspaceId: request.workspace_id,
              skillId: resolvedSkill.skill_id
            }
          }
        }),
        policy.matched_policy
          ? prisma.policy.findUnique({
              where: {
                tenantId_workspaceId_policyId: {
                  tenantId: request.tenant_id,
                  workspaceId: request.workspace_id,
                  policyId: policy.matched_policy.policy_id
                }
              }
            })
          : Promise.resolve(null)
      ]);

      const shouldCollectEvidence = mode === "enforce" && policy.decision === "REQUIRE_APPROVAL" && requiredChecks.length > 0;
      const missingChecks = shouldCollectEvidence ? requiredChecks : missingChecksForRequest(requiredChecks, request.context);
      const status = statusForDecision(effectiveDecision);

      await prisma.$transaction(async (tx) => {
        const skillRunData: Prisma.SkillRunUncheckedCreateInput = {
          id: runId,
          tenantId: request.tenant_id,
          workspaceId: request.workspace_id,
          traceId,
          source: prismaAgentSource(request.source),
          adapterType: request.adapter_type,
          rawAction: request.raw_action,
          mode,
          decision: effectiveDecision,
          riskLevel: risk.risk_level,
          riskScore: risk.risk_score,
          riskReasons: risk.risk_reasons as Prisma.InputJsonValue,
          context: request.context as Prisma.InputJsonValue,
          requestedAt: request.requested_at ? new Date(request.requested_at) : new Date(),
          status,
          reason: effectiveReason,
          resolvedSkillSnapshot: resolvedSkill as Prisma.InputJsonValue,
          policySnapshot: {
            matched_policy_id: policy.matched_policy?.policy_id ?? null,
            reason: effectiveReason,
            policy_decision: policy.decision,
            decision: effectiveDecision,
            mode,
            policy_required_checks: policy.required_checks,
            imported_required_checks: importedRequiredChecks,
            required_checks: requiredChecks,
            approvers: policy.approvers,
            missing_checks: missingChecks,
            rules_source: policyRules === fixtures.policies.rules ? "fixture_fallback" : "database"
          } as Prisma.InputJsonValue
        };

        if (request.context.environment) skillRunData.environment = request.context.environment;
        if (agent) skillRunData.agentId = agent.id;
        if (skill) skillRunData.skillRecordId = skill.id;
        if (matchedPolicy) skillRunData.matchedPolicyRecordId = matchedPolicy.id;

        await tx.skillRun.create({
          data: skillRunData
        });

        if (requiredChecks.length > 0) {
          await createGateCheckResults(tx, {
            tenantId: request.tenant_id,
            workspaceId: request.workspace_id,
            skillRunId: runId,
            skillId: resolvedSkill.skill_id,
            requiredChecks,
            context: request.context,
            mode: shouldCollectEvidence ? "pending" : "context"
          });
        }

        if (mode === "enforce" && policy.decision === "REQUIRE_APPROVAL") {
          await createOrUpdateApprovalRequest(tx, {
            tenantId: request.tenant_id,
            workspaceId: request.workspace_id,
            skillRunId: runId,
            traceId,
            riskLevel: risk.risk_level,
            missingChecks,
            requiredApprovers: policy.approvers,
            approvalReadiness: shouldCollectEvidence ? "collecting" : undefined,
            evidence: {
              policy: policy.matched_policy?.policy_id ?? null,
              reason: effectiveReason,
              policy_required_checks: policy.required_checks,
              imported_required_checks: importedRequiredChecks,
              required_checks: requiredChecks,
              resolved_skill: resolvedSkill,
              risk
            }
          });
        }

        const auditMetadataBase = {
          agent: request.agent,
          raw_action: request.raw_action,
          tool: request.tool,
          context: request.context,
          resolved_skill: resolvedSkill,
          risk_score: risk.risk_score,
          risk_level: risk.risk_level,
          decision: effectiveDecision,
          policy_decision: policy.decision,
          mode,
          reason: effectiveReason,
          policy_matched: policy.matched_policy?.policy_id ?? null,
          missing_checks: missingChecks
        };

        await tx.auditEvent.createMany({
          data: [
            auditEventData(request, runId, traceId, 1, "skill.invocation.received", {
              ...auditMetadataBase,
              stage: "received"
            }),
            auditEventData(request, runId, traceId, 2, "skill.classified", {
              ...auditMetadataBase,
              stage: "classified"
            }),
            auditEventData(request, runId, traceId, 3, "risk.scored", {
              ...auditMetadataBase,
              stage: "risk_scored"
            }),
            auditEventData(request, runId, traceId, 4, "policy.evaluated", {
              ...auditMetadataBase,
              stage: "policy_evaluated"
            }),
            ...(mode === "enforce" && requiredChecks.length > 0
              ? [
                  auditEventData(request, runId, traceId, 5, "prerequisites.checked", {
                    ...auditMetadataBase,
                    stage: "prerequisites_checked"
                  })
                ]
              : []),
            ...(mode === "enforce" && policy.decision === "REQUIRE_APPROVAL"
              ? [
                  auditEventData(request, runId, traceId, requiredChecks.length > 0 ? 6 : 5, "approval.requested", {
                    ...auditMetadataBase,
                    stage: "approval_requested"
                  })
                ]
              : [])
          ]
        });
      });

      let finalMissingChecks = missingChecks;
      if (shouldCollectEvidence) {
        const evidenceCollection = await collectEvidenceForRun({
          prisma,
          runId,
          requestedBy: "decision-service"
        });
        if (evidenceCollection.status === 202) {
          finalMissingChecks = evidenceCollection.body.missing_checks;
        }
      }

      return {
        decision: effectiveDecision,
        skill_id: resolvedSkill.skill_id,
        skill_version: resolvedSkill.skill_version,
        risk_level: risk.risk_level,
        risk_score: risk.risk_score,
        risk_reasons: risk.risk_reasons,
        reason: effectiveReason,
        trace_id: traceId,
        run_id: runId,
        mode,
        ...(effectiveDecision !== policy.decision ? { policy_decision: policy.decision } : {}),
        ...(effectiveDecision === "FORCE_DRY_RUN" ? { dry_run_required: true } : {}),
        ...(finalMissingChecks.length > 0 ? { missing_checks: finalMissingChecks } : {})
      };
    }
  };
}

function statusForDecision(decision: DecisionServiceResult["decision"]) {
  if (decision === "ALLOW") return "policy_evaluated";
  if (decision === "DENY") return "denied";
  if (decision === "FORCE_DRY_RUN") return "dry_run_required";
  return "approval_required";
}

function governanceModeFromContext(context: Record<string, unknown>): "observe" | "warn" | "enforce" {
  const raw = context.agentgate_policy_mode ?? context.policy_mode ?? context.governance_mode;
  if (raw === "observe" || raw === "warn" || raw === "enforce") return raw;
  return "enforce";
}

function missingChecksForRequest(requiredChecks: string[], context: Record<string, unknown>): string[] {
  return requiredChecks.filter((check) => !checkIsSatisfied(check, context));
}

function checkIsSatisfied(check: string, context: Record<string, unknown>): boolean {
  if (check === "ci_passed") return context.ci_status === "passed";
  if (check === "tests_passed") return context.tests_status === "passed";
  if (check === "security_scan_passed") return context.security_scan_passed === true || context.security_scan === "passed";
  if (check === "rollback_plan_exists") return context.rollback_plan === "exists";
  if (check === "staging_deploy_successful") return context.staging_deploy === "success";
  if (check === "dry_run_completed") return context.dry_run_completed === true;
  if (check === "schema_diff_generated") return context.schema_diff_generated === true;
  if (check === "backup_exists") return context.backup_exists === true;
  return false;
}

function auditEventData(
  request: NormalizedActionRequest,
  runId: string,
  traceId: string,
  sequence: number,
  eventType: string,
  metadata: Record<string, unknown>
) {
  return {
    id: createId("aud"),
    tenantId: request.tenant_id,
    workspaceId: request.workspace_id,
    skillRunId: runId,
    traceId,
    eventType,
    actorType: "agent" as const,
    actorId: request.agent.agent_id,
    sequence,
    metadata: metadata as Prisma.InputJsonValue
  };
}
