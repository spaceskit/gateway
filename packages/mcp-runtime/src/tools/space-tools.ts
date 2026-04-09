import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GatewayClient } from "@spaceskit/client";

export function registerSpaceTools(server: McpServer, client: GatewayClient): void {
  server.tool(
    "gateway.space.list",
    "List all spaces on the gateway, optionally filtered by status.",
    {
      statuses: z
        .array(z.enum(["created", "active", "paused", "completed", "failed"]))
        .optional()
        .describe("Filter by space status. Omit for all."),
      limit: z.number().optional().describe("Max results (default 20)."),
    },
    async (args) => {
      try {
        const result = await client.listSpaces({
          statuses: args.statuses,
          limit: args.limit,
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
    "gateway.space.get",
    "Get details for a specific space by ID.",
    {
      spaceId: z.string().describe("The space ID to look up."),
    },
    async (args) => {
      try {
        const result = await client.getSpace(args.spaceId);
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
    "gateway.space.create",
    "Create a new space on the gateway.",
    {
      name: z.string().describe("Display name for the space."),
      resourceId: z.string().describe("Resource identifier for the space."),
      spaceId: z.string().optional().describe("Optional explicit space ID."),
      spaceType: z.string().optional().describe("Space type (default: 'space')."),
      goal: z.string().optional().describe("Goal or description for the space."),
    },
    async (args) => {
      try {
        const result = await client.createSpace({
          name: args.name,
          resourceId: args.resourceId,
          spaceId: args.spaceId,
          spaceType: args.spaceType,
          goal: args.goal,
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
    "gateway.space.archive",
    "Archive a space.",
    {
      spaceId: z.string().describe("The space ID to archive."),
    },
    async (args) => {
      try {
        const result = await client.archiveSpace({ spaceId: args.spaceId });
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
    "gateway.space.delete",
    "Soft-delete a space.",
    {
      spaceId: z.string().describe("The space ID to delete."),
    },
    async (args) => {
      try {
        const result = await client.deleteSpace({ spaceId: args.spaceId });
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
    "gateway.space.list_agents",
    "List all agents assigned to a space.",
    {
      spaceId: z.string().describe("The space ID."),
    },
    async (args) => {
      try {
        const result = await client.listAgentAssignments(args.spaceId);
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
    "gateway.space.add_agent",
    "Assign an agent to a space.",
    {
      spaceId: z.string().describe("Target space ID."),
      agentId: z.string().describe("Agent ID to assign."),
      profileId: z.string().describe("Agent profile ID."),
      role: z
        .enum(["participant", "global_coordinator", "space_moderator"])
        .optional()
        .describe("Agent role in the space."),
      isPrimary: z.boolean().optional().describe("Whether this agent is the primary agent."),
    },
    async (args) => {
      try {
        const result = await client.addAgent({
          spaceId: args.spaceId,
          agentId: args.agentId,
          profileId: args.profileId,
          role: args.role,
          isPrimary: args.isPrimary,
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
    "gateway.space.remove_agent",
    "Remove an agent assignment from a space.",
    {
      spaceId: z.string().describe("Target space ID."),
      agentId: z.string().describe("Agent ID to remove."),
    },
    async (args) => {
      try {
        const result = await client.removeAgent({
          spaceId: args.spaceId,
          agentId: args.agentId,
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
