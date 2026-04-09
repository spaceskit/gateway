import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GatewayClient } from "@spaceskit/client";

export function registerAdminTools(server: McpServer, client: GatewayClient): void {
  server.tool(
    "gateway.admin.get_policy",
    "Get the current gateway-wide policy.",
    {},
    async () => {
      try {
        const result = await client.getGatewayPolicy();
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
    "gateway.admin.update_policy",
    "Update the gateway-wide policy.",
    {
      allowedCapabilityTypes: z
        .array(z.string())
        .optional()
        .describe("Capability types to allow."),
      deniedCapabilityTypes: z
        .array(z.string())
        .optional()
        .describe("Capability types to deny."),
      allowedSkillIds: z
        .array(z.string())
        .optional()
        .describe("Skill IDs to allow."),
      deniedSkillIds: z
        .array(z.string())
        .optional()
        .describe("Skill IDs to deny."),
      globalFlags: z
        .record(z.string(), z.unknown())
        .optional()
        .describe("Global policy flags to set."),
    },
    async (args) => {
      try {
        const result = await client.updateGatewayPolicy({
          allowedCapabilityTypes: args.allowedCapabilityTypes,
          deniedCapabilityTypes: args.deniedCapabilityTypes,
          allowedSkillIds: args.allowedSkillIds,
          deniedSkillIds: args.deniedSkillIds,
          globalFlags: args.globalFlags,
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
    "gateway.admin.list_tools",
    "List all registered tools on the gateway.",
    {},
    async () => {
      try {
        const result = await client.listTools();
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
    "gateway.admin.register_tool",
    "Register a new tool on the gateway.",
    {
      id: z.string().describe("Unique tool identifier."),
      displayName: z.string().describe("Tool display name."),
      description: z.string().describe("Tool description."),
      executable: z.string().describe("Path to the executable."),
      argsTemplate: z.array(z.string()).describe("Arguments template array."),
      inputSchema: z.record(z.string(), z.unknown()).optional().describe("JSON Schema for tool input."),
      cwdMode: z
        .enum(["space_root", "fixed"])
        .optional()
        .describe("Working directory mode (default: 'space_root')."),
      outputMode: z
        .enum(["text", "json"])
        .optional()
        .describe("Output mode (default: 'text')."),
      instructions: z.string().optional().describe("Usage instructions for the tool."),
    },
    async (args) => {
      try {
        const result = await client.registerTool({
          id: args.id,
          displayName: args.displayName,
          description: args.description,
          executable: args.executable,
          argsTemplate: args.argsTemplate,
          inputSchema: args.inputSchema ?? {},
          cwdMode: args.cwdMode ?? "space_root",
          outputMode: args.outputMode ?? "text",
          instructions: args.instructions,
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
    "gateway.admin.list_library",
    "List all library entries (skills, templates, etc.).",
    {
      query: z.string().optional().describe("Search query."),
      sourceKinds: z
        .array(z.enum(["installed", "scanned", "verified", "system"]))
        .optional()
        .describe("Filter by source kind."),
      limit: z.number().optional().describe("Max results."),
    },
    async (args) => {
      try {
        const result = await client.listLibraryEntries({
          query: args.query,
          sourceKinds: args.sourceKinds,
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
    "gateway.admin.save_skill",
    "Save a skill to the gateway library.",
    {
      name: z.string().describe("Skill name."),
      contentMarkdown: z.string().describe("Skill content in Markdown."),
      description: z.string().optional().describe("Skill description."),
      tags: z.array(z.string()).optional().describe("Tags."),
    },
    async (args) => {
      try {
        const result = await client.saveLibrarySkill({
          name: args.name,
          contentMarkdown: args.contentMarkdown,
          description: args.description,
          tags: args.tags,
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
    "gateway.admin.list_scheduler_jobs",
    "List all scheduled jobs.",
    {},
    async () => {
      try {
        const result = await client.listSchedulerJobs();
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
    "gateway.admin.create_scheduler_job",
    "Create a new scheduled job.",
    {
      name: z.string().describe("Job name."),
      timezone: z.string().describe("IANA timezone (e.g. 'America/New_York')."),
      schedulePreset: z
        .object({
          kind: z.enum(["hourly", "daily", "weekly"]).describe("Schedule kind."),
          intervalHours: z.number().optional().describe("Interval in hours (for hourly kind)."),
          minute: z.number().describe("Minute of the hour (0-59)."),
          hour: z.number().optional().describe("Hour of the day (0-23, for daily/weekly)."),
          daysOfWeek: z.array(z.number()).optional().describe("Days of the week (0=Sun, for weekly)."),
        })
        .describe("Schedule preset configuration."),
      action: z
        .object({
          type: z.enum(["space_prompt"]).describe("Action type."),
          promptText: z.string().describe("Prompt text to execute."),
          targetAgentId: z.string().optional().describe("Target agent ID."),
        })
        .describe("Action to execute on schedule."),
      primarySpaceId: z.string().describe("Primary space ID for the job."),
      relatedSpaceIds: z.array(z.string()).optional().describe("Additional related space IDs."),
    },
    async (args) => {
      try {
        const result = await client.createSchedulerJob({
          name: args.name,
          timezone: args.timezone,
          schedulePreset: args.schedulePreset,
          action: args.action,
          primarySpaceId: args.primarySpaceId,
          relatedSpaceIds: args.relatedSpaceIds,
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
