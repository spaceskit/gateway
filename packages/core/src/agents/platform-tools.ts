/**
 * Platform Introspection Tools — read-only tools for coordinator agents.
 *
 * Gives the orchestrator agent the ability to answer questions about gateway
 * state: spaces, agents, turns, and system health. All tools are read-only;
 * mutations stay in OrchestratorCommandService.
 *
 * Follows the agent-as-tool.ts pattern: export tool definitions + executor.
 */

import type { ToolDefinition, ToolResult } from "./model-provider.js";
import type { SpaceAdminService } from "../spaces/space-admin-service.js";
import type { CapabilityRegistry } from "../capabilities/registry.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PlatformToolConfig {
  spaceAdminService: SpaceAdminService;
  capabilityRegistry: CapabilityRegistry;
  /** Optional turn repository for listing recent turns. */
  turnRepo?: {
    listBySpace(spaceId: string, limit?: number, offset?: number): Array<{
      turn_id: string;
      space_id: string;
      actor_type: string;
      actor_id: string;
      input_json: string | null;
      output_json: string | null;
      status: string;
      token_input_count: number;
      token_output_count: number;
      created_at: string;
      completed_at: string | null;
    }>;
    countBySpace(spaceId: string): number;
  } | null;
  /** Optional profile repository for agent profile lookups. */
  profileRepo?: {
    getById(profileId: string): {
      profile_id: string;
      name: string;
      description: string;
      can_moderate: number;
      is_default: number;
      active_revision: number;
      archived: number;
      created_at: string;
      updated_at: string;
    } | undefined;
    getActiveRevision(profileId: string): {
      profile_id: string;
      revision: number;
      personality_prompt: string;
      default_skill_set_ids_json: string;
      provider_hint: string;
      model_hint: string;
      created_at: string;
    } | undefined;
  } | null;
  /** Gateway uptime start time (for system status). */
  startedAt?: Date;
}

