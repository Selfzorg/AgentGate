import type { FastifyPluginAsync } from "fastify";

export const registerCatalogRoutes: FastifyPluginAsync = async (app) => {
  app.get("/skills", async () => {
    const skills = await app.services.prisma.skill.findMany({
      where: { status: "active" },
      include: {
        versions: {
          orderBy: { createdAt: "desc" },
          take: 1,
          include: {
            connector: true
          }
        }
      },
      orderBy: [{ category: "asc" }, { skillId: "asc" }]
    });

    return {
      skills: skills.map((skill) => {
        const version = skill.versions[0];
        return {
          id: skill.id,
          skill_id: skill.skillId,
          name: skill.name,
          category: skill.category,
          default_risk_level: skill.defaultRiskLevel,
          description: skill.description,
          version: version?.version ?? "unknown",
          connector: version?.connector?.connectorId ?? null,
          execution: version?.execution ?? {}
        };
      })
    };
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
