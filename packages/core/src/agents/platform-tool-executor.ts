import type { ToolResult } from "./model-provider.js";
import {
  buildSpaceDigestFallback,
  extractTextPreview,
  firstPreferredModelFromProfileConfig,
  formatUptime,
  inferSpaceState,
  normalizeExperienceStatus,
  normalizeOptionalInteger,
  normalizeOptionalNumber,
  normalizeOptionalString,
  normalizeTopology,
  safeParseJson,
  truncateContent,
} from "./platform-tool-helpers.js";
import type { PlatformToolConfig, PlatformToolExecutionContext } from "./platform-tool-types.js";

export function createPlatformToolExecutor(
  config: PlatformToolConfig,
): (name: string, args: Record<string, unknown>, context: PlatformToolExecutionContext) => Promise<ToolResult> {
  const {
    spaceAdminService,
    capabilityRegistry,
    taskOrchestrationService,
    memoryProvider,
    gatewayProfile = "embedded",
    turnRepo,
    profileRepo,
    startedAt,
    reflectionService,
  } = config;

  return async (name: string, args: Record<string, unknown>, context: PlatformToolExecutionContext): Promise<ToolResult> => {
    const toolCallId = `${name}:${context.turnId}`;

    try {
      switch (name) {
        case "platform.orchestrateTask":
          return await executeOrchestrateTask(args, context, toolCallId);
        case "platform.getTaskProgress":
          return await executeGetTaskProgress(args, context, toolCallId);
        case "platform.searchExperiences":
          return await executeSearchExperiences(args, context, toolCallId);
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
        case "platform.getSpaceDigest":
          return await executeGetSpaceDigest(args, context, toolCallId);
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

  async function executeOrchestrateTask(
    args: Record<string, unknown>,
    context: PlatformToolExecutionContext,
    toolCallId: string,
  ): Promise<ToolResult> {
    if (!taskOrchestrationService) {
      return {
        toolCallId,
        result: {
          error: {
            code: "task_orchestration_unavailable",
            message: "Task orchestration requires a configured model provider. Set up a provider in gateway settings.",
          },
        },
        isError: true,
      };
    }
    const principalId = normalizeOptionalString(context.principalId);
    if (!principalId) {
      return { toolCallId, result: { error: "principalId is required" }, isError: true };
    }
    if (context.executionOrigin === "system") {
      return {
        toolCallId,
        result: {
          error: "Nested task orchestration is not permitted. Complete your assigned task directly.",
        },
        isError: true,
      };
    }
    const taskDescription = normalizeOptionalString(args.taskDescription);
    if (!taskDescription) {
      return { toolCallId, result: { error: "taskDescription is required" }, isError: true };
    }

    const result = await taskOrchestrationService.orchestrate({
      taskDescription,
      requestedBy: principalId,
      templateHint: normalizeOptionalString(args.templateHint),
      templateId: normalizeOptionalString(args.templateId),
      agentCount: normalizeOptionalInteger(args.agentCount),
      agentTier: normalizeOptionalString(args.agentTier),
      topology: normalizeTopology(args.topology),
      spaceId: normalizeOptionalString(args.spaceId),
      maxTurns: normalizeOptionalInteger(args.maxTurns),
    });
    return { toolCallId, result };
  }

  async function executeGetTaskProgress(
    args: Record<string, unknown>,
    context: PlatformToolExecutionContext,
    toolCallId: string,
  ): Promise<ToolResult> {
    if (!taskOrchestrationService?.getTaskProgress) {
      return { toolCallId, result: { error: "Task orchestration service not available" }, isError: true };
    }
    const principalId = normalizeOptionalString(context.principalId);
    if (!principalId) {
      return { toolCallId, result: { error: "principalId is required" }, isError: true };
    }
    const taskId = normalizeOptionalString(args.taskId);
    if (!taskId) {
      return { toolCallId, result: { error: "taskId is required" }, isError: true };
    }
    const result = taskOrchestrationService.getTaskProgress(taskId, principalId);
    if (!result) {
      return { toolCallId, result: { error: `Task not found: ${taskId}` }, isError: true };
    }
    return { toolCallId, result };
  }

  async function executeSearchExperiences(
    args: Record<string, unknown>,
    context: PlatformToolExecutionContext,
    toolCallId: string,
  ): Promise<ToolResult> {
    if (!memoryProvider) {
      return { toolCallId, result: { error: "Memory provider not available" }, isError: true };
    }
    const query = normalizeOptionalString(args.query);
    if (!query) {
      return { toolCallId, result: { error: "query is required" }, isError: true };
    }
    const principalId = normalizeOptionalString(context.principalId);
    if (gatewayProfile === "external" && !principalId) {
      return { toolCallId, result: { error: "principalId is required" }, isError: true };
    }
    const result = await memoryProvider.search({
      text: query,
      status: normalizeExperienceStatus(args.status) ?? "accepted",
      minScore: normalizeOptionalNumber(args.minScore),
      limit: normalizeOptionalInteger(args.limit),
      scope: gatewayProfile === "embedded" ? {} : { userId: principalId },
    });
    return { toolCallId, result };
  }

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
    const modelId = revision
      ? firstPreferredModelFromProfileConfig(revision.model_config_json)
      : null;

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
        modelId,
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

  async function executeGetSystemStatus(toolCallId: string): Promise<ToolResult> {
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

  async function executeGetSpaceDigest(
    args: Record<string, unknown>,
    context: PlatformToolExecutionContext,
    toolCallId: string,
  ): Promise<ToolResult> {
    const spaceId = typeof args.spaceId === "string" ? args.spaceId : context.spaceId;
    const limit = typeof args.limit === "number"
      ? Math.min(Math.max(1, args.limit), 10)
      : 3;
    const space = await spaceAdminService.getSpace(spaceId);
    if (!space) {
      return { toolCallId, result: { error: `Space not found: ${spaceId}` }, isError: true };
    }
    if (!turnRepo) {
      return { toolCallId, result: { error: "Turn repository not available" }, isError: true };
    }
    const turns = turnRepo.listBySpace(spaceId, limit).map((turn) => ({
      agentId: turn.actor_id,
      status: turn.status,
      output: extractTextPreview(turn.output_json),
      createdAt: turn.created_at,
    }));
    const digest = await reflectionService?.runSummaryJob({
      kind: "space_digest",
      spaceId: space.id,
      spaceName: space.name,
      goal: space.goal ?? undefined,
      activeAgents: space.agents.length,
      turns,
      pendingActions: [],
    });

    return {
      toolCallId,
      result: {
        spaceId: space.id,
        summary: digest?.summaryText ?? buildSpaceDigestFallback(space.name, turns),
        activeAgents: space.agents.length,
        lastTurnAt: turns[0]?.createdAt ?? null,
        pendingActions: [],
        trace: digest?.trace ?? null,
      },
    };
  }
}
