import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GatewayClient } from "@spaceskit/client";
import { registerSpaceTools } from "./space-tools.js";
import { registerChatTools } from "./chat-tools.js";
import { registerAgentTools } from "./agent-tools.js";
import { registerObservabilityTools } from "./observability-tools.js";
import { registerAdminTools } from "./admin-tools.js";

export function registerAllTools(server: McpServer, client: GatewayClient): void {
  registerSpaceTools(server, client);
  registerChatTools(server, client);
  registerAgentTools(server, client);
  registerObservabilityTools(server, client);
  registerAdminTools(server, client);
}
