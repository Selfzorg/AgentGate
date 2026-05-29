import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  approveRegistryImportBatch,
  createRegistryImport,
  getRegistryImportBatch,
  rejectRegistryImportBatch,
  scanRegistryForImport
} from "../services/skill-import-service";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

const scanBodySchema = z
  .object({
    tenant_id: z.string().min(1).default("tenant_demo"),
    workspace_id: z.string().min(1).default("workspace_demo"),
    root_dir: z.string().min(1).optional(),
    include_user_scopes: z.boolean().optional(),
    persist_snapshot: z.boolean().optional(),
    requested_by: z.string().min(1).optional()
  })
  .default({});

const importParamsSchema = z.object({
  batch_id: z.string().min(1)
});

const approveBodySchema = z
  .object({
    candidate_ids: z.array(z.string().min(1)).optional(),
    candidate_reviews: z
      .array(
        z.object({
          candidate_id: z.string().min(1),
          required_checks: z.array(z.string().min(1)).optional(),
          policy_aliases: z.array(z.string().min(1)).optional()
        })
      )
      .optional(),
    reviewed_by: z.string().min(1).optional(),
    comment: z.string().optional(),
    owners: z.array(z.string().min(1)).optional(),
    approver_roles: z.array(z.string().min(1)).optional()
  })
  .default({});

const rejectBodySchema = z
  .object({
    reviewed_by: z.string().min(1).optional(),
    comment: z.string().optional()
  })
  .default({});

export const registerRegistryRoutes: FastifyPluginAsync = async (app) => {
  app.post("/registry/scan", async (request) => {
    const body = scanBodySchema.parse(request.body ?? {});
    return scanRegistryForImport(app.services.prisma, {
      tenantId: body.tenant_id,
      workspaceId: body.workspace_id,
      rootDir: body.root_dir ?? repoRoot,
      includeUserScopes: body.include_user_scopes,
      persistSnapshot: body.persist_snapshot,
      requestedBy: body.requested_by
    });
  });

  app.post("/registry/import", async (request, reply) => {
    const body = scanBodySchema.parse(request.body ?? {});
    const result = await createRegistryImport(app.services.prisma, {
      tenantId: body.tenant_id,
      workspaceId: body.workspace_id,
      rootDir: body.root_dir ?? repoRoot,
      includeUserScopes: body.include_user_scopes,
      requestedBy: body.requested_by
    });

    return reply.code(result.status).send(result.body);
  });

  app.get("/registry/import-batches/:batch_id", async (request, reply) => {
    const params = importParamsSchema.parse(request.params);
    const result = await getRegistryImportBatch(app.services.prisma, params.batch_id);
    return reply.code(result.status).send(result.body);
  });

  app.post("/registry/import-batches/:batch_id/approve", async (request, reply) => {
    const params = importParamsSchema.parse(request.params);
    const body = approveBodySchema.parse(request.body ?? {});
    const result = await approveRegistryImportBatch(app.services.prisma, {
      batchId: params.batch_id,
      candidateIds: body.candidate_ids,
      candidateReviews: body.candidate_reviews?.map((review) => ({
        candidateId: review.candidate_id,
        requiredChecks: review.required_checks,
        policyAliases: review.policy_aliases
      })),
      reviewedBy: body.reviewed_by,
      comment: body.comment,
      owners: body.owners,
      approverRoles: body.approver_roles
    });

    return reply.code(result.status).send(result.body);
  });

  app.post("/registry/import-batches/:batch_id/reject", async (request, reply) => {
    const params = importParamsSchema.parse(request.params);
    const body = rejectBodySchema.parse(request.body ?? {});
    const result = await rejectRegistryImportBatch(app.services.prisma, {
      batchId: params.batch_id,
      reviewedBy: body.reviewed_by,
      comment: body.comment
    });

    return reply.code(result.status).send(result.body);
  });
};
