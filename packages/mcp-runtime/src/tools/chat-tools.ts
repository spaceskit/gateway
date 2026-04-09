import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GatewayClient } from "@spaceskit/client";

export function registerChatTools(server: McpServer, client: GatewayClient): void {
  server.tool(
    "gateway.chat.execute_turn",
    "Send a message to a space and get the agent's response. This may take up to 2 minutes for complex requests.",
    {
      spaceUid: z.string().describe("The space UID to send the message to."),
      input: z.string().describe("The message text to send."),
      targetAgentId: z.string().optional().describe("Optional: target a specific agent in the space."),
      mode: z
        .enum(["ask", "plan", "execute"])
        .optional()
        .describe("Turn mode. 'ask' for questions, 'plan' for planning, 'execute' for actions."),
      effort: z
        .enum(["low", "medium", "high"])
        .optional()
        .describe("How much effort the agent should invest."),
    },
    async (args) => {
      try {
        const result = await client.executeTurn({
          spaceUid: args.spaceUid,
          input: args.input,
          targetAgentId: args.targetAgentId,
          mode: args.mode,
          effort: args.effort,
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
    "gateway.chat.list_turns",
    "List the orchestration journal (turn and event history) for a space.",
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
    "gateway.chat.get_turn_trace",
    "Get a detailed trace for a specific turn, including tool calls and events.",
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
    "gateway.chat.resume_feedback",
    "Resume a turn that is waiting for human feedback (approve, reject, revise, or defer).",
    {
      spaceUid: z.string().describe("The space UID."),
      turnId: z.string().describe("The turn ID waiting for feedback."),
      response: z
        .enum(["approve", "reject", "revise", "defer"])
        .describe("Your feedback response."),
      revision: z.string().optional().describe("Revised text if response is 'revise'."),
    },
    async (args) => {
      try {
        await client.resumeFeedback(
          args.spaceUid,
          args.turnId,
          args.response,
          args.revision,
        );
        const result = { ok: true };
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
