import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { NormalizedActionRequest } from "@agentgate/core-types";
import { loadDemoFixtures } from "@agentgate/config-loader";
import { evaluatePolicy } from "@agentgate/policy-engine";
import { scoreRisk } from "@agentgate/risk-engine";
import { resolveSkill } from "@agentgate/skill-resolver";
import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { createOrUpdateApprovalRequest } from "./approval-service";
import { createGateCheckResults } from "./gate-check-service";
import { createId } from "./id";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

const normalizedActionRequestSchema = z.object({
  tenant_id: z.string().min(1),
  workspace_id: z.string().min(1),
  source: z.enum(["codex", "claude-code", "claude_code", "mcp_proxy", "demo_harness"]),
  adapter_type: z.enum(["hook", "mcp_proxy", "simulator"]),
  agent: z.object({
    agent_id: z.string().min(1),
    agent_type: z.string().min(1),
    role: z.string().min(1),
    owner: z.string().optional()
  }),
  tool: z.object({
    tool_name: z.string().min(1),
    tool_call_id: z.string().optional()
  }),
  raw_action: z.string().min(1),
  context: z
    .object({
      repo: z.string().optional(),
      branch: z.string().optional(),
      cwd: z.string().optional(),
      environment: z.enum(["dev", "staging", "production"]).optional(),
      service: z.string().optional(),
      database: z.string().optional(),
      target_branch: z.string().optional(),
      ci_status: z.enum(["passed", "failed", "unknown"]).optional(),
      tests_status: z.enum(["passed", "failed", "unknown"]).optional(),
      security_scan: z.enum(["passed", "failed", "unknown"]).optional(),
      rollback_plan: z.enum(["exists", "missing", "unknown"]).optional(),
      staging_deploy: z.enum(["success", "failed", "unknown"]).optional(),
      dry_run_completed: z.boolean().optional(),
      schema_diff_generated: z.boolean().optional(),
      backup_exists: z.boolean().optional(),
      required_reviews_passed: z.boolean().optional(),
      branch_protection_satisfied: z.boolean().optional()
    })
    .default({}),
  requested_at: z.string().optional()
});

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
  mode: "observe" | "enforce";
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
      const request = normalizeRequest(normalizedActionRequestSchema.parse(rawRequest));
      const fixtures = await loadDemoFixtures(configDir);
      const traceId = createId("trc");
      const runId = createId("run");

      const resolvedSkill = resolveSkill({
        rawAction: request.raw_action,
        toolName: request.tool.tool_name,
        context: request.context
      });

      const risk = scoreRisk({
        resolvedSkill,
        rawAction: request.raw_action,
        context: request.context
      });

      const policy = evaluatePolicy({
        rules: fixtures.policies.rules,
        role: request.agent.role,
        skill_id: resolvedSkill.skill_id,
        risk_level: risk.risk_level,
        context: request.context
      });

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

      const missingChecks = missingChecksForRequest(policy.required_checks, request.context);
      const status = statusForDecision(policy.decision);

      await prisma.$transaction(async (tx) => {
        const skillRunData: Prisma.SkillRunUncheckedCreateInput = {
          id: runId,
          tenantId: request.tenant_id,
          workspaceId: request.workspace_id,
          traceId,
          source: prismaAgentSource(request.source),
          adapterType: request.adapter_type,
          rawAction: request.raw_action,
          mode: "enforce",
          decision: policy.decision,
          riskLevel: risk.risk_level,
          riskScore: risk.risk_score,
          riskReasons: risk.risk_reasons as Prisma.InputJsonValue,
          context: request.context as Prisma.InputJsonValue,
          requestedAt: request.requested_at ? new Date(request.requested_at) : new Date(),
          status,
          reason: policy.reason,
          resolvedSkillSnapshot: resolvedSkill as Prisma.InputJsonValue,
          policySnapshot: {
            matched_policy_id: policy.matched_policy?.policy_id ?? null,
            reason: policy.reason,
            decision: policy.decision,
            required_checks: policy.required_checks,
            approvers: policy.approvers,
            missing_checks: missingChecks
          } as Prisma.InputJsonValue
        };

        if (request.context.environment) skillRunData.environment = request.context.environment;
        if (agent) skillRunData.agentId = agent.id;
        if (skill) skillRunData.skillRecordId = skill.id;
        if (matchedPolicy) skillRunData.matchedPolicyRecordId = matchedPolicy.id;

        await tx.skillRun.create({
          data: skillRunData
        });

        if (policy.required_checks.length > 0) {
          await createGateCheckResults(tx, {
            tenantId: request.tenant_id,
            workspaceId: request.workspace_id,
            skillRunId: runId,
            skillId: resolvedSkill.skill_id,
            requiredChecks: policy.required_checks,
            context: request.context
          });
        }

        if (policy.decision === "REQUIRE_APPROVAL") {
          await createOrUpdateApprovalRequest(tx, {
            tenantId: request.tenant_id,
            workspaceId: request.workspace_id,
            skillRunId: runId,
            traceId,
            riskLevel: risk.risk_level,
            missingChecks,
            requiredApprovers: policy.approvers,
            evidence: {
              policy: policy.matched_policy?.policy_id ?? null,
              reason: policy.reason,
              required_checks: policy.required_checks,
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
          decision: policy.decision,
          reason: policy.reason,
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
            ...(policy.required_checks.length > 0
              ? [
                  auditEventData(request, runId, traceId, 5, "prerequisites.checked", {
                    ...auditMetadataBase,
                    stage: "prerequisites_checked"
                  })
                ]
              : []),
            ...(policy.decision === "REQUIRE_APPROVAL"
              ? [
                  auditEventData(request, runId, traceId, policy.required_checks.length > 0 ? 6 : 5, "approval.requested", {
                    ...auditMetadataBase,
                    stage: "approval_requested"
                  })
                ]
              : [])
          ]
        });
      });

      return {
        decision: policy.decision,
        skill_id: resolvedSkill.skill_id,
        skill_version: resolvedSkill.skill_version,
        risk_level: risk.risk_level,
        risk_score: risk.risk_score,
        risk_reasons: risk.risk_reasons,
        reason: policy.reason,
        trace_id: traceId,
        run_id: runId,
        mode: "enforce",
        ...(policy.decision === "FORCE_DRY_RUN" ? { dry_run_required: true } : {}),
        ...(missingChecks.length > 0 ? { missing_checks: missingChecks } : {})
      };
    }
  };
}

function normalizeRequest(
  request: z.infer<typeof normalizedActionRequestSchema>
): NormalizedActionRequest {
  return {
    ...request,
    source: request.source === "claude_code" ? "claude-code" : request.source
  } as NormalizedActionRequest;
}

function prismaAgentSource(source: NormalizedActionRequest["source"]) {
  return source === "claude-code" ? "claude_code" : source;
}

function statusForDecision(decision: DecisionServiceResult["decision"]) {
  if (decision === "ALLOW") return "policy_evaluated";
  if (decision === "DENY") return "denied";
  if (decision === "FORCE_DRY_RUN") return "dry_run_required";
  return "approval_required";
}

function missingChecksForRequest(requiredChecks: string[], context: Record<string, unknown>): string[] {
  return requiredChecks.filter((check) => !checkIsSatisfied(check, context));
}

function checkIsSatisfied(check: string, context: Record<string, unknown>): boolean {
  if (check === "ci_passed") return context.ci_status === "passed";
  if (check === "tests_passed") return context.tests_status === "passed";
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
