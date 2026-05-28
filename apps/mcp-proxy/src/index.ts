#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { pathToFileURL } from "node:url";
import { configFromEnv, type AgentGateMcpConfig } from "./agentgate-client.js";
import { callAgentGateTool, listAgentGateTools } from "./tools.js";

export function createAgentGateMcpServer(config: AgentGateMcpConfig = configFromEnv()): McpServer {
  const server = new McpServer({
    name: "agentgate-mcp-proxy",
    version: "0.0.0"
  });

  for (const tool of listAgentGateTools()) {
    server.tool(tool.name, tool.description, tool.inputSchema, async (args) => {
      return callAgentGateTool(tool.name, args, config);
    });
  }

  return server;
}

export async function startStdioServer(config: AgentGateMcpConfig = configFromEnv()): Promise<void> {
  const server = createAgentGateMcpServer(config);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await startStdioServer();
}

export { AGENTGATE_TOOL_NAMES, callAgentGateTool, listAgentGateTools } from "./tools.js";
export { configFromEnv } from "./agentgate-client.js";
export { redactedJson, redactText, redactValue } from "./redact.js";