export interface PlatformToolExecutionContext {
  spaceId: string;
  agentId: string;
  turnId: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PLATFORM_TOOL_PREFIX = "platform.";
const MAX_TURN_CONTENT_PREVIEW = 200;

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

export function createPlatformToolDefinitions(_config?: PlatformToolConfig): ToolDefinition[] {
  return [
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

// ---------------------------------------------------------------------------
// Executor
// ---------------------------------------------------------------------------

export function createPlatformToolExecutor(
  config: PlatformToolConfig,
): (name: string, args: Record<string, unknown>, context: PlatformToolExecutionContext) => Promise<ToolResult> {
  const { spaceAdminService, capabilityRegistry, turnRepo, profileRepo, startedAt } = config;

  return async (name: string, args: Record<string, unknown>, context: PlatformToolExecutionContext): Promise<ToolResult> => {
    const toolCallId = `${name}:${context.turnId}`;

    try {
      switch (name) {
        case "platform.getSpaceStatus":
          return await executeGetSpaceStatus(args, context, toolCallId);

        case "platform.listSpaces":
          return await executeListSpaces(args, toolCallId);

        case "platform.listAgents":
          return await executeListAgents(args, context, toolCallId);

        case "platform.getAgentProfile":
          return await executeGetAgentProfile(args, toolCallId);

        case "platform.listRecentTurns":
          return await executeListRecentTurns(args, context, toolCallId);

        case "platform.getSystemStatus":
          return await executeGetSystemStatus(toolCallId);

        default:
          return {
            toolCallId,
            result: { error: `Unknown platform tool: ${name}` },
            isError: true,
          };
      }
    } catch (err) {
      return {
        toolCallId,
        result: { error: err instanceof Error ? err.message : String(err) },
        isError: true,
      };
    }
  };

  // ---- Individual tool implementations ----

  async function executeGetSpaceStatus(
    args: Record<string, unknown>,
    context: PlatformToolExecutionContext,
    toolCallId: string,
  ): Promise<ToolResult> {
    const spaceId = typeof args.spaceId === "string" ? args.spaceId : context.spaceId;
    const space = await spaceAdminService.getSpace(spaceId);

    if (!space) {
      return { toolCallId, result: { error: `Space not found: ${spaceId}` }, isError: true };
    }

    const turnCount = turnRepo?.countBySpace(spaceId) ?? null;

    return {
      toolCallId,
      result: {
        spaceId: space.id,
        name: space.name,
        goal: space.goal ?? null,
        status: inferSpaceState(space),
        turnModel: space.turnModel,
        turnModelConfig: space.turnModelConfig ?? null,
        agentCount: space.agents.length,
        agents: space.agents.map((a) => ({
          agentId: a.agentId,
          profileId: a.profileId,
          role: a.role,
          isPrimary: a.isPrimary,
        })),
        capabilities: space.capabilities,
        visibility: space.visibility,
        turnCount,
        createdAt: space.createdAt.toISOString(),
        updatedAt: space.updatedAt.toISOString(),
      },
    };
  }

  async function executeListSpaces(
    args: Record<string, unknown>,
    toolCallId: string,
  ): Promise<ToolResult> {
    const rawStatuses = Array.isArray(args.statuses) ? args.statuses.filter((s): s is string => typeof s === "string") : undefined;
    const limit = typeof args.limit === "number" ? Math.min(Math.max(1, args.limit), 100) : 20;

    const spaces = await spaceAdminService.listSpaces({
      statuses: rawStatuses as import("../spaces/types.js").SpaceState[] | undefined,
      limit,
    });

    return {
      toolCallId,
      result: {
        totalReturned: spaces.length,
        spaces: spaces.map((s) => ({
          spaceId: s.id,
          name: s.name,
          status: inferSpaceState(s),
          turnModel: s.turnModel,
          agentCount: s.agents.length,
          createdAt: s.createdAt.toISOString(),
        })),
      },
    };
  }

  async function executeListAgents(
    args: Record<string, unknown>,
    context: PlatformToolExecutionContext,
    toolCallId: string,
  ): Promise<ToolResult> {
    const spaceId = typeof args.spaceId === "string" ? args.spaceId : context.spaceId;
    const assignments = await spaceAdminService.listAgentAssignments(spaceId);

    const agents = assignments.map((a) => {
      const profile = profileRepo?.getById(a.profileId);
      return {
        agentId: a.agentId,
        profileId: a.profileId,
        profileName: profile?.name ?? null,
        role: a.role,
        turnOrder: a.turnOrder,
        isPrimary: a.isPrimary,
        assignedAt: a.assignedAt.toISOString(),
      };
    });

    return {
      toolCallId,
      result: { spaceId, agents },
    };
  }

  async function executeGetAgentProfile(
    args: Record<string, unknown>,
    toolCallId: string,
  ): Promise<ToolResult> {
    const profileId = typeof args.profileId === "string" ? args.profileId : "";
    if (!profileId) {
      return { toolCallId, result: { error: "profileId is required" }, isError: true };
    }

    if (!profileRepo) {
      return { toolCallId, result: { error: "Profile repository not available" }, isError: true };
    }

    const profile = profileRepo.getById(profileId);
    if (!profile) {
      return { toolCallId, result: { error: `Profile not found: ${profileId}` }, isError: true };
    }

    const revision = profileRepo.getActiveRevision(profileId);

    return {
      toolCallId,
      result: {
        profileId: profile.profile_id,
        name: profile.name,
        description: profile.description,
        canModerate: profile.can_moderate === 1,
        isDefault: profile.is_default === 1,
        activeRevision: profile.active_revision,
        archived: profile.archived === 1,
        modelHint: revision?.model_hint ?? null,
        providerHint: revision?.provider_hint ?? null,
        defaultSkillIds: revision ? safeParseJson(revision.default_skill_set_ids_json, []) : [],
        createdAt: profile.created_at,
        updatedAt: profile.updated_at,
      },
    };
  }

  async function executeListRecentTurns(
    args: Record<string, unknown>,
    context: PlatformToolExecutionContext,
    toolCallId: string,
  ): Promise<ToolResult> {
    const spaceId = typeof args.spaceId === "string" ? args.spaceId : context.spaceId;
    const limit = typeof args.limit === "number" ? Math.min(Math.max(1, args.limit), 50) : 10;

    if (!turnRepo) {
      return { toolCallId, result: { error: "Turn repository not available" }, isError: true };
    }

    const rows = turnRepo.listBySpace(spaceId, limit);

    const turns = rows.map((row) => ({
      turnId: row.turn_id,
      actorType: row.actor_type,
      actorId: row.actor_id,
      status: row.status,
      inputPreview: truncateContent(row.input_json),
      outputPreview: truncateContent(row.output_json),
      tokenInput: row.token_input_count,
      tokenOutput: row.token_output_count,
      createdAt: row.created_at,
      completedAt: row.completed_at,
    }));

    return {
      toolCallId,
      result: { spaceId, totalReturned: turns.length, turns },
    };
  }

  async function executeGetSystemStatus(
    toolCallId: string,
  ): Promise<ToolResult> {
    const capabilities = capabilityRegistry.getAvailableCapabilities();
    const spaces = await spaceAdminService.listSpaces({ statuses: ["active"] });

    const uptimeMs = startedAt ? Date.now() - startedAt.getTime() : null;

    return {
      toolCallId,
      result: {
        uptimeMs,
        uptimeHuman: uptimeMs !== null ? formatUptime(uptimeMs) : null,
        activeSpaceCount: spaces.length,
        registeredCapabilities: capabilities,
      },
    };
  }
}

// ---------------------------------------------------------------------------
// Role-gating filter
// ---------------------------------------------------------------------------

const PLATFORM_TOOL_ALLOWED_ROLES = new Set(["global_coordinator", "space_moderator"]);

/**
 * Create a filter function that checks if an agent is allowed to use platform tools.
 * Only agents with coordinator or moderator roles get access.
 */
export function createPlatformToolFilter(
  spaceAdminService: SpaceAdminService,
): (spaceId: string, agentId: string) => Promise<boolean> {
  return async (spaceId: string, agentId: string): Promise<boolean> => {
    try {
      const assignments = await spaceAdminService.listAgentAssignments(spaceId);
      const assignment = assignments.find((a) => a.agentId === agentId);
      return assignment ? PLATFORM_TOOL_ALLOWED_ROLES.has(assignment.role) : false;
    } catch {
      return false;
    }
  };
}

/**
 * Check if a tool name is a platform tool.
 */
export function isPlatformTool(toolName: string): boolean {
  return toolName.startsWith(PLATFORM_TOOL_PREFIX);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function inferSpaceState(space: { agents: unknown[] }): string {
  // SpaceConfig doesn't persist state directly — infer from presence of agents/turns
  // The space status field was removed; use "active" if agents are present
  return (space as Record<string, unknown>).status as string ?? "active";
}

function truncateContent(jsonStr: string | null): string | null {
  if (!jsonStr) return null;
  try {
    const parsed = JSON.parse(jsonStr);
    const text = typeof parsed === "string"
      ? parsed
      : typeof parsed.text === "string"
        ? parsed.text
        : typeof parsed.content === "string"
          ? parsed.content
          : JSON.stringify(parsed);
    return text.length > MAX_TURN_CONTENT_PREVIEW
      ? text.slice(0, MAX_TURN_CONTENT_PREVIEW) + "..."
      : text;
  } catch {
    return jsonStr.length > MAX_TURN_CONTENT_PREVIEW
      ? jsonStr.slice(0, MAX_TURN_CONTENT_PREVIEW) + "..."
      : jsonStr;
  }
}

function safeParseJson<T>(jsonStr: string, fallback: T): T {
  try {
    return JSON.parse(jsonStr) as T;
  } catch {
    return fallback;
  }
}

function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}
