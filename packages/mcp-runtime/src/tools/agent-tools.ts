import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GatewayClient } from "@spaceskit/client";

export function registerAgentTools(server: McpServer, client: GatewayClient): void {
  server.tool(
    "gateway.agent.list_definitions",
    "List all agent definitions on the gateway.",
    {
      includeArchived: z.boolean().optional().describe("Include archived definitions."),
    },
    async (args) => {
      try {
        const result = await client.listAgentDefinitions({
          includeArchived: args.includeArchived,
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
    "gateway.agent.get_definition",
    "Get details for a specific agent definition.",
    {
      agentDefinitionId: z.string().describe("The agent definition ID."),
    },
    async (args) => {
      try {
        const result = await client.getAgentDefinition(args.agentDefinitionId);
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
    "gateway.agent.create_definition",
    "Create a new agent definition.",
    {
      name: z.string().describe("Agent name."),
      description: z.string().optional().describe("Agent description."),
      instructions: z.string().optional().describe("System prompt / instructions for the agent."),
      defaultSkillIds: z.array(z.string()).optional().describe("Default skill IDs to attach."),
      providerHint: z.string().optional().describe("Preferred provider."),
      preferredModels: z.array(z.string()).optional().describe("Preferred model IDs, ordered by priority."),
      fallbackModels: z.array(z.string()).optional().describe("Fallback model IDs, ordered by priority."),
    },
    async (args) => {
      try {
        const result = await client.createAgentDefinition({
          name: args.name,
          description: args.description,
          instructions: args.instructions,
          defaultSkillIds: args.defaultSkillIds,
          providerHint: args.providerHint,
          modelConfig: modelConfigFromArgs(args),
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
    "gateway.agent.update_definition",
    "Update an existing agent definition.",
    {
      agentDefinitionId: z.string().describe("The agent definition ID to update."),
      name: z.string().optional().describe("New name."),
      description: z.string().optional().describe("New description."),
      instructions: z.string().optional().describe("New system prompt / instructions."),
      defaultSkillIds: z.array(z.string()).optional().describe("New default skill IDs."),
      providerHint: z.string().optional().describe("New preferred provider."),
      preferredModels: z.array(z.string()).optional().describe("New preferred model IDs, ordered by priority."),
      fallbackModels: z.array(z.string()).optional().describe("New fallback model IDs, ordered by priority."),
    },
    async (args) => {
      try {
        const result = await client.updateAgentDefinition({
          agentDefinitionId: args.agentDefinitionId,
          name: args.name,
          description: args.description,
          instructions: args.instructions,
          defaultSkillIds: args.defaultSkillIds,
          providerHint: args.providerHint,
          modelConfig: modelConfigFromArgs(args),
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
    "gateway.agent.list_personas",
    "List all personas on the gateway.",
    {},
    async () => {
      try {
        const result = await client.listPersonas();
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

function modelConfigFromArgs(args: {
  preferredModels?: string[];
  fallbackModels?: string[];
}): { preferredModels: string[]; fallbackModels?: string[] } | undefined {
  const preferredModels = normalizeModelIds(args.preferredModels);
  const fallbackModels = normalizeModelIds(args.fallbackModels);
  if (preferredModels.length === 0 && fallbackModels.length === 0) {
    return undefined;
  }
  return {
    preferredModels,
    ...(fallbackModels.length > 0 ? { fallbackModels } : {}),
  };
}

function normalizeModelIds(value: string[] | undefined): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return Array.from(new Set(value.map((entry) => entry.trim()).filter(Boolean)));
}
