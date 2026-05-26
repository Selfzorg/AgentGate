-- CreateEnum
CREATE TYPE "Decision" AS ENUM ('ALLOW', 'DENY', 'REQUIRE_APPROVAL', 'FORCE_DRY_RUN');

-- CreateEnum
CREATE TYPE "RiskLevel" AS ENUM ('low', 'medium', 'high', 'critical');

-- CreateEnum
CREATE TYPE "AgentSource" AS ENUM ('codex', 'claude-code', 'mcp_proxy', 'demo_harness');

-- CreateEnum
CREATE TYPE "AdapterType" AS ENUM ('hook', 'mcp_proxy', 'simulator');

-- CreateEnum
CREATE TYPE "Environment" AS ENUM ('dev', 'staging', 'production');

-- CreateEnum
CREATE TYPE "GovernanceMode" AS ENUM ('observe', 'enforce');

-- CreateEnum
CREATE TYPE "SkillRunStatus" AS ENUM ('requested', 'classified', 'policy_evaluated', 'dry_run_required', 'dry_run_running', 'dry_run_completed', 'approval_required', 'approval_pending', 'approved', 'denied', 'credential_issued', 'execution_queued', 'executing', 'completed', 'failed', 'rolled_back', 'audited');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('pending', 'approved', 'denied', 'expired');

-- CreateEnum
CREATE TYPE "ExecutionTokenStatus" AS ENUM ('issued', 'used', 'expired', 'revoked');

-- CreateEnum
CREATE TYPE "GateCheckStatus" AS ENUM ('passed', 'failed', 'missing', 'unknown');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('agent', 'user', 'system');

-- CreateEnum
CREATE TYPE "ConnectorStatus" AS ENUM ('active', 'inactive', 'archived');

-- CreateEnum
CREATE TYPE "EntityStatus" AS ENUM ('active', 'inactive', 'archived');

-- CreateEnum
CREATE TYPE "LogLevel" AS ENUM ('debug', 'info', 'warn', 'error');

-- CreateTable
CREATE TABLE "tenants" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "EntityStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspaces" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "status" "EntityStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspaces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "status" "EntityStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agents" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "owner_user_id" TEXT,
    "external_agent_id" TEXT NOT NULL,
    "source" "AgentSource" NOT NULL,
    "agent_type" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "status" "EntityStatus" NOT NULL DEFAULT 'active',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "skills" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "skill_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT,
    "default_risk_level" "RiskLevel" NOT NULL,
    "status" "EntityStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "skills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "skill_versions" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "skill_record_id" TEXT NOT NULL,
    "connector_id" TEXT,
    "version" TEXT NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "execution" JSONB NOT NULL DEFAULT '{}',
    "status" "EntityStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "skill_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "policies" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "policy_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "EntityStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "policy_versions" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "policy_record_id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "priority" INTEGER NOT NULL,
    "decision" "Decision" NOT NULL,
    "reason" TEXT NOT NULL,
    "definition" JSONB NOT NULL DEFAULT '{}',
    "required_checks" JSONB NOT NULL DEFAULT '[]',
    "approvers" JSONB NOT NULL DEFAULT '[]',
    "status" "EntityStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "policy_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "connectors" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "connector_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" "ConnectorStatus" NOT NULL DEFAULT 'active',
    "config" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "connectors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "skill_runs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "trace_id" TEXT NOT NULL,
    "agent_id" TEXT,
    "skill_record_id" TEXT,
    "matched_policy_record_id" TEXT,
    "source" "AgentSource" NOT NULL,
    "adapter_type" "AdapterType" NOT NULL,
    "raw_action" TEXT NOT NULL,
    "environment" "Environment",
    "mode" "GovernanceMode" NOT NULL DEFAULT 'enforce',
    "decision" "Decision",
    "risk_level" "RiskLevel",
    "risk_score" INTEGER,
    "risk_reasons" JSONB NOT NULL DEFAULT '[]',
    "context" JSONB NOT NULL DEFAULT '{}',
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "SkillRunStatus" NOT NULL DEFAULT 'requested',
    "reason" TEXT,
    "resolved_skill_snapshot" JSONB NOT NULL DEFAULT '{}',
    "policy_snapshot" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "skill_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gate_check_results" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "skill_run_id" TEXT NOT NULL,
    "check_key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "status" "GateCheckStatus" NOT NULL,
    "evidence" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gate_check_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_requests" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "skill_run_id" TEXT NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'pending',
    "risk_level" "RiskLevel" NOT NULL,
    "approval_readiness" TEXT NOT NULL DEFAULT 'blocked',
    "missing_checks" JSONB NOT NULL DEFAULT '[]',
    "required_approvers" JSONB NOT NULL DEFAULT '[]',
    "evidence" JSONB NOT NULL DEFAULT '{}',
    "requested_by" TEXT,
    "approved_by_user_id" TEXT,
    "denied_by_user_id" TEXT,
    "approved_at" TIMESTAMP(3),
    "denied_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "comment" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "approval_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "execution_tokens" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "skill_run_id" TEXT NOT NULL,
    "approval_request_id" TEXT,
    "token_hash" TEXT NOT NULL,
    "scopes" JSONB NOT NULL DEFAULT '[]',
    "environment" "Environment",
    "status" "ExecutionTokenStatus" NOT NULL DEFAULT 'issued',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "execution_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "execution_logs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "skill_run_id" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "level" "LogLevel" NOT NULL,
    "message" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "execution_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dry_run_results" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "skill_run_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "result" JSONB NOT NULL DEFAULT '{}',
    "artifacts" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dry_run_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "skill_run_attempts" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "skill_run_id" TEXT NOT NULL,
    "execution_token_id" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "result" JSONB NOT NULL DEFAULT '{}',
    "error" JSONB NOT NULL DEFAULT '{}',
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "skill_run_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "skill_run_id" TEXT,
    "trace_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "actor_type" "ActorType" NOT NULL,
    "actor_id" TEXT,
    "sequence" INTEGER,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_artifacts" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "audit_event_id" TEXT,
    "skill_run_id" TEXT,
    "artifact_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "uri" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_artifacts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "workspaces_tenant_id_idx" ON "workspaces"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "workspaces_tenant_id_key_key" ON "workspaces"("tenant_id", "key");

