-- CreateEnum
CREATE TYPE "AiRunAnalysisStatus" AS ENUM ('completed', 'failed', 'disabled');

-- CreateTable
CREATE TABLE "ai_run_analyses" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "skill_run_id" TEXT NOT NULL,
    "trace_id" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "risk_notes" JSONB NOT NULL DEFAULT '[]',
    "missing_evidence" JSONB NOT NULL DEFAULT '[]',
    "suggested_actions" JSONB NOT NULL DEFAULT '[]',
    "failure_cause" TEXT,
    "approver_notes" TEXT,
    "model" TEXT NOT NULL,
    "provider" TEXT,
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "total_tokens" INTEGER NOT NULL DEFAULT 0,
    "estimated_cost_cents" INTEGER NOT NULL DEFAULT 0,
    "status" "AiRunAnalysisStatus" NOT NULL DEFAULT 'completed',
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_run_analyses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_run_analyses_skill_run_id_key" ON "ai_run_analyses"("skill_run_id");

-- CreateIndex
CREATE INDEX "ai_run_analyses_trace_id_idx" ON "ai_run_analyses"("trace_id");

-- CreateIndex
CREATE INDEX "ai_run_analyses_tenant_id_workspace_id_created_at_idx" ON "ai_run_analyses"("tenant_id", "workspace_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_run_analyses_status_created_at_idx" ON "ai_run_analyses"("status", "created_at");

-- AddForeignKey
ALTER TABLE "ai_run_analyses" ADD CONSTRAINT "ai_run_analyses_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_run_analyses" ADD CONSTRAINT "ai_run_analyses_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_run_analyses" ADD CONSTRAINT "ai_run_analyses_skill_run_id_fkey" FOREIGN KEY ("skill_run_id") REFERENCES "skill_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
