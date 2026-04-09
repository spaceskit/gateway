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
      modelHint: z.string().optional().describe("Preferred model (e.g. 'claude/sonnet')."),
    },
    async (args) => {
      try {
        const result = await client.createAgentDefinition({
          name: args.name,
          description: args.description,
          instructions: args.instructions,
          defaultSkillIds: args.defaultSkillIds,
          providerHint: args.providerHint,
          modelHint: args.modelHint,
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
      modelHint: z.string().optional().describe("New preferred model."),
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
          modelHint: args.modelHint,
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
