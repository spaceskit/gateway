import {
  capabilityRequestFromInvocation,
  createGatewayCoreState,
  evaluateCapabilityRequest,
  grantCapability,
} from "@spaceskit/gateway-core";
import type { BootstrapState } from "./bootstrap-state.js";
import { parseBooleanEnv, parseOptionalNumberEnv, parseVoiceSourceEnv } from "./config.js";
import {
  ensureConciergeDefaults,
  ensureMainDefaults,
  ensureMainSpaceSystemSkills,
  repairProfilePersonaAssignments,
  resolveMainProfileRuntimeSelection,
} from "./main-defaults.js";
import { seedRuntimeDocsKnowledgeBase } from "./seed/runtime-docs-knowledge-base.js";
import { GatewayCapabilityAccessService } from "./services/gateway-capability-access-service.js";
import { DEFAULT_PERSONA_ID, GatewayIdentityService } from "./services/gateway-identity-service.js";
import { GatewayObservabilityService } from "./services/gateway-observability-service.js";
import { DefaultGatewayPolicyService } from "./services/gateway-policy-service.js";
import { GatewayLibraryService } from "./services/gateway-library-service.js";
import { GatewaySkillCatalogService } from "./services/gateway-skill-catalog-service.js";
import { KnowledgeBaseService } from "./services/knowledge-base-service.js";
import { LocalUsageTelemetryService } from "./services/local-usage-telemetry-service.js";
import { createSandboxExecutionBackend } from "./services/sandbox-execution-backend.js";
import { ToolAccessPolicyService } from "./services/tool-access-policy-service.js";
import { UsageSnapshotService } from "./services/usage-snapshot-service.js";
import {
  parseVoiceUsagePolicyFromGlobalFlags,
  VoiceUsageLockService,
} from "./services/voice-usage-lock-service.js";
import { VoiceRoutingService } from "./services/voice-routing-service.js";
import {
  evaluateSandboxSlo,
  resolveCapabilityExecutionRoute,
} from "./turn-helpers.js";

