import type { FastifyPluginAsync } from "fastify";
import { ZodError, z } from "zod";
import { createDecisionService } from "../services/decision-service";

const simplifiedMcpPayloadSchema = z.object({
  tenant_id: z.string(),
  workspace_id: z.string(),
  agent: z.object({
    agent_id: z.string(),
    agent_type: z.string(),
    role: z.string()
  }),
  server: z.string().optional(),
  tool_name: z.string(),
  arguments: z.record(z.unknown()).optional(),
  context: z.record(z.unknown()).default({})
});

const jsonRpcPayloadSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number(), z.null()]).optional(),
  method: z.string(),
  params: z
    .object({
      name: z.string(),
      arguments: z.record(z.unknown()).optional(),
      _meta: z
        .object({
          tenant_id: z.string(),
          workspace_id: z.string(),
          agent: z.object({
            agent_id: z.string(),
            agent_type: z.string(),
            role: z.string()
          }),
          context: z.record(z.unknown()).optional()
        })
        .optional()
    })
    .optional()
});

export const registerMcpRoutes: FastifyPluginAsync = async (app) => {
  app.post("/mcp/invoke", async (request, reply) => {
    const service = createDecisionService({ prisma: app.services.prisma });
    const body = request.body;

    if (isJsonRpcPayload(body)) {
      const parsed = jsonRpcPayloadSchema.safeParse(body);
      const id = parsed.success ? parsed.data.id : null;

      if (!parsed.success) {
        return reply.code(400).send(jsonRpcError(id, -32602, "Invalid JSON-RPC tools/call payload."));
      }

      if (parsed.data.method !== "tools/call") {
        return jsonRpcError(
          parsed.data.id,
          -32601,
          "Unsupported MCP method for MVP subset. Supported method: tools/call."
        );
      }

      if (!parsed.data.params?._meta?.tenant_id) {
        return reply
          .code(400)
          .send(jsonRpcError(parsed.data.id, -32602, "Missing _meta.tenant_id."));
      }

      const normalized = {
        tenant_id: parsed.data.params._meta.tenant_id,
        workspace_id: parsed.data.params._meta.workspace_id,
        source: "mcp_proxy",
        adapter_type: "mcp_proxy",
        agent: parsed.data.params._meta.agent,
        tool: {
          tool_name: parsed.data.params.name
        },
        raw_action: rawMcpAction(parsed.data.params.name, parsed.data.params.arguments),
        context: parsed.data.params._meta.context ?? {}
      };

      const decision = await service.evaluate(normalized);
      return jsonRpcDecisionResult(parsed.data.id, decision);
    }

    try {
      const parsed = simplifiedMcpPayloadSchema.parse(body);
      return await service.evaluate({
        tenant_id: parsed.tenant_id,
        workspace_id: parsed.workspace_id,
        source: "mcp_proxy",
        adapter_type: "mcp_proxy",
        agent: parsed.agent,
        tool: {
          tool_name: parsed.tool_name
        },
        raw_action: rawMcpAction(parsed.tool_name, parsed.arguments),
        context: parsed.context
      });
    } catch (error) {
      if (error instanceof ZodError) {
        return reply.code(400).send({
          error: "Validation error",
          issues: error.issues
        });
      }

      request.log.error(error);
      return reply.code(500).send({
        error: "MCP invocation failed"
      });
    }
  });
};

function isJsonRpcPayload(payload: unknown): payload is Record<string, unknown> {
  return Boolean(payload && typeof payload === "object" && "jsonrpc" in payload);
}

function rawMcpAction(name: string, args: Record<string, unknown> = {}): string {
  return `${name}(${JSON.stringify(args)})`;
}

function jsonRpcError(id: unknown, code: number, message: string) {
  return {
    jsonrpc: "2.0",
    id: id ?? null,
    error: {
      code,
      message
    }
  };
}

function jsonRpcDecisionResult(id: unknown, decision: Awaited<ReturnType<ReturnType<typeof createDecisionService>["evaluate"]>>) {
  const allowed = decision.decision === "ALLOW";
  return {
    jsonrpc: "2.0",
    id: id ?? null,
    result: {
      content: [
        {
          type: "text",
          text: allowed
            ? "AgentGate allowed the tool call."
            : `AgentGate blocked this tool call: ${decision.reason}`
        }
      ],
      isError: !allowed,
      agentgate: {
        decision: decision.decision,
        skill_id: decision.skill_id,
        risk_level: decision.risk_level,
        run_id: decision.run_id,
        trace_id: decision.trace_id,
        reason: decision.reason
      }
    }
  };
}
