-- CreateEnum
CREATE TYPE "EvidenceTaskStatus" AS ENUM ('queued', 'claimed', 'running', 'succeeded', 'failed', 'timed_out', 'cancelled');

-- CreateTable
CREATE TABLE "evidence_tasks" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "skill_run_id" TEXT NOT NULL,
    "approval_request_id" TEXT,
    "gate_check_result_id" TEXT NOT NULL,
    "trace_id" TEXT NOT NULL,
    "check_key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "evidence_skill_id" TEXT NOT NULL,
    "target_skill_id" TEXT NOT NULL,
    "runtime" TEXT NOT NULL,
    "status" "EvidenceTaskStatus" NOT NULL DEFAULT 'queued',
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "claimed_by_agent_id" TEXT,
    "lease_expires_at" TIMESTAMP(3),
    "input" JSONB NOT NULL DEFAULT '{}',
    "result" JSONB NOT NULL DEFAULT '{}',
    "error" JSONB NOT NULL DEFAULT '{}',
    "created_by" TEXT,
    "claimed_at" TIMESTAMP(3),
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "evidence_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "evidence_tasks_tenant_id_workspace_id_status_created_at_idx" ON "evidence_tasks"("tenant_id", "workspace_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "evidence_tasks_skill_run_id_status_idx" ON "evidence_tasks"("skill_run_id", "status");

-- CreateIndex
CREATE INDEX "evidence_tasks_approval_request_id_idx" ON "evidence_tasks"("approval_request_id");

-- CreateIndex
CREATE INDEX "evidence_tasks_gate_check_result_id_idx" ON "evidence_tasks"("gate_check_result_id");

-- CreateIndex
CREATE INDEX "evidence_tasks_status_lease_expires_at_idx" ON "evidence_tasks"("status", "lease_expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "evidence_tasks_gate_check_result_id_attempt_key" ON "evidence_tasks"("gate_check_result_id", "attempt");

-- AddForeignKey
ALTER TABLE "evidence_tasks" ADD CONSTRAINT "evidence_tasks_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence_tasks" ADD CONSTRAINT "evidence_tasks_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence_tasks" ADD CONSTRAINT "evidence_tasks_skill_run_id_fkey" FOREIGN KEY ("skill_run_id") REFERENCES "skill_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence_tasks" ADD CONSTRAINT "evidence_tasks_approval_request_id_fkey" FOREIGN KEY ("approval_request_id") REFERENCES "approval_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence_tasks" ADD CONSTRAINT "evidence_tasks_gate_check_result_id_fkey" FOREIGN KEY ("gate_check_result_id") REFERENCES "gate_check_results"("id") ON DELETE CASCADE ON UPDATE CASCADE;
