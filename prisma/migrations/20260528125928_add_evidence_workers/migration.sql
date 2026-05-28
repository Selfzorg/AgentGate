-- CreateEnum
CREATE TYPE "EvidenceWorkerStatus" AS ENUM ('online', 'idle', 'busy', 'offline', 'error');

-- CreateTable
CREATE TABLE "evidence_workers" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "runtime" TEXT NOT NULL,
    "driver" TEXT NOT NULL,
    "status" "EvidenceWorkerStatus" NOT NULL DEFAULT 'online',
    "current_task_id" TEXT,
    "current_check_key" TEXT,
    "processed_count" INTEGER NOT NULL DEFAULT 0,
    "failed_count" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "last_heartbeat_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stopped_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "evidence_workers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "evidence_workers_tenant_id_workspace_id_status_last_heartbe_idx" ON "evidence_workers"("tenant_id", "workspace_id", "status", "last_heartbeat_at");

-- CreateIndex
CREATE INDEX "evidence_workers_current_task_id_idx" ON "evidence_workers"("current_task_id");

-- CreateIndex
CREATE UNIQUE INDEX "evidence_workers_tenant_id_workspace_id_agent_id_key" ON "evidence_workers"("tenant_id", "workspace_id", "agent_id");

-- AddForeignKey
ALTER TABLE "evidence_workers" ADD CONSTRAINT "evidence_workers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence_workers" ADD CONSTRAINT "evidence_workers_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