-- CreateIndex
CREATE INDEX "users_tenant_id_status_idx" ON "users"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "users_tenant_id_email_key" ON "users"("tenant_id", "email");

-- CreateIndex
CREATE INDEX "agents_tenant_id_workspace_id_role_idx" ON "agents"("tenant_id", "workspace_id", "role");

-- CreateIndex
CREATE INDEX "agents_owner_user_id_idx" ON "agents"("owner_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "agents_tenant_id_workspace_id_external_agent_id_key" ON "agents"("tenant_id", "workspace_id", "external_agent_id");

-- CreateIndex
CREATE INDEX "skills_tenant_id_workspace_id_category_idx" ON "skills"("tenant_id", "workspace_id", "category");

-- CreateIndex
CREATE UNIQUE INDEX "skills_tenant_id_workspace_id_skill_id_key" ON "skills"("tenant_id", "workspace_id", "skill_id");

-- CreateIndex
CREATE INDEX "skill_versions_tenant_id_workspace_id_idx" ON "skill_versions"("tenant_id", "workspace_id");

-- CreateIndex
CREATE INDEX "skill_versions_connector_id_idx" ON "skill_versions"("connector_id");

-- CreateIndex
CREATE UNIQUE INDEX "skill_versions_skill_record_id_version_key" ON "skill_versions"("skill_record_id", "version");

-- CreateIndex
CREATE INDEX "policies_tenant_id_workspace_id_status_idx" ON "policies"("tenant_id", "workspace_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "policies_tenant_id_workspace_id_policy_id_key" ON "policies"("tenant_id", "workspace_id", "policy_id");

-- CreateIndex
CREATE INDEX "policy_versions_tenant_id_workspace_id_priority_idx" ON "policy_versions"("tenant_id", "workspace_id", "priority");

-- CreateIndex
CREATE UNIQUE INDEX "policy_versions_policy_record_id_version_key" ON "policy_versions"("policy_record_id", "version");

-- CreateIndex
CREATE INDEX "connectors_tenant_id_workspace_id_status_idx" ON "connectors"("tenant_id", "workspace_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "connectors_tenant_id_workspace_id_connector_id_key" ON "connectors"("tenant_id", "workspace_id", "connector_id");

-- CreateIndex
CREATE INDEX "skill_runs_trace_id_idx" ON "skill_runs"("trace_id");

-- CreateIndex
CREATE INDEX "skill_runs_tenant_id_created_at_idx" ON "skill_runs"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "skill_runs_status_idx" ON "skill_runs"("status");

-- CreateIndex
CREATE INDEX "skill_runs_tenant_id_workspace_id_status_created_at_idx" ON "skill_runs"("tenant_id", "workspace_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "skill_runs_agent_id_idx" ON "skill_runs"("agent_id");

-- CreateIndex
CREATE INDEX "skill_runs_skill_record_id_idx" ON "skill_runs"("skill_record_id");

-- CreateIndex
CREATE INDEX "skill_runs_matched_policy_record_id_idx" ON "skill_runs"("matched_policy_record_id");

-- CreateIndex
CREATE INDEX "gate_check_results_tenant_id_workspace_id_status_idx" ON "gate_check_results"("tenant_id", "workspace_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "gate_check_results_skill_run_id_check_key_key" ON "gate_check_results"("skill_run_id", "check_key");

-- CreateIndex
CREATE UNIQUE INDEX "approval_requests_skill_run_id_key" ON "approval_requests"("skill_run_id");

-- CreateIndex
CREATE INDEX "approval_requests_status_created_at_idx" ON "approval_requests"("status", "created_at");

-- CreateIndex
CREATE INDEX "approval_requests_skill_run_id_idx" ON "approval_requests"("skill_run_id");

-- CreateIndex
CREATE INDEX "approval_requests_approved_by_user_id_idx" ON "approval_requests"("approved_by_user_id");

-- CreateIndex
CREATE INDEX "approval_requests_denied_by_user_id_idx" ON "approval_requests"("denied_by_user_id");

-- CreateIndex
CREATE INDEX "execution_tokens_skill_run_id_idx" ON "execution_tokens"("skill_run_id");

-- CreateIndex
CREATE INDEX "execution_tokens_approval_request_id_idx" ON "execution_tokens"("approval_request_id");

-- CreateIndex
CREATE INDEX "execution_tokens_status_expires_at_idx" ON "execution_tokens"("status", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "execution_tokens_skill_run_id_token_hash_key" ON "execution_tokens"("skill_run_id", "token_hash");

-- CreateIndex
CREATE INDEX "execution_logs_skill_run_id_sequence_idx" ON "execution_logs"("skill_run_id", "sequence");

-- CreateIndex
CREATE INDEX "execution_logs_tenant_id_workspace_id_created_at_idx" ON "execution_logs"("tenant_id", "workspace_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "execution_logs_skill_run_id_sequence_key" ON "execution_logs"("skill_run_id", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "dry_run_results_skill_run_id_key" ON "dry_run_results"("skill_run_id");

-- CreateIndex
CREATE INDEX "dry_run_results_tenant_id_workspace_id_created_at_idx" ON "dry_run_results"("tenant_id", "workspace_id", "created_at");

-- CreateIndex
CREATE INDEX "skill_run_attempts_skill_run_id_idempotency_key_idx" ON "skill_run_attempts"("skill_run_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "skill_run_attempts_execution_token_id_idx" ON "skill_run_attempts"("execution_token_id");

-- CreateIndex
CREATE UNIQUE INDEX "skill_run_attempts_skill_run_id_idempotency_key_key" ON "skill_run_attempts"("skill_run_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "audit_events_trace_id_created_at_idx" ON "audit_events"("trace_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_events_skill_run_id_created_at_idx" ON "audit_events"("skill_run_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_events_tenant_id_created_at_idx" ON "audit_events"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_artifacts_audit_event_id_idx" ON "audit_artifacts"("audit_event_id");

-- CreateIndex
CREATE INDEX "audit_artifacts_skill_run_id_idx" ON "audit_artifacts"("skill_run_id");

-- CreateIndex
CREATE INDEX "audit_artifacts_tenant_id_workspace_id_created_at_idx" ON "audit_artifacts"("tenant_id", "workspace_id", "created_at");

-- AddForeignKey
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agents" ADD CONSTRAINT "agents_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agents" ADD CONSTRAINT "agents_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agents" ADD CONSTRAINT "agents_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skills" ADD CONSTRAINT "skills_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skills" ADD CONSTRAINT "skills_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill_versions" ADD CONSTRAINT "skill_versions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill_versions" ADD CONSTRAINT "skill_versions_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill_versions" ADD CONSTRAINT "skill_versions_skill_record_id_fkey" FOREIGN KEY ("skill_record_id") REFERENCES "skills"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill_versions" ADD CONSTRAINT "skill_versions_connector_id_fkey" FOREIGN KEY ("connector_id") REFERENCES "connectors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policies" ADD CONSTRAINT "policies_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policies" ADD CONSTRAINT "policies_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policy_versions" ADD CONSTRAINT "policy_versions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policy_versions" ADD CONSTRAINT "policy_versions_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policy_versions" ADD CONSTRAINT "policy_versions_policy_record_id_fkey" FOREIGN KEY ("policy_record_id") REFERENCES "policies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connectors" ADD CONSTRAINT "connectors_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connectors" ADD CONSTRAINT "connectors_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill_runs" ADD CONSTRAINT "skill_runs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill_runs" ADD CONSTRAINT "skill_runs_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill_runs" ADD CONSTRAINT "skill_runs_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill_runs" ADD CONSTRAINT "skill_runs_skill_record_id_fkey" FOREIGN KEY ("skill_record_id") REFERENCES "skills"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill_runs" ADD CONSTRAINT "skill_runs_matched_policy_record_id_fkey" FOREIGN KEY ("matched_policy_record_id") REFERENCES "policies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gate_check_results" ADD CONSTRAINT "gate_check_results_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gate_check_results" ADD CONSTRAINT "gate_check_results_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gate_check_results" ADD CONSTRAINT "gate_check_results_skill_run_id_fkey" FOREIGN KEY ("skill_run_id") REFERENCES "skill_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_skill_run_id_fkey" FOREIGN KEY ("skill_run_id") REFERENCES "skill_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_approved_by_user_id_fkey" FOREIGN KEY ("approved_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_denied_by_user_id_fkey" FOREIGN KEY ("denied_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "execution_tokens" ADD CONSTRAINT "execution_tokens_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "execution_tokens" ADD CONSTRAINT "execution_tokens_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "execution_tokens" ADD CONSTRAINT "execution_tokens_skill_run_id_fkey" FOREIGN KEY ("skill_run_id") REFERENCES "skill_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "execution_tokens" ADD CONSTRAINT "execution_tokens_approval_request_id_fkey" FOREIGN KEY ("approval_request_id") REFERENCES "approval_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "execution_logs" ADD CONSTRAINT "execution_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "execution_logs" ADD CONSTRAINT "execution_logs_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "execution_logs" ADD CONSTRAINT "execution_logs_skill_run_id_fkey" FOREIGN KEY ("skill_run_id") REFERENCES "skill_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dry_run_results" ADD CONSTRAINT "dry_run_results_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dry_run_results" ADD CONSTRAINT "dry_run_results_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dry_run_results" ADD CONSTRAINT "dry_run_results_skill_run_id_fkey" FOREIGN KEY ("skill_run_id") REFERENCES "skill_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill_run_attempts" ADD CONSTRAINT "skill_run_attempts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill_run_attempts" ADD CONSTRAINT "skill_run_attempts_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill_run_attempts" ADD CONSTRAINT "skill_run_attempts_skill_run_id_fkey" FOREIGN KEY ("skill_run_id") REFERENCES "skill_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill_run_attempts" ADD CONSTRAINT "skill_run_attempts_execution_token_id_fkey" FOREIGN KEY ("execution_token_id") REFERENCES "execution_tokens"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_skill_run_id_fkey" FOREIGN KEY ("skill_run_id") REFERENCES "skill_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_artifacts" ADD CONSTRAINT "audit_artifacts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_artifacts" ADD CONSTRAINT "audit_artifacts_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_artifacts" ADD CONSTRAINT "audit_artifacts_audit_event_id_fkey" FOREIGN KEY ("audit_event_id") REFERENCES "audit_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_artifacts" ADD CONSTRAINT "audit_artifacts_skill_run_id_fkey" FOREIGN KEY ("skill_run_id") REFERENCES "skill_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
