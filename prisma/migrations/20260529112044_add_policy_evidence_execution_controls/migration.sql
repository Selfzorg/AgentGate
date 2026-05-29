-- CreateEnum
CREATE TYPE "PolicyPackScope" AS ENUM ('org', 'workspace', 'repo');

-- AlterEnum
ALTER TYPE "GovernanceMode" ADD VALUE 'warn';

-- AlterTable
ALTER TABLE "policies" ADD COLUMN     "policy_pack_id" TEXT;

-- AlterTable
ALTER TABLE "skill_run_attempts" ADD COLUMN     "claimed_by_runner_id" TEXT,
ADD COLUMN     "heartbeat_at" TIMESTAMP(3),
ADD COLUMN     "lease_expires_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "policy_packs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "pack_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "scope" "PolicyPackScope" NOT NULL DEFAULT 'workspace',
    "source" TEXT NOT NULL DEFAULT 'api',
    "status" "EntityStatus" NOT NULL DEFAULT 'active',
    "config" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "policy_packs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evidence_artifact_cache" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "check_key" TEXT NOT NULL,
    "target_identity_hash" TEXT NOT NULL,
    "repo" TEXT,
    "commit_sha" TEXT,
    "environment" "Environment",
    "status" "GateCheckStatus" NOT NULL,
    "reason" TEXT NOT NULL,
    "evidence" JSONB NOT NULL DEFAULT '{}',
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "source_task_id" TEXT,
    "collected_at" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "evidence_artifact_cache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "policy_packs_tenant_id_workspace_id_scope_status_idx" ON "policy_packs"("tenant_id", "workspace_id", "scope", "status");

-- CreateIndex
CREATE UNIQUE INDEX "policy_packs_tenant_id_workspace_id_pack_id_key" ON "policy_packs"("tenant_id", "workspace_id", "pack_id");

-- CreateIndex
CREATE INDEX "evidence_artifact_cache_tenant_id_workspace_id_expires_at_idx" ON "evidence_artifact_cache"("tenant_id", "workspace_id", "expires_at");

-- CreateIndex
CREATE INDEX "evidence_artifact_cache_repo_commit_sha_environment_idx" ON "evidence_artifact_cache"("repo", "commit_sha", "environment");

-- CreateIndex
CREATE UNIQUE INDEX "evidence_artifact_cache_tenant_id_workspace_id_check_key_ta_key" ON "evidence_artifact_cache"("tenant_id", "workspace_id", "check_key", "target_identity_hash");

-- CreateIndex
CREATE INDEX "policies_policy_pack_id_idx" ON "policies"("policy_pack_id");

-- AddForeignKey
ALTER TABLE "policies" ADD CONSTRAINT "policies_policy_pack_id_fkey" FOREIGN KEY ("policy_pack_id") REFERENCES "policy_packs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policy_packs" ADD CONSTRAINT "policy_packs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policy_packs" ADD CONSTRAINT "policy_packs_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence_artifact_cache" ADD CONSTRAINT "evidence_artifact_cache_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence_artifact_cache" ADD CONSTRAINT "evidence_artifact_cache_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
