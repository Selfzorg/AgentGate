import type { ExecutionToken } from "@prisma/client";

const TOKEN_REQUIRED_SKILLS = new Set(["deploy-production", "run-db-migration", "drop-table", "merge-pr", "unknown-destructive"]);

const CONNECTOR_ENVIRONMENT_ALLOWLIST: Record<string, string[]> = {
  "deployment-demo-connector": ["staging", "production"],
  "db-demo-connector": ["production"],
  "github-demo-connector": ["dev", "staging", "production"],
  "claude-cli-adapter": ["dev", "staging", "production"],
  "codex-cli-adapter": ["dev", "staging", "production"],
  "mcp-tool-adapter": ["dev", "staging", "production"],
  "native-connector-adapter": ["dev", "staging", "production"]
};

export type ExecutionControlInput = {
  skillId: string;
  connectorName: string;
  environment: string | null;
  token: ExecutionToken | null;
};

export type ExecutionControlResult =
  | {
      allowed: true;
      metadata: Record<string, unknown>;
    }
  | {
      allowed: false;
      reason: string;
      metadata: Record<string, unknown>;
    };

export function validateExecutionControls(input: ExecutionControlInput): ExecutionControlResult {
  const allowedEnvironments = CONNECTOR_ENVIRONMENT_ALLOWLIST[input.connectorName] ?? [];
  if (input.environment && !allowedEnvironments.includes(input.environment)) {
    return deny("Live connector refuses mismatched environment.", input, {
      allowed_environments: allowedEnvironments
    });
  }

  if (TOKEN_REQUIRED_SKILLS.has(input.skillId) && !input.token) {
    return deny("AgentGate execution credential is required for this connector path.", input, {
      token_status: "missing"
    });
  }

  if (input.token && input.token.environment !== input.environment) {
    return deny("Execution token environment does not match connector environment.", input, {
      token_environment: input.token.environment
    });
  }

  const scopes = scopesFromToken(input.token);
  const missingScopes = scopesForSkill(input.skillId, input.environment).filter((scope) => !scopes.includes(scope));
  if (input.token && missingScopes.length > 0) {
    return deny("Execution token is missing connector scope.", input, {
      missing_scopes: missingScopes
    });
  }

  return {
    allowed: true,
    metadata: controlMetadata(input, {
      token_status: input.token ? "present" : "not_required",
      token_scopes: scopes
    })
  };
}

function deny(reason: string, input: ExecutionControlInput, extra: Record<string, unknown>): ExecutionControlResult {
  return {
    allowed: false,
    reason,
    metadata: controlMetadata(input, extra)
  };
}

function controlMetadata(input: ExecutionControlInput, extra: Record<string, unknown>) {
  return {
    control: "production_readiness",
    skill_id: input.skillId,
    connector: input.connectorName,
    environment: input.environment,
    execution_token_id: input.token?.id ?? null,
    ...extra
  };
}

function scopesFromToken(token: ExecutionToken | null) {
  return Array.isArray(token?.scopes) ? token.scopes.filter((scope): scope is string => typeof scope === "string") : [];
}

function scopesForSkill(skillId: string, environment?: string | null): string[] {
  if (skillId === "deploy-production") return ["deploy:production"];
  if (skillId === "deploy-staging") return ["deploy:staging"];
  if (skillId === "run-db-migration") return [`database:migrate:${environment ?? "unknown"}`];
  if (skillId === "merge-pr") return ["git:merge"];
  return [`skill:${skillId}:execute`];
}
