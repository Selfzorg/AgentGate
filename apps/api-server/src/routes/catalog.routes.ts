import type { PrismaClient } from "@prisma/client";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

const skillsQuerySchema = z.object({
  source: z.string().optional(),
  include_inactive: z.enum(["true", "false"]).optional()
});

const skillVersionParamsSchema = z.object({
  id: z.string().min(1),
  version: z.string().min(1)
});

export const registerCatalogRoutes: FastifyPluginAsync = async (app) => {
  app.get("/skills", async (request) => {
    const query = skillsQuerySchema.parse(request.query);
    const skills = await app.services.prisma.skill.findMany({
      where: query.include_inactive === "true" ? {} : { status: "active" },
      include: {
        versions: {
          orderBy: { createdAt: "desc" },
          include: {
            connector: true
          }
        }
      },
      orderBy: [{ category: "asc" }, { skillId: "asc" }]
    });
    const filteredSkills = query.source
      ? skills.filter((skill) => skill.versions.some((version) => sourceTypeFromConfig(version.config) === query.source))
      : skills;

    return {
      skills: filteredSkills.map((skill) => {
        const version = skill.versions.find((candidate) => candidate.status === "active") ?? skill.versions[0];
        return {
          id: skill.id,
          skill_id: skill.skillId,
          name: skill.name,
          category: skill.category,
          default_risk_level: skill.defaultRiskLevel,
          description: skill.description,
          status: skill.status,
          version: version?.version ?? "unknown",
          version_status: version?.status ?? "archived",
          connector: version?.connector?.connectorId ?? null,
          config: version?.config ?? {},
          execution: version?.execution ?? {}
        };
      })
    };
  });

  app.post("/skills/:id/versions/:version/enable", async (request, reply) => {
    const params = skillVersionParamsSchema.parse(request.params);
    const result = await setSkillVersionStatus(app.services.prisma, params.id, params.version, "active");
    return reply.code(result.status).send(result.body);
  });

  app.post("/skills/:id/versions/:version/disable", async (request, reply) => {
    const params = skillVersionParamsSchema.parse(request.params);
    const result = await setSkillVersionStatus(app.services.prisma, params.id, params.version, "inactive");
    return reply.code(result.status).send(result.body);
  });

  app.get("/policies", async () => {
    const policies = await app.services.prisma.policy.findMany({
      where: { status: "active" },
      include: {
        versions: {
          orderBy: { priority: "desc" },
          take: 1
        }
      },
      orderBy: { policyId: "asc" }
    });

    return {
      policies: policies.map((policy) => {
        const version = policy.versions[0];
        return {
          id: policy.id,
          policy_id: policy.policyId,
          name: policy.name,
          version: version?.version ?? "unknown",
          priority: version?.priority ?? 0,
          decision: version?.decision ?? "ALLOW",
          reason: version?.reason ?? "",
          definition: version?.definition ?? {},
          required_checks: version?.requiredChecks ?? [],
          approvers: version?.approvers ?? []
        };
      })
    };
  });
};

async function setSkillVersionStatus(
  prisma: PrismaClient,
  skillIdentifier: string,
  version: string,
  status: "active" | "inactive"
) {
  const skill = await prisma.skill.findFirst({
    where: {
      OR: [{ id: skillIdentifier }, { skillId: skillIdentifier }]
    }
  });

  if (!skill) return { status: 404 as const, body: { error: "Skill not found" } };

  const skillVersion = await prisma.skillVersion.findUnique({
    where: {
      skillRecordId_version: {
        skillRecordId: skill.id,
        version
      }
    }
  });

  if (!skillVersion) return { status: 404 as const, body: { error: "Skill version not found" } };

  const updated = await prisma.$transaction(async (tx) => {
    const updatedVersion = await tx.skillVersion.update({
      where: { id: skillVersion.id },
      data: { status }
    });

    if (status === "active") {
      await tx.skill.update({
        where: { id: skill.id },
        data: { status: "active" }
      });
    } else {
      const activeVersionCount = await tx.skillVersion.count({
        where: {
          skillRecordId: skill.id,
          status: "active"
        }
      });
      if (activeVersionCount === 0) {
        await tx.skill.update({
          where: { id: skill.id },
          data: { status: "inactive" }
        });
      }
    }

    return updatedVersion;
  });

  return {
    status: 200 as const,
    body: {
      skill_version: {
        id: updated.id,
        skill_id: skill.skillId,
        version: updated.version,
        status: updated.status,
        config: updated.config,
        execution: updated.execution
      }
    }
  };
}

function sourceTypeFromConfig(config: unknown): string | null {
  const record = config && typeof config === "object" && !Array.isArray(config) ? (config as Record<string, unknown>) : {};
  const source = record.source && typeof record.source === "object" && !Array.isArray(record.source) ? (record.source as Record<string, unknown>) : {};
  return typeof source.type === "string" ? source.type : null;
}
