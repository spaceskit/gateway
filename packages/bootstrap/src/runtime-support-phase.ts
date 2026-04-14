import {
  AgentVersionManager,
  ConfigHotReloader,
  DefaultNotificationService,
  DefaultToolExecutor,
  ExperienceMemoryProvider,
  LettaProvider,
  Mem0Provider,
  MemoryProviderRegistry,
  ModelRouter,
  PluginSystem,
  SessionContinuityManager,
  SQLiteCheckpointManager,
  SQLiteDeadLetterQueue,
  createPlatformToolDefinitions,
  createConciergeEscalationToolDefinitions,
  createConciergeEscalationToolExecutor,
  createConciergeEscalationToolFilter,
  createPlatformToolExecutor,
  createPlatformToolFilter,
  DEFAULT_AGENT_SCOPE,
  isConciergeEscalationTool,
  isPlatformTool,
  type AgentSecurityScope,
  type ConfigChangeEvent,
} from "@spaceskit/core";
import type { BootstrapState } from "./bootstrap-state.js";
import { ConciergeEscalationService } from "./services/concierge-escalation-service.js";
import {
  extractFilesystemScopes,
  fileUriToFilesystemPath,
  firstPreferredModelFromConfig,
  uniqueStrings,
} from "./turn-helpers.js";

