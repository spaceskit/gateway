/**
 * Standalone stdio MCP echo server for workbench testing.
 *
 * Spawned as a child process by the workbench harness.
 * Provides three tools: echo, add, and fail.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({
  name: "workbench-echo",
  version: "1.0.0",
});

// Tool: echo — returns input arguments back as-is
server.tool(
  "echo",
  "Returns the input arguments back as-is",
  { message: z.string().describe("The message to echo back") },
  async (args) => ({
    content: [{ type: "text", text: JSON.stringify(args) }],
  }),
);

// Tool: add — returns the sum of two numbers
server.tool(
  "add",
  "Returns the sum of two numbers",
  {
    a: z.number().describe("First operand"),
    b: z.number().describe("Second operand"),
  },
  async (args) => ({
    content: [{ type: "text", text: String(args.a + args.b) }],
  }),
);

// Tool: fail — always throws (for testing error handling)
server.tool(
  "fail",
  "Always throws an error for testing error handling",
  {},
  async () => {
    throw new Error("intentional failure from workbench-echo");
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[workbench-echo] MCP server running on stdio");
}

main().catch((err) => {
  console.error("[workbench-echo] Fatal:", err);
  process.exit(1);
});
