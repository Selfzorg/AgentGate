-- CreateEnum
CREATE TYPE "SkillImportBatchStatus" AS ENUM ('pending', 'approved', 'rejected');

-- CreateEnum
CREATE TYPE "SkillImportCandidateStatus" AS ENUM ('pending', 'imported', 'skipped', 'rejected', 'failed');

-- CreateTable
CREATE TABLE "skill_import_batches" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "root_dir" TEXT NOT NULL,
    "status" "SkillImportBatchStatus" NOT NULL DEFAULT 'pending',
    "candidate_count" INTEGER NOT NULL DEFAULT 0,
    "warning_count" INTEGER NOT NULL DEFAULT 0,
    "scan_config" JSONB NOT NULL DEFAULT '{}',
    "warnings" JSONB NOT NULL DEFAULT '[]',
    "requested_by" TEXT,
    "reviewed_by" TEXT,
    "review_comment" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "skill_import_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "skill_import_candidates" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "batch_id" TEXT NOT NULL,
    "candidate_id" TEXT NOT NULL,
    "skill_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "source_type" TEXT NOT NULL,
    "source_path" TEXT NOT NULL,
    "relative_path" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "content_hash" TEXT NOT NULL,
    "declared_tools" JSONB NOT NULL DEFAULT '[]',
    "skill_type" TEXT NOT NULL,
    "side_effect_level" TEXT NOT NULL,
    "default_risk_level" "RiskLevel" NOT NULL,
    "allowed_runtimes" JSONB NOT NULL DEFAULT '[]',
    "preferred_runtimes" JSONB NOT NULL DEFAULT '[]',
    "warnings" JSONB NOT NULL DEFAULT '[]',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "review_status" "SkillImportCandidateStatus" NOT NULL DEFAULT 'pending',
    "imported_skill_record_id" TEXT,
    "imported_skill_version_id" TEXT,
    "review_notes" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "skill_import_candidates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "skill_import_batches_tenant_id_workspace_id_status_created__idx" ON "skill_import_batches"("tenant_id", "workspace_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "skill_import_candidates_tenant_id_workspace_id_review_statu_idx" ON "skill_import_candidates"("tenant_id", "workspace_id", "review_status");

-- CreateIndex
CREATE INDEX "skill_import_candidates_tenant_id_workspace_id_skill_id_idx" ON "skill_import_candidates"("tenant_id", "workspace_id", "skill_id");

-- CreateIndex
CREATE INDEX "skill_import_candidates_imported_skill_record_id_idx" ON "skill_import_candidates"("imported_skill_record_id");

-- CreateIndex
CREATE INDEX "skill_import_candidates_imported_skill_version_id_idx" ON "skill_import_candidates"("imported_skill_version_id");

-- CreateIndex
CREATE UNIQUE INDEX "skill_import_candidates_batch_id_candidate_id_key" ON "skill_import_candidates"("batch_id", "candidate_id");

-- AddForeignKey
ALTER TABLE "skill_import_batches" ADD CONSTRAINT "skill_import_batches_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill_import_batches" ADD CONSTRAINT "skill_import_batches_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill_import_candidates" ADD CONSTRAINT "skill_import_candidates_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill_import_candidates" ADD CONSTRAINT "skill_import_candidates_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill_import_candidates" ADD CONSTRAINT "skill_import_candidates_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "skill_import_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill_import_candidates" ADD CONSTRAINT "skill_import_candidates_imported_skill_record_id_fkey" FOREIGN KEY ("imported_skill_record_id") REFERENCES "skills"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill_import_candidates" ADD CONSTRAINT "skill_import_candidates_imported_skill_version_id_fkey" FOREIGN KEY ("imported_skill_version_id") REFERENCES "skill_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "evidence_tasks_tenant_id_workspace_id_status_priority_created_a" RENAME TO "evidence_tasks_tenant_id_workspace_id_status_priority_creat_idx";
