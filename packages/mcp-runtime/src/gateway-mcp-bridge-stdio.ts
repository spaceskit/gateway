/**
 * Standalone stdio MCP server that exposes gateway-registered tools to CLI executors.
 *
 * Spawned by Claude CLI (via --mcp-config) as a child process.
 * Reads tool definitions from GATEWAY_TOOLS_JSON env var.
 * Communicates with the gateway process via a Unix domain socket at GATEWAY_SOCKET_PATH
 * for actual tool execution.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createConnection } from "node:net";

interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

interface ProxyResponse {
  id: string;
  result: unknown;
  isError?: boolean;
}

// Support both inline JSON (GATEWAY_TOOLS_JSON) and file path (GATEWAY_TOOLS_PATH)
let toolDefsJson = process.env.GATEWAY_TOOLS_JSON;
const socketPath = process.env.GATEWAY_SOCKET_PATH;

if (!toolDefsJson && process.env.GATEWAY_TOOLS_PATH) {
  try {
    toolDefsJson = require("node:fs").readFileSync(process.env.GATEWAY_TOOLS_PATH, "utf-8");
  } catch (err) {
    console.error(`[gateway-mcp-bridge] Failed to read GATEWAY_TOOLS_PATH: ${err}`);
    process.exit(1);
  }
}

if (!toolDefsJson || !socketPath) {
  console.error("[gateway-mcp-bridge] Missing GATEWAY_TOOLS_JSON/GATEWAY_TOOLS_PATH or GATEWAY_SOCKET_PATH");
  process.exit(1);
}

let toolDefs: ToolDef[];
try {
  toolDefs = JSON.parse(toolDefsJson);
} catch {
  console.error("[gateway-mcp-bridge] Invalid GATEWAY_TOOLS_JSON");
  process.exit(1);
}

/**
 * Send a tool call to the gateway process via Unix socket and wait for the result.
 * Each call opens a fresh connection, sends the request, reads the full response, and closes.
 */
function executeViaProxy(name: string, args: Record<string, unknown>): Promise<ProxyResponse> {
  return new Promise((resolve, reject) => {
    const id = `${name}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
    const conn = createConnection(socketPath!);
    let data = "";

    conn.setEncoding("utf8");
    conn.on("data", (chunk: string) => {
      data += chunk;
    });
    conn.on("end", () => {
      try {
        const response = JSON.parse(data) as ProxyResponse;
        resolve(response);
      } catch {
        reject(new Error(`Invalid response from gateway proxy: ${data.slice(0, 200)}`));
      }
    });
    conn.on("error", (err) => {
      reject(new Error(`Gateway proxy connection failed: ${err.message}`));
    });

    const request = JSON.stringify({ type: "execute", id, name, arguments: args });
    conn.write(request + "\n");
  });
}

const server = new McpServer({
  name: "spaceskit-gateway-bridge",
  version: "1.0.0",
});

for (const tool of toolDefs) {
  // McpServer.tool() with raw inputSchema object (no zod)
  server.tool(
    tool.name,
    tool.description ?? "",
    tool.inputSchema ?? {},
    async (args: Record<string, unknown>) => {
      try {
        const response = await executeViaProxy(tool.name, args);
        const text = typeof response.result === "string"
          ? response.result
          : JSON.stringify(response.result ?? {});
        return {
          content: [{ type: "text" as const, text }],
          isError: response.isError === true,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text" as const, text: `Gateway tool error: ${message}` }],
          isError: true,
        };
      }
    },
  );
}

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[gateway-mcp-bridge] Running with ${toolDefs.length} tools`);
}

main().catch((err) => {
  console.error("[gateway-mcp-bridge] Fatal:", err);
  process.exit(1);
});