export async function initializeRuntimeSupport(state: BootstrapState): Promise<void> {
  const { config, logger, db, eventBus, capabilities, executionAdapterFactory } = state;

  const memoryRegistry = new MemoryProviderRegistry();
  if (db) {
    const experienceMemory = new ExperienceMemoryProvider({ db: db.db });
    memoryRegistry.register(experienceMemory);
    memoryRegistry.setDefault(experienceMemory.id);
    logger.info("Memory provider registered: ExperienceMemory (default)");
  }

  if (config.mem0ApiKey) {
    try {
      const mem0 = new Mem0Provider({ apiKey: config.mem0ApiKey });
      await mem0.initialize();
      memoryRegistry.register(mem0);
      logger.info("Memory provider registered: Mem0");
    } catch (error) {
      logger.warn("Mem0 provider failed to initialize — skipping", error as Record<string, unknown>);
    }
  }

  if (config.lettaBaseUrl) {
    try {
      const letta = new LettaProvider({
        baseURL: config.lettaBaseUrl,
        apiKey: config.lettaApiKey,
      });
      await letta.initialize();
      memoryRegistry.register(letta);
      logger.info("Memory provider registered: Letta");
    } catch (error) {
      logger.warn("Letta provider failed to initialize — skipping", error as Record<string, unknown>);
    }
  }

  const notificationService = new DefaultNotificationService({ eventBus });
  logger.info("Notification service initialized");
  const conciergeEscalationService = state.conciergeEscalationRequestRepo
    ? new ConciergeEscalationService({
      repository: state.conciergeEscalationRequestRepo,
      notificationService,
      eventBus,
      logger: logger.child({ module: "concierge-escalation" }),
    })
    : null;

  const checkpointManager = db ? new SQLiteCheckpointManager(db.db) : null;
  if (checkpointManager) {
    logger.info("Checkpoint manager initialized");
  }

  const sessionContinuityManager = new SessionContinuityManager({
    checkpointManager: checkpointManager ?? undefined,
  });
  logger.info("Session continuity manager initialized");

  const deadLetterQueue = db ? new SQLiteDeadLetterQueue(db.db) : null;
  if (deadLetterQueue) {
    logger.info("Dead letter queue initialized");
  }

  const platformToolDefinitions = createPlatformToolDefinitions();
  const conciergeToolDefinitions = conciergeEscalationService
    ? createConciergeEscalationToolDefinitions()
    : [];
  const gatewayStartedAt = new Date();
  const conciergeToolExecutor = conciergeEscalationService
    ? createConciergeEscalationToolExecutor({
      service: conciergeEscalationService,
    })
    : null;
  const platformToolFilter = createPlatformToolFilter(state.spaceAdminService);
  const conciergeToolFilter = createConciergeEscalationToolFilter({
    spaceAdminService: state.spaceAdminService,
    profileRepo: state.profileRepo ?? null,
  });
  const toolExecutor = new DefaultToolExecutor({
    capabilityRegistry: capabilities,
    eventBus,
    middleware: state.middleware,
    injectedToolDefinitions: [...platformToolDefinitions, ...conciergeToolDefinitions],
    injectedToolExecutor: async (name, args, ctx) => {
      if (isPlatformTool(name)) {
        const executor = createPlatformToolExecutor({
          spaceAdminService: state.spaceAdminService,
          capabilityRegistry: capabilities,
          gatewayProfile: config.gatewayProfile,
          memoryProvider: (memoryRegistry.getDefault() as any) ?? null,
          turnRepo: state.turnRepo ?? null,
          profileRepo: state.profileRepo ?? null,
          startedAt: gatewayStartedAt,
          reflectionService: state.reflectionService ?? null,
        });
        return executor(name, args, ctx);
      }
      if (isConciergeEscalationTool(name) && conciergeToolExecutor) {
        return conciergeToolExecutor(name, args, ctx);
      }
      return {
        toolCallId: `${name}:${ctx.turnId}`,
        result: { error: `Unsupported injected tool: ${name}` },
        isError: true,
      };
    },
    injectedToolFilter: async (spaceId, agentId, toolName) => {
      if (toolName && isPlatformTool(toolName)) {
        return platformToolFilter(spaceId, agentId);
      }
      if (toolName && isConciergeEscalationTool(toolName)) {
        return conciergeToolFilter(spaceId, agentId);
      }
      const [platformAllowed, conciergeAllowed] = await Promise.all([
        platformToolFilter(spaceId, agentId),
        conciergeToolFilter(spaceId, agentId),
      ]);
      return platformAllowed || conciergeAllowed;
    },
    evaluateInjectedToolAccess: async (input) => {
      if (!state.toolAccessPolicyService) {
        return { allowed: true };
      }
      return state.toolAccessPolicyService.evaluateInjectedToolAccess({
        spaceId: input.spaceId,
        agentId: input.agentId,
        principalId: input.principalId,
        deviceId: input.deviceId,
        toolName: input.toolName,
      });
    },
    evaluateToolAccess: async (input) => {
      if (!state.toolAccessPolicyService) {
        return { allowed: true };
      }
      const decision = await state.toolAccessPolicyService.evaluateToolAccess(input);
      if (input.capability === "shell") {
        const source = classifyShellDecisionSource(decision.reasonCode, decision.requiresApproval === true);
        if (source) {
          logger.warn("Shell tool access requires operator attention", {
            spaceId: input.spaceId,
            agentId: input.agentId,
            principalId: input.principalId,
            deviceId: input.deviceId,
            operation: input.operation,
            executionOrigin: input.executionOrigin,
            accessMode: input.accessMode,
            reasonCode: decision.reasonCode,
            reason: decision.reason,
            source,
          });
        }
      }
      return decision;
    },
    getApprovableCliTools: () => {
      // On embedded profile, CLI tools are hard-blocked but can be approved.
      // Include them in the tool list so the agent can attempt to call them.
      if (config.gatewayProfile !== "embedded") return [];
      const adminService = state.gatewayAdminService;
      if (!adminService) return [];
      try {
        const cliTools = adminService.listTools();
        return cliTools
          .filter((tool: any) => tool.available)
          .map((tool: any) => ({
            name: `shell.${tool.id}`,
            description: tool.description || tool.displayName,
            inputSchema: tool.inputSchema ?? { type: "object", properties: {} },
          }));
      } catch {
        return [];
      }
    },
    onPermissionDenied: (context, permission) => {
      state.toolAccessPolicyService?.recordBlockedToolInvocation({
        spaceId: context.spaceId,
        agentId: context.agentId,
        toolName: permission.toolName,
        reasonCode: permission.reasonCode ?? "permission_denied",
        reason: permission.reason ?? "Permission denied",
        principalId: context.principalId,
        deviceId: context.deviceId,
      });
    },
    resolveSecurityScope: async (spaceId: string, agentId: string): Promise<AgentSecurityScope> => {
      const space = await state.spaceAdminService.getSpace(spaceId);
      const assignment = space?.agents.find((entry: any) => entry.agentId === agentId);
      const assignmentScope = assignment?.securityScope;
      const allowedCapabilities = mergeAllowedCapabilities(
        space?.capabilities ?? [],
        assignmentScope?.allowedCapabilities ?? [],
      );
      const workspace = state.spaceWorkspaceService
        ? await state.spaceWorkspaceService.ensureWorkspace(spaceId).catch(() => null)
        : null;
      const resources = await state.spaceAdminService.listResources(spaceId).catch(() => []);
      const resourceFolderScopes = resources
        .filter((resource: any) => resource.type === "folder")
        .map((resource: any) => fileUriToFilesystemPath(resource.uri))
        .filter((value: any): value is string => Boolean(value));
      const mergedFilesystemScopes = uniqueStrings([
        ...extractFilesystemScopes(assignmentScope),
        ...resourceFolderScopes,
        ...(workspace ? [workspace.effectiveWorkspaceRoot] : []),
      ]);

      return {
        ...DEFAULT_AGENT_SCOPE,
        ...assignmentScope,
        agentId,
        allowedCapabilities,
        commandAllowlist: uniqueStrings(assignmentScope?.commandAllowlist ?? []),
        filesystemScope: mergedFilesystemScopes[0]
          ?? assignmentScope?.filesystemScope
          ?? DEFAULT_AGENT_SCOPE.filesystemScope,
        ...(mergedFilesystemScopes.length > 0 ? { filesystemScopes: mergedFilesystemScopes } : {}),
      };
    },
  });

  let modelRouter: ModelRouter | null = null;
  if (config.modelProvider && config.defaultModelId) {
    try {
      const modelProvider = executionAdapterFactory.createModelProvider({
        providerId: config.modelProvider,
        model: config.defaultModelId,
        apiKey: config.apiKey,
        allowUnsafeHostBypass: config.sandboxAllowHostPassthrough,
      });
      modelRouter = new ModelRouter(modelProvider, config.defaultModelId);
      logger.info("Model router initialized", {
        provider: config.modelProvider,
        model: config.defaultModelId,
      });
    } catch (error) {
      logger.warn(
        "Model provider initialization failed — turn execution will require manual setup",
        error as Record<string, unknown>,
      );
    }
  }

  const pluginSystem = new PluginSystem({
    eventBus,
    capabilityRegistry: capabilities,
    maxPluginTimeoutMs: 30_000,
  });
  logger.info("Plugin system initialized");

  const agentVersionManager = new AgentVersionManager({
    eventBus,
    loadRevision: async (profileId: string, revision: number) => {
      if (!state.profileRepo || !state.db) return null;
      const row = state.db.db.prepare(`
        SELECT * FROM agent_profile_revisions WHERE profile_id = ? AND revision = ?
      `).get(profileId, revision) as {
        profile_id: string;
        revision: number;
        personality_prompt?: string;
        default_skill_set_ids_json?: string;
        provider_hint?: string;
        model_hint?: string;
        model_config_json?: string;
        source?: string;
      } | null;
      if (!row) return null;

      const loadSkillIds = (): string[] => {
        try {
          const parsed = JSON.parse(row.default_skill_set_ids_json ?? "[]");
          return Array.isArray(parsed) ? parsed : [];
        } catch {
          return [];
        }
      };

      return {
        profileId: row.profile_id,
        revision: row.revision,
        personalityPrompt: row.personality_prompt ?? "",
        defaultSkillIds: state.gatewayPolicyService
          ? state.gatewayPolicyService.filterSkillIds(loadSkillIds())
          : loadSkillIds(),
        providerHint: row.provider_hint ?? "",
        modelHint: firstPreferredModelFromConfig(row.model_config_json) ?? row.model_hint ?? "",
        source: row.source ?? "manual",
        resolvedAt: new Date(),
      };
    },
    loadActiveRevision: async (profileId: string) => {
      if (!state.profileRepo) return null;
      const revision = state.profileRepo.getActiveRevision(profileId);
      if (!revision) return null;

      const loadSkillIds = (): string[] => {
        try {
          const parsed = JSON.parse(revision.default_skill_set_ids_json ?? "[]");
          return Array.isArray(parsed) ? parsed : [];
        } catch {
          return [];
        }
      };

      return {
        profileId: revision.profile_id,
        revision: revision.revision,
        personalityPrompt: revision.personality_prompt ?? "",
        defaultSkillIds: state.gatewayPolicyService
          ? state.gatewayPolicyService.filterSkillIds(loadSkillIds())
          : loadSkillIds(),
        providerHint: revision.provider_hint ?? "",
        modelHint: firstPreferredModelFromConfig(revision.model_config_json) ?? revision.model_hint ?? "",
        source: revision.source ?? "manual",
        resolvedAt: new Date(),
      };
    },
  });
  logger.info("Agent version manager initialized");

  let configReloader: ConfigHotReloader<any> | null = null;
  const configFilePath = Bun.env.SPACESKIT_CONFIG_FILE;
  if (configFilePath) {
    configReloader = new ConfigHotReloader({
      initialConfig: config,
      eventBus,
      file: {
        path: configFilePath,
        pollInterval: parseInt(Bun.env.SPACESKIT_CONFIG_POLL_MS ?? "5000", 10),
      },
      signal: { enabled: true, filePath: configFilePath },
    });

    configReloader.onConfigChange((event: ConfigChangeEvent<any>) => {
      logger.info("Configuration reloaded", { mode: event.mode });
      if (config.enableResilience && event.newValue.requestsPerMinute !== config.requestsPerMinute) {
        logger.info("Rate limit updated", { newLimit: event.newValue.requestsPerMinute });
      }
    });

    await configReloader.start();
    logger.info("Config hot-reload enabled", { path: configFilePath });
  }

  Object.assign(state, {
    agentVersionManager,
    checkpointManager,
    configReloader,
    deadLetterQueue,
    gatewayStartedAt,
    memoryRegistry,
    modelRouter,
    notificationService,
    conciergeEscalationService,
    pluginSystem,
    sessionContinuityManager,
    toolExecutor,
  });
}

