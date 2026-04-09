import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GatewayClient } from "@spaceskit/client";

export function registerObservabilityTools(server: McpServer, client: GatewayClient): void {
  server.tool(
    "gateway.observe.activity_log",
    "Get the activity log for a space.",
    {
      spaceId: z.string().describe("The space ID."),
      limit: z.number().optional().describe("Max entries to return."),
      offset: z.number().optional().describe("Pagination offset."),
    },
    async (args) => {
      try {
        const result = await client.listActivityLog({
          spaceId: args.spaceId,
          limit: args.limit,
          offset: args.offset,
        });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    "gateway.observe.turn_trace",
    "Get a detailed trace for a specific turn including events, tool calls, and activities.",
    {
      spaceId: z.string().describe("The space ID."),
      turnId: z.string().describe("The turn ID to trace."),
    },
    async (args) => {
      try {
        const result = await client.getTurnTrace({
          spaceId: args.spaceId,
          turnId: args.turnId,
        });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    "gateway.observe.orchestration_journal",
    "List the orchestration journal (event ledger) for a space.",
    {
      spaceId: z.string().describe("The space ID."),
      limit: z.number().optional().describe("Max entries to return."),
      offset: z.number().optional().describe("Pagination offset."),
    },
    async (args) => {
      try {
        const result = await client.listOrchestrationJournal({
          spaceId: args.spaceId,
          limit: args.limit,
          offset: args.offset,
        });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    "gateway.observe.usage",
    "Get the current usage snapshot (tokens, budgets, provider usage).",
    {},
    async () => {
      try {
        const result = await client.getUsageSnapshot();
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    "gateway.observe.experiences",
    "List agent experience records for a space.",
    {
      spaceId: z.string().describe("The space ID."),
      limit: z.number().optional().describe("Max entries to return."),
      offset: z.number().optional().describe("Pagination offset."),
    },
    async (args) => {
      try {
        const result = await client.listExperiences({
          spaceId: args.spaceId,
          limit: args.limit,
          offset: args.offset,
        });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    "gateway.observe.insights",
    "List personality insights for a space.",
    {
      spaceId: z.string().describe("The space ID."),
      limit: z.number().optional().describe("Max entries to return."),
      offset: z.number().optional().describe("Pagination offset."),
    },
    async (args) => {
      try {
        const result = await client.listInsights({
          spaceId: args.spaceId,
          limit: args.limit,
          offset: args.offset,
        });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    },
  );
}
