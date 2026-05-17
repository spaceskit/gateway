import type { ToolDefinition } from "./model-provider.js";
import type { PlatformToolConfig } from "./platform-tool-types.js";

export function createPlatformToolDefinitions(_config?: PlatformToolConfig): ToolDefinition[] {
  return [
    {
      name: "platform.orchestrateTask",
      description:
        "Create a coordinated multi-agent task and return the task id, space id, and root turn id.",
      inputSchema: {
        type: "object",
        properties: {
          taskDescription: { type: "string" },
          templateHint: { type: "string" },
          templateId: { type: "string" },
          agentCount: { type: "integer" },
          agentTier: { type: "string" },
          topology: { type: "string" },
          spaceId: { type: "string" },
          maxTurns: { type: "integer" },
        },
        required: ["taskDescription"],
      },
    },
    {
      name: "platform.getTaskProgress",
      description:
        "Look up the current state and progress for an orchestrated task owned by the current principal.",
      inputSchema: {
        type: "object",
        properties: {
          taskId: { type: "string" },
        },
        required: ["taskId"],
      },
    },
    {
      name: "platform.searchExperiences",
      description:
        "Search memory/experience records. Embedded mode searches without principal scoping; external mode requires a principal.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string" },
          limit: { type: "integer" },
          status: {
            type: "string",
            description: 'Optional experience status filter. Defaults to "accepted".',
          },
          minScore: {
            type: "number",
            description: "Optional minimum relevance score between 0 and 1.",
          },
        },
        required: ["query"],
      },
    },
    {
      name: "platform.getSpaceStatus",
      description:
        "Get the current status of a space including its state, agents, turn count, and configuration. " +
        "Defaults to the current space if no spaceId is provided.",
      inputSchema: {
        type: "object",
        properties: {
          spaceId: {
            type: "string",
            description: "Space ID to inspect. Omit to use the current space.",
          },
        },
      },
    },
    {
      name: "platform.listSpaces",
      description:
        "List spaces managed by this gateway, optionally filtered by status. " +
        "Returns space ID, name, state, agent count, and turn model.",
      inputSchema: {
        type: "object",
        properties: {
          statuses: {
            type: "array",
            items: { type: "string" },
            description:
              'Filter by space state: "created", "active", "paused", "completed", "failed". Omit for all.',
          },
          limit: {
            type: "integer",
            description: "Maximum number of spaces to return. Default: 20.",
            minimum: 1,
            maximum: 100,
          },
        },
      },
    },
    {
      name: "platform.listAgents",
      description:
        "List all agents assigned to a space with their roles, turn order, and profile names. " +
        "Defaults to the current space if no spaceId is provided.",
      inputSchema: {
        type: "object",
        properties: {
          spaceId: {
            type: "string",
            description: "Space ID to inspect. Omit to use the current space.",
          },
        },
      },
    },
    {
      name: "platform.getAgentProfile",
      description:
        "Get details about an agent profile: name, description, model hints, and skills. " +
        "Does not include security scope details.",
      inputSchema: {
        type: "object",
        properties: {
          profileId: {
            type: "string",
            description: "The profile ID to look up.",
          },
        },
        required: ["profileId"],
      },
    },
    {
      name: "platform.listRecentTurns",
      description:
        "List recent turns in a space, showing actor, status, and a content preview. " +
        "Content is truncated to 200 characters. Defaults to the current space.",
      inputSchema: {
        type: "object",
        properties: {
          spaceId: {
            type: "string",
            description: "Space ID to inspect. Omit to use the current space.",
          },
          limit: {
            type: "integer",
            description: "Maximum number of turns to return. Default: 10.",
            minimum: 1,
            maximum: 50,
          },
        },
      },
    },
    {
      name: "platform.getSpaceDigest",
      description:
        "Return a concise digest of a space's recent activity for concierge and navigation flows.",
      inputSchema: {
        type: "object",
        properties: {
          spaceId: {
            type: "string",
            description: "Space ID to inspect. Omit to use the current space.",
          },
          limit: {
            type: "integer",
            description: "Maximum number of recent turns to include. Default: 3.",
            minimum: 1,
            maximum: 10,
          },
        },
      },
    },
    {
      name: "platform.getSystemStatus",
      description:
        "Get gateway system status: uptime, registered capabilities, and active space count.",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
  ];
}