function classifyShellDecisionSource(
  reasonCode: string | undefined,
  requiresApproval: boolean,
): "gateway_profile" | "dangerous_capability_policy" | "missing_approval_grant" | null {
  if (requiresApproval || reasonCode === "policy_escalation_required" || reasonCode === "gateway_capability_not_granted") {
    return "missing_approval_grant";
  }
  if (reasonCode === "dangerous_access_requires_owner_full_access") {
    return "dangerous_capability_policy";
  }
  if (
    reasonCode === "gateway_capability_blocked"
    || reasonCode === "gateway_disabled"
    || reasonCode === "gateway_capability_denied"
    || reasonCode === "guest_access_preset_denied"
  ) {
    return "gateway_profile";
  }
  return null;
}

function mergeAllowedCapabilities(
  spaceCapabilities: string[],
  assignmentCapabilities: string[],
): string[] {
  const normalizedSpace = uniqueStrings(spaceCapabilities);
  const normalizedAssignment = uniqueStrings(assignmentCapabilities);
  if (normalizedSpace.length > 0 && normalizedAssignment.length > 0) {
    return normalizedAssignment.filter((capability) => normalizedSpace.includes(capability));
  }
  if (normalizedAssignment.length > 0) {
    return normalizedAssignment;
  }
  if (normalizedSpace.length > 0) {
    return normalizedSpace;
  }
  return [];
}
