/**
 * In-gateway HTTP MCP transport.
 *
 * Creates an MCP server using WebStandardStreamableHTTPServerTransport
 * that runs inside the gateway process and serves at /mcp.
 *
 * Uses a loopback GatewayClient to access the same gateway via WebSocket.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { GatewayClient } from "@spaceskit/client";
import { registerAllTools } from "./tools/tool-registry.js";

const MCP_ENDPOINT_PATH = "/mcp";

/**
 * Create an HTTP handler for the in-gateway MCP server.
 *
 * Returns a function matching the gateway's httpHandler signature:
 * `(req: Request, url: URL) => Promise<Response | null>`
 *
 * Returns null for non-MCP paths so the handler chain can continue.
 */
export async function createGatewayMcpHttpHandler(
  client: GatewayClient,
): Promise<(req: Request, url: URL) => Promise<Response | null>> {
  const mcpServer = new McpServer({
    name: "spaceskit-gateway",
    version: "1.0.0",
  });

  registerAllTools(mcpServer, client);

  // Stateless mode — no session tracking needed for gateway tools
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  await mcpServer.connect(transport);

  return async (req: Request, url: URL): Promise<Response | null> => {
    if (url.pathname !== MCP_ENDPOINT_PATH) {
      return null;
    }

    try {
      return await transport.handleRequest(req);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: null,
          error: { code: -32000, message },
        }),
        { status: 500, headers: { "content-type": "application/json" } },
      );
    }
  };
}
