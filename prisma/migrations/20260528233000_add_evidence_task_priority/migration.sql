ALTER TABLE "evidence_tasks" ADD COLUMN "priority" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "evidence_tasks_tenant_id_workspace_id_status_priority_created_at_idx"
ON "evidence_tasks"("tenant_id", "workspace_id", "status", "priority", "created_at");