export async function initializePolicyRuntimeServices(state: BootstrapState): Promise<void> {
  const { config, logger, db } = state;

  const gatewayPolicyService = state.gatewayPolicyRepo
    ? new DefaultGatewayPolicyService(state.gatewayPolicyRepo)
    : null;
  const gatewaySkillCatalogService = state.gatewaySkillCatalogRepo
    ? new GatewaySkillCatalogService({ repository: state.gatewaySkillCatalogRepo })
    : null;
  const gatewayLibraryService = state.gatewaySkillCatalogRepo
    ? new GatewayLibraryService({
      repository: state.gatewaySkillCatalogRepo,
      linkedRepository: state.gatewayLinkedSkillIndexRepo ?? null,
      drafts: state.skillDraftRepo ?? null,
      workspaceRoot: config.spacesRoot,
    })
    : null;
  let gatewayIdentityService: GatewayIdentityService | null = null;
  if (state.profileRepo && state.personaRepo) {
    gatewayIdentityService = new GatewayIdentityService({
      profiles: state.profileRepo,
      personas: state.personaRepo,
      getActiveSkillMarkdownMap: gatewayLibraryService
        ? (skillIds: string[]) => gatewayLibraryService.getActiveSkillMarkdownMap(skillIds)
        : gatewaySkillCatalogService
          ? (skillIds: string[]) => gatewaySkillCatalogService.getActiveSkillMarkdownMap(skillIds)
          : undefined,
      defaultPersonaId: DEFAULT_PERSONA_ID,
      previewSystemPromptMatrix: async (input) => {
        const runtime = gatewayIdentityService!.loadAgentDefinitionRuntime(input.agentDefinitionId);
        if (!runtime) {
          throw { code: "NOT_FOUND", message: `Agent Definition not found: ${input.agentDefinitionId}` };
        }
        const compiled = gatewayIdentityService!.previewCompiledInstructions({
          agentDefinitionId: input.agentDefinitionId,
        });
        const compiledText = compiled.preview.compiledText;
        const budgetClasses = ["full", "compact", "minimal", "cli"] as const;
        const variants = budgetClasses.map((budgetClass) => ({
          budgetClass,
          label: budgetClass.charAt(0).toUpperCase() + budgetClass.slice(1),
          tokenEstimate: Math.ceil(compiledText.length / 4),
          sections: compiled.preview.sections,
          compiledText,
        }));
        return {
          matrix: {
            agentDefinitionId: runtime.agentDefinitionId,
            personaId: runtime.personaId,
            generatedAt: new Date().toISOString(),
            variants,
          },
        };
      },
      previewRuntimeSystemPrompt: async (input) => {
        const resolvedProfileId = input.profileId ?? config.mainProfileId;
        const runtime = gatewayIdentityService!.loadAgentDefinitionRuntime(resolvedProfileId);
        if (!runtime) {
          throw { code: "NOT_FOUND", message: `Agent Definition not found: ${resolvedProfileId}` };
        }
        const compiled = gatewayIdentityService!.previewCompiledInstructions({
          agentDefinitionId: resolvedProfileId,
        });
        type RuntimeSectionKey = "agent_definition" | "persona" | "active_skill_context" | "workspace_context" | "conversation_prompt" | "assignment_context";
        return {
          preview: {
            spaceId: input.spaceId,
            agentId: input.agentId,
            profileId: resolvedProfileId,
            personaId: runtime.personaId,
            targetKind: "space_profile" as const,
            sections: compiled.preview.sections.map((section: { key: string; title: string; content: string }) => ({
              key: section.key as RuntimeSectionKey,
              title: section.title,
              content: section.content,
            })),
            compiledText: compiled.preview.compiledText,
            generatedAt: new Date().toISOString(),
          },
        };
      },
    });
  }

  let defaultPersonaId = DEFAULT_PERSONA_ID;
  if (gatewayIdentityService) {
    const defaultPersona = gatewayIdentityService.ensureDefaultPersona();
    defaultPersonaId = defaultPersona.personaId;
    const repairedAssignments = repairProfilePersonaAssignments(db, defaultPersonaId);
    if (repairedAssignments > 0) {
      logger.warn("Repaired agent profile persona assignments", {
        repairedAssignments,
        defaultPersonaId,
      });
    }
  }

  const knowledgeBaseService = state.knowledgeBaseRepo
    ? new KnowledgeBaseService({ repository: state.knowledgeBaseRepo })
    : null;
  if (knowledgeBaseService) {
    seedRuntimeDocsKnowledgeBase(knowledgeBaseService);
  }

  const gatewayCapabilityAccessService = state.gatewayCapabilityGrantRepo
    ? new GatewayCapabilityAccessService({
      repository: state.gatewayCapabilityGrantRepo,
      profileId: config.gatewayProfile,
    })
    : null;

  if (gatewayCapabilityAccessService) {
    const seeded = gatewayCapabilityAccessService.seedStartupGrants(config.gatewayCapabilityGrants);
    state.appliedCapabilityGrants = seeded.applied;
    state.skippedCapabilityGrants = seeded.skipped;
    state.invalidCapabilityGrants = seeded.invalid;
  } else {
    let gatewayCoreState = state.gatewayCoreState ?? createGatewayCoreState({ profileId: config.gatewayProfile });
    for (const grant of state.configuredGrants.grants) {
      try {
        gatewayCoreState = grantCapability(gatewayCoreState, grant);
        state.appliedCapabilityGrants.push(grant.capabilityId);
      } catch {
        state.skippedCapabilityGrants.push(grant.capabilityId);
      }
    }
    state.gatewayCoreState = gatewayCoreState;
  }

  const toolAccessPolicyService = (
    state.toolAccessPolicyRepo
    && state.safetyProfileRepo
    && state.accessGrantRepo
  )
    ? new ToolAccessPolicyService({
      capabilities: state.capabilities,
      spaceAdminService: state.spaceAdminService,
      toolPolicies: state.toolAccessPolicyRepo,
      safetyProfiles: state.safetyProfileRepo,
      accessGrants: state.accessGrantRepo,
      gatewayCapabilityAccessService: gatewayCapabilityAccessService ?? undefined,
      gatewayProfileId: config.gatewayProfile,
      legacySpaceToolPolicies: state.spaceToolPolicyRepo ?? undefined,
      legacyGatewayPolicyService: gatewayPolicyService ?? undefined,
      legacyConnectorPolicies: state.connectorPolicyRepo ?? undefined,
      spaceSharingService: state.spaceSharingService ?? undefined,
      cliToolService: state.cliToolService ?? undefined,
      auditRepo: state.auditEventsRepo ?? undefined,
    })
    : null;

  if (state.invalidCapabilityGrants.length > 0) {
    logger.warn("Ignoring invalid startup capability grants", {
      invalidCapabilityGrants: state.invalidCapabilityGrants,
      expectedSuffixes: [".read", ".write", ".execute"],
    });
  }
  if (state.skippedCapabilityGrants.length > 0) {
    logger.warn("Skipping startup grants blocked by current gateway profile", {
      skippedCapabilityGrants: state.skippedCapabilityGrants,
      gatewayProfile: config.gatewayProfile,
    });
  }

  logger.info("Gateway core profile loaded", {
    profile: state.gatewayCoreState.profile.id,
    appStoreCompatible: state.gatewayCoreState.profile.appStoreCompatible,
    sandboxRequired: state.gatewayCoreState.profile.sandboxRequired,
    defaultAction: state.gatewayCoreState.defaultAction,
    hardBlockedCapabilities: state.gatewayCoreState.profile.hardBlockedCapabilities,
    appliedCapabilityGrants: state.appliedCapabilityGrants,
  });

  const voiceRoutingService = new VoiceRoutingService();
  const voiceUsageLockService = new VoiceUsageLockService({
    usageRepo: state.voiceUsageRepo ?? undefined,
    loadPolicy: () => {
      const globalFlags = gatewayPolicyService?.getPolicy().globalFlags;
      const policy = parseVoiceUsagePolicyFromGlobalFlags(globalFlags);
      return {
        enabled: parseBooleanEnv(Bun.env.SPACESKIT_VOICE_LOCK_ENABLED, policy.enabled),
        managedSttSecondsMonthlyLimit: parseOptionalNumberEnv(Bun.env.SPACESKIT_VOICE_MANAGED_STT_SECONDS_LIMIT)
          ?? policy.managedSttSecondsMonthlyLimit,
        managedTtsCharsMonthlyLimit: parseOptionalNumberEnv(Bun.env.SPACESKIT_VOICE_MANAGED_TTS_CHARS_LIMIT)
          ?? policy.managedTtsCharsMonthlyLimit,
        managedTtsSecondsMonthlyLimit: parseOptionalNumberEnv(Bun.env.SPACESKIT_VOICE_MANAGED_TTS_SECONDS_LIMIT)
          ?? policy.managedTtsSecondsMonthlyLimit,
      };
    },
  });

  const defaultVoiceRoute = {
    preferredSource: parseVoiceSourceEnv(Bun.env.SPACESKIT_VOICE_DEFAULT_SOURCE) ?? "managed",
    preferredProviderId: Bun.env.SPACESKIT_VOICE_MANAGED_PROVIDER_ID?.trim() || undefined,
    byokProviderId: Bun.env.SPACESKIT_VOICE_BYOK_PROVIDER_ID?.trim() || undefined,
    localModelProviderId: Bun.env.SPACESKIT_VOICE_LOCAL_PROVIDER_ID?.trim() || undefined,
    appleSpeechProviderId: Bun.env.SPACESKIT_VOICE_APPLE_PROVIDER_ID?.trim() || undefined,
    allowByokFallback: parseBooleanEnv(Bun.env.SPACESKIT_VOICE_ALLOW_BYOK_FALLBACK, false),
    allowLocalFallback: parseBooleanEnv(Bun.env.SPACESKIT_VOICE_ALLOW_LOCAL_FALLBACK, true),
    allowAppleSpeechFallback: parseBooleanEnv(Bun.env.SPACESKIT_VOICE_ALLOW_APPLE_FALLBACK, true),
    stt: {
      preferredSource: parseVoiceSourceEnv(Bun.env.SPACESKIT_VOICE_STT_DEFAULT_SOURCE)
        ?? parseVoiceSourceEnv(Bun.env.SPACESKIT_VOICE_DEFAULT_SOURCE)
        ?? "managed",
      preferredProviderId: Bun.env.SPACESKIT_VOICE_STT_MANAGED_PROVIDER_ID?.trim()
        || Bun.env.SPACESKIT_VOICE_MANAGED_PROVIDER_ID?.trim()
        || undefined,
      byokProviderId: Bun.env.SPACESKIT_VOICE_STT_BYOK_PROVIDER_ID?.trim()
        || Bun.env.SPACESKIT_VOICE_BYOK_PROVIDER_ID?.trim()
        || undefined,
      localModelProviderId: Bun.env.SPACESKIT_VOICE_STT_LOCAL_PROVIDER_ID?.trim()
        || Bun.env.SPACESKIT_VOICE_LOCAL_PROVIDER_ID?.trim()
        || undefined,
      appleSpeechProviderId: Bun.env.SPACESKIT_VOICE_STT_APPLE_PROVIDER_ID?.trim()
        || Bun.env.SPACESKIT_VOICE_APPLE_PROVIDER_ID?.trim()
        || undefined,
      allowByokFallback: parseBooleanEnv(
        Bun.env.SPACESKIT_VOICE_STT_ALLOW_BYOK_FALLBACK,
        parseBooleanEnv(Bun.env.SPACESKIT_VOICE_ALLOW_BYOK_FALLBACK, false),
      ),
      allowLocalFallback: parseBooleanEnv(
        Bun.env.SPACESKIT_VOICE_STT_ALLOW_LOCAL_FALLBACK,
        parseBooleanEnv(Bun.env.SPACESKIT_VOICE_ALLOW_LOCAL_FALLBACK, true),
      ),
      allowAppleSpeechFallback: parseBooleanEnv(
        Bun.env.SPACESKIT_VOICE_STT_ALLOW_APPLE_FALLBACK,
        parseBooleanEnv(Bun.env.SPACESKIT_VOICE_ALLOW_APPLE_FALLBACK, true),
      ),
    },
    tts: {
      preferredSource: parseVoiceSourceEnv(Bun.env.SPACESKIT_VOICE_TTS_DEFAULT_SOURCE)
        ?? parseVoiceSourceEnv(Bun.env.SPACESKIT_VOICE_DEFAULT_SOURCE)
        ?? "managed",
      preferredProviderId: Bun.env.SPACESKIT_VOICE_TTS_MANAGED_PROVIDER_ID?.trim()
        || Bun.env.SPACESKIT_VOICE_MANAGED_PROVIDER_ID?.trim()
        || undefined,
      byokProviderId: Bun.env.SPACESKIT_VOICE_TTS_BYOK_PROVIDER_ID?.trim()
        || Bun.env.SPACESKIT_VOICE_BYOK_PROVIDER_ID?.trim()
        || undefined,
      localModelProviderId: Bun.env.SPACESKIT_VOICE_TTS_LOCAL_PROVIDER_ID?.trim()
        || Bun.env.SPACESKIT_VOICE_LOCAL_PROVIDER_ID?.trim()
        || undefined,
      appleSpeechProviderId: Bun.env.SPACESKIT_VOICE_TTS_APPLE_PROVIDER_ID?.trim()
        || Bun.env.SPACESKIT_VOICE_APPLE_PROVIDER_ID?.trim()
        || undefined,
      allowByokFallback: parseBooleanEnv(
        Bun.env.SPACESKIT_VOICE_TTS_ALLOW_BYOK_FALLBACK,
        parseBooleanEnv(Bun.env.SPACESKIT_VOICE_ALLOW_BYOK_FALLBACK, false),
      ),
      allowLocalFallback: parseBooleanEnv(
        Bun.env.SPACESKIT_VOICE_TTS_ALLOW_LOCAL_FALLBACK,
        parseBooleanEnv(Bun.env.SPACESKIT_VOICE_ALLOW_LOCAL_FALLBACK, true),
      ),
      allowAppleSpeechFallback: parseBooleanEnv(
        Bun.env.SPACESKIT_VOICE_TTS_ALLOW_APPLE_FALLBACK,
        parseBooleanEnv(Bun.env.SPACESKIT_VOICE_ALLOW_APPLE_FALLBACK, true),
      ),
    },
  };
  seedDefaultVoiceProviderConfigs(state.voiceProviderConfigRepo, defaultVoiceRoute);

  const usageSnapshotService = db && state.usageRepo
    ? new UsageSnapshotService({
      db: db.db,
      usageRepo: state.usageRepo,
      voiceUsageRepo: state.voiceUsageRepo ?? undefined,
      loadVoiceLockState: () => {
        const snapshot = voiceUsageLockService.getSnapshot();
        return {
          enabled: snapshot.policy.enabled,
          managedSttSecondsMonthlyLimit: snapshot.policy.managedSttSecondsMonthlyLimit,
          managedTtsCharsMonthlyLimit: snapshot.policy.managedTtsCharsMonthlyLimit,
          managedTtsSecondsMonthlyLimit: snapshot.policy.managedTtsSecondsMonthlyLimit,
          managedCurrentMonthSttSeconds: snapshot.managedCurrentMonth.sttSeconds,
          managedCurrentMonthTtsChars: snapshot.managedCurrentMonth.ttsChars,
          managedCurrentMonthTtsSeconds: snapshot.managedCurrentMonth.ttsSeconds,
        };
      },
    })
    : null;
  const localUsageTelemetryService = new LocalUsageTelemetryService({
    logger: logger.child({ module: "local-usage-telemetry" }),
    windowDays: config.localUsageWindowDays,
    maxSessions: config.localUsageMaxSessions,
    refreshMinSecs: config.localUsageRefreshMinSecs,
    codexBarMode: config.codexBarMode,
  });

  state.gatewayAdminService.setUsageSnapshotService(usageSnapshotService ?? undefined);
  state.gatewayAdminService.setLocalUsageTelemetryService(localUsageTelemetryService);

  state.capabilities.setGatewayPolicyEvaluator((capability, operation, _args, policyContext) => {
    const gatewayDecision = toolAccessPolicyService
      ? toolAccessPolicyService.resolveGatewayCapabilityAccess({
        spaceId: policyContext?.spaceId ?? "",
        principalId: policyContext?.principalId,
        deviceId: policyContext?.deviceId,
        executionOrigin: policyContext?.executionOrigin,
        accessMode: policyContext?.accessMode,
        capability,
        operation,
      })
      : (() => {
        const request = capabilityRequestFromInvocation(capability, operation);
        const decision = gatewayCapabilityAccessService
          ? gatewayCapabilityAccessService.evaluateInvocation({
            capability,
            operation,
            principalId: policyContext?.principalId,
            deviceId: policyContext?.deviceId,
          }).decision
          : evaluateCapabilityRequest(state.gatewayCoreState, request);
        return {
          allowed: decision.decision === "allow",
          reason: `${decision.reason} (required grant: ${request.capabilityId})`,
        };
      })();

    if (!gatewayDecision.allowed) {
      return {
        allowed: false,
        reason: gatewayDecision.reason,
      };
    }

    if (gatewayPolicyService) {
      const decision = gatewayPolicyService.evaluateCapability(capability);
      if (!decision.allowed) {
        return {
          allowed: false,
          reason: decision.reason ?? `Capability denied by gateway policy: ${capability}`,
        };
      }
    }

    return { allowed: true };
  });

  const enforceSandboxRouting = config.archFreezeEnforced || config.sandboxRuntimeEnabled;
  const sandboxBackend = enforceSandboxRouting
    ? await createSandboxExecutionBackend({
      logger: logger.child({ module: "sandbox-runtime" }),
      runtimeModule: config.sandboxRuntimeModule,
      allowHostPassthrough: config.sandboxAllowHostPassthrough,
    })
    : null;
  const sandboxRuntimeState: {
    enforceSandboxRouting: boolean;
    backendMode: "disabled" | "module" | "passthrough" | "unavailable";
    routed: number;
    succeeded: number;
    failed: number;
    belowSloSince?: string;
    lastFailureAt?: string;
    lastFailureMessage?: string;
  } = {
    enforceSandboxRouting,
    backendMode: sandboxBackend?.mode ?? "disabled",
    routed: 0,
    succeeded: 0,
    failed: 0,
    belowSloSince: undefined as string | undefined,
    lastFailureAt: undefined as string | undefined,
    lastFailureMessage: undefined as string | undefined,
  };
  const gatewayObservabilityService = new GatewayObservabilityService({
    eventBus: state.eventBus,
    logger: logger.child({ module: "observability" }),
    relaySloMinSuccessRate: config.relaySloMinSuccessRate,
    relaySloMinSamples: config.relaySloMinSamples,
    relaySloEnforce: config.relaySloEnforce,
    sandboxSloMinSuccessRate: config.sandboxSloMinSuccessRate,
    sandboxSloMinSamples: config.sandboxSloMinSamples,
    sandboxSloEnforce: config.sandboxSloEnforce,
    getSandboxState: () => ({ ...sandboxRuntimeState }),
  });

  if (config.gatewayProfile === "external" && enforceSandboxRouting) {
    if (config.sandboxAllowHostPassthrough) {
      throw new Error(
        "External profile requires strict sandbox isolation; SPACESKIT_SANDBOX_ALLOW_HOST_PASSTHROUGH=true is not permitted",
      );
    }
    if (!sandboxBackend || sandboxBackend.mode !== "module") {
      throw new Error(
        "External profile requires a configured sandbox runtime module when sandbox routing is enforced",
      );
    }
  }

  const updateSandboxSloState = (): void => {
    const evaluation = evaluateSandboxSlo({
      succeeded: sandboxRuntimeState.succeeded,
      failed: sandboxRuntimeState.failed,
      minSuccessRate: config.sandboxSloMinSuccessRate,
      minSamples: config.sandboxSloMinSamples,
    });
    if (!evaluation.evaluated || evaluation.meetsSlo) {
      sandboxRuntimeState.belowSloSince = undefined;
      return;
    }
    if (!sandboxRuntimeState.belowSloSince) {
      sandboxRuntimeState.belowSloSince = new Date().toISOString();
      logger.warn("Sandbox success-rate SLO breached", {
        gatewayProfile: config.gatewayProfile,
        sandboxMode: sandboxRuntimeState.backendMode,
        successRate: evaluation.successRate,
        minSuccessRate: config.sandboxSloMinSuccessRate,
        samples: evaluation.samples,
        minSamples: config.sandboxSloMinSamples,
        sandboxSloEnforce: config.sandboxSloEnforce,
      });
    }
  };

  if (sandboxBackend) {
    state.capabilities.setSandboxInvoker(async (input) => {
      sandboxRuntimeState.routed += 1;
      try {
        const result = await sandboxBackend.invoke(input);
        sandboxRuntimeState.succeeded += 1;
        updateSandboxSloState();
        return result;
      } catch (error) {
        sandboxRuntimeState.failed += 1;
        sandboxRuntimeState.lastFailureAt = new Date().toISOString();
        sandboxRuntimeState.lastFailureMessage = error instanceof Error ? error.message : String(error);
        updateSandboxSloState();
        throw error;
      }
    });
    logger.info("Sandbox execution backend configured", {
      mode: sandboxBackend.mode,
      enforceSandboxRouting,
      sandboxRuntimeEnabled: config.sandboxRuntimeEnabled,
      archFreezeEnforced: config.archFreezeEnforced,
      sloMinSuccessRate: config.sandboxSloMinSuccessRate,
      sloMinSamples: config.sandboxSloMinSamples,
      sloEnforce: config.sandboxSloEnforce,
    });
    if (sandboxBackend.mode === "unavailable") {
      logger.warn("Sandbox backend unavailable — sandbox-routed operations will be denied", {
        sandboxRuntimeModule: config.sandboxRuntimeModule ?? null,
      });
    }
  } else {
    state.capabilities.setSandboxInvoker(null);
  }

  state.capabilities.setExecutionRoutingResolver((routingInput) => (
    resolveCapabilityExecutionRoute(routingInput, { enforceSandboxRouting })
  ));

  let mainAgentHealthStatus: "healthy" | "repaired" | "fallback" | "degraded" = "healthy";
  try {
    if (config.mainAgentAutoRepairEnabled) {
      const defaultsResult = await ensureMainDefaults(
        config,
        logger,
        state.profileRepo,
        state.spaceAdminService,
        resolveMainProfileRuntimeSelection(config, state.seededProviders),
        defaultPersonaId,
      );
      if (defaultsResult) {
        logger.info("Main defaults ensured", {
          spaceId: config.mainSpaceId,
          profileId: config.mainProfileId,
          orchestratorProfileId: config.mainOrchestratorProfileId,
          agentId: config.mainAgentId,
          profile: defaultsResult.profile,
          space: defaultsResult.space,
          assignment: defaultsResult.assignment,
          orchestrator: defaultsResult.orchestrator,
        });
        const skillsResult = await ensureMainSpaceSystemSkills(
          config,
          logger,
          state.spaceAdminService,
          gatewaySkillCatalogService,
        );
        logger.info("Main system skills ensured", {
          spaceId: config.mainSpaceId,
          seeded: skillsResult.seeded,
          attached: skillsResult.attached,
        });

        const conciergeDefaultsResult = await ensureConciergeDefaults(
          config,
          logger,
          state.profileRepo,
          state.spaceAdminService,
          resolveMainProfileRuntimeSelection(config, state.seededProviders),
          defaultPersonaId,
        );
        if (conciergeDefaultsResult) {
          logger.info("Concierge defaults ensured", {
            spaceId: config.conciergeSpaceId,
            profileId: config.conciergeProfileId,
            agentId: config.conciergeAgentId,
            profile: conciergeDefaultsResult.profile,
            space: conciergeDefaultsResult.space,
            assignment: conciergeDefaultsResult.assignment,
            orchestrator: conciergeDefaultsResult.orchestrator,
          });
        }
      }
    } else {
      logger.info("Skipping main defaults bootstrap: SPACESKIT_MAIN_AGENT_AUTO_REPAIR disabled", {
        spaceId: config.mainSpaceId,
        profileId: config.mainProfileId,
        agentId: config.mainAgentId,
      });
    }

    if (state.spaceWorkspaceService) {
      await state.spaceWorkspaceService.ensureWorkspace(config.mainSpaceId);
      await state.spaceWorkspaceService.ensureWorkspace(config.conciergeSpaceId);
    }
  } catch (error) {
    mainAgentHealthStatus = "degraded";
    if (config.gatewayProfile === "external" && config.archFreezeEnforced) {
      logger.error("Failed to ensure main defaults; startup blocked for external freeze profile", error as Error);
      throw error instanceof Error
        ? error
        : new Error("Failed to ensure main defaults for external freeze profile");
    }
    logger.warn("Failed to ensure main defaults; continuing in degraded mode", {
      error: error instanceof Error ? error.message : String(error),
      gatewayProfile: config.gatewayProfile,
      archFreezeEnforced: config.archFreezeEnforced,
    });
  }

  if (mainAgentHealthStatus !== "degraded") {
    try {
      const mainAgentState = await state.gatewayAdminService.getMainAgent({
        spaceId: config.mainSpaceId,
        repairIfMissing: config.mainAgentAutoRepairEnabled,
      });
      mainAgentHealthStatus = mainAgentState.status;
      if (mainAgentState.status === "fallback") {
        logger.warn("Main agent fallback applied", {
          spaceId: config.mainSpaceId,
          mainAgentId: config.mainAgentId,
          mainProfileId: config.mainProfileId,
          providerHint: mainAgentState.providerHint,
          modelHint: mainAgentState.modelHint,
          fallbackReason: mainAgentState.fallbackReason,
        });
      }
    } catch (error) {
      mainAgentHealthStatus = "degraded";
      logger.warn("Main agent health check failed; continuing in degraded mode", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  try {
    const conciergeAgentState = await state.gatewayAdminService.getConciergeAgent({
      spaceId: config.conciergeSpaceId,
      repairIfMissing: config.mainAgentAutoRepairEnabled,
    });
    if (conciergeAgentState.repaired) {
      logger.info("Concierge defaults repaired", {
        spaceId: config.conciergeSpaceId,
        conciergeAgentId: config.conciergeAgentId,
        conciergeProfileId: config.conciergeProfileId,
        providerHint: conciergeAgentState.providerHint,
        modelHint: conciergeAgentState.modelHint,
        status: conciergeAgentState.status,
      });
    }
  } catch (error) {
    logger.warn("Concierge health check failed; continuing in degraded mode", {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  Object.assign(state, {
    defaultPersonaId,
    defaultVoiceRoute,
    gatewayCapabilityAccessService,
    gatewayIdentityService,
    gatewayLibraryService,
    gatewayObservabilityService,
    gatewayPolicyService,
    gatewaySkillCatalogService,
    knowledgeBaseService,
    localUsageTelemetryService,
    mainAgentHealthStatus,
    sandboxRuntimeState,
    toolAccessPolicyService,
    usageSnapshotService,
    voiceRoutingService,
    voiceUsageLockService,
  });
}

function seedDefaultVoiceProviderConfigs(
  repo: {
    upsert: (input: {
      providerId: string;
      channel: "stt" | "tts";
      source: "managed" | "byok" | "local_model" | "apple_speech";
      priority?: number;
      healthStatus?: string;
      costProfileJson?: string;
      secretRef?: string;
      metadataJson?: string;
    }) => unknown;
  } | null | undefined,
  defaults: {
    stt?: {
      preferredProviderId?: string;
      byokProviderId?: string;
      localModelProviderId?: string;
      appleSpeechProviderId?: string;
    };
    tts?: {
      preferredProviderId?: string;
      byokProviderId?: string;
      localModelProviderId?: string;
      appleSpeechProviderId?: string;
    };
  },
): void {
  if (!repo) return;

  const seedChannel = (
    channel: "stt" | "tts",
    channelDefaults: {
      preferredProviderId?: string;
      byokProviderId?: string;
      localModelProviderId?: string;
      appleSpeechProviderId?: string;
    } | undefined,
  ) => {
    if (!channelDefaults) return;

    const entries: Array<{
      providerId?: string;
      source: "managed" | "byok" | "local_model" | "apple_speech";
      priority: number;
    }> = [
      { providerId: channelDefaults.preferredProviderId, source: "managed", priority: 10 },
      { providerId: channelDefaults.byokProviderId, source: "byok", priority: 20 },
      { providerId: channelDefaults.localModelProviderId, source: "local_model", priority: 30 },
      { providerId: channelDefaults.appleSpeechProviderId, source: "apple_speech", priority: 40 },
    ];

    for (const entry of entries) {
      const providerId = entry.providerId?.trim();
      if (!providerId) continue;
      repo.upsert({
        providerId,
        channel,
        source: entry.source,
        priority: entry.priority,
        healthStatus: "unknown",
      });
    }
  };

  seedChannel("stt", defaults.stt);
  seedChannel("tts", defaults.tts);
}
