import {
  DefaultAgentRuntime,
  ExternalMcpAgentRuntime,
  SpaceManager,
  ReflectionService,
  type ModelMessage,
  type ProviderSessionHandle,
  type SaveTurnInput,
  type SpaceConfig,
} from "@spaceskit/core";
import type { BootstrapState } from "./bootstrap-state.js";
import { persistFeedbackApprovalSelection } from "./services/feedback-approval-grant-bridge.js";
import {
  appendMissionContext,
  appendToolUsageGuidance,
  appendWorkspaceContext,
  applyEffectiveSkillContext,
  buildDeterministicHandoffDigest,
  buildWorkspaceContextBlock,
  listTurnsForActiveSessionBoundary,
  parseTurnText,
  uniqueStrings,
  writeDeterministicHandoffDigest,
} from "./turn-helpers.js";

export function initializeSpaceManager(state: BootstrapState): void {
  const { config, logger } = state;
  const reflectionService = state.reflectionService ?? new ReflectionService({
    modelPolicy: {
      summary: {
        modelProvider: state.defaultModelProvider ?? undefined,
        modelId: state.config.defaultModelId ?? undefined,
      },
      experience: {
        modelProvider: state.defaultModelProvider ?? undefined,
        modelId: state.config.defaultModelId ?? undefined,
      },
    },
  });
  state.reflectionService = reflectionService;

  /** Resolve active connector skills (e.g. jira-cli) from the catalog for auto-injection. */
  const resolveConnectorSkillIds = (): string[] => {
    if (!state.gatewaySkillCatalogService) return [];
    try {
      const connectorSkills = state.gatewaySkillCatalogService.listSkills({
        tags: ["connector"],
        status: "active",
      });
      return connectorSkills.map((skill: { skillId: string }) => skill.skillId);
    } catch {
      return [];
    }
  };

  const resolveAgentProfileRuntime = async (
    spaceId: string,
    agentId: string,
  ): Promise<{
    profileId: string;
    systemPrompt: string;
    effectiveSkillIds: string[];
    providerHint?: string;
    modelHint?: string;
    spawnContext?: string;
  }> => {
    const connectorSkillIds = resolveConnectorSkillIds();

    const fallbackBase = state.gatewayAdminService.loadProfileRuntime(config.mainProfileId) ?? {
      profileId: config.mainProfileId,
      systemPrompt: "",
      defaultSkillIds: [],
      providerHint: config.modelProvider,
      modelHint: config.defaultModelId,
    };
    const fallback = {
      ...fallbackBase,
      effectiveSkillIds: uniqueStrings([...fallbackBase.defaultSkillIds, ...connectorSkillIds]),
    };

    const space = await state.spaceAdminService.getSpace(spaceId);
    const assignment = space?.agents.find((entry: any) => entry.agentId === agentId);
    if (!assignment) {
      return {
        ...fallback,
        effectiveSkillIds: uniqueStrings([
          ...fallback.effectiveSkillIds,
          ...(space?.skillIds ?? []),
          ...connectorSkillIds,
        ]),
      };
    }

    const profileRuntime = state.gatewayAdminService.loadProfileRuntime(assignment.profileId);
    if (!profileRuntime) {
      return {
        profileId: assignment.profileId,
        systemPrompt: "",
        effectiveSkillIds: uniqueStrings([...(space?.skillIds ?? []), ...connectorSkillIds]),
      };
    }

    return {
      profileId: profileRuntime.profileId,
      systemPrompt: profileRuntime.systemPrompt,
      effectiveSkillIds: uniqueStrings([
        ...profileRuntime.defaultSkillIds,
        ...(space?.skillIds ?? []),
        ...connectorSkillIds,
      ]),
      providerHint: profileRuntime.providerHint,
      modelHint: profileRuntime.modelHint,
      spawnContext: assignment.spawnContext ?? undefined,
    };
  };

  const spaceManager = new SpaceManager({
    eventBus: state.eventBus,
    checkpointManager: state.checkpointManager ?? undefined,
    deadLetterQueue: state.deadLetterQueue ?? undefined,
    maxHops: config.maxAgentHops,
    masterModeEnabled: config.masterModeEnabled,
    masterPlannerPromptTemplate: config.masterPlannerPromptTemplate,
    guestAgentPromptTemplate: config.guestAgentPromptTemplate,
    peerReviewPromptTemplate: config.peerReviewPromptTemplate,
    masterSynthesisPromptTemplate: config.masterSynthesisPromptTemplate,
    appendOrchestrationJournalEntry: state.orchestrationJournalRepo
      ? async (entry) => {
        state.orchestrationJournalRepo.create({
          eventId: crypto.randomUUID(),
          spaceId: entry.spaceId,
          turnId: entry.turnId,
          eventType: entry.eventType,
          actorId: entry.actorId,
          lineageId: entry.lineageId,
          hopCount: entry.hopCount,
          payloadJson: JSON.stringify(entry.payload),
        });
      }
      : undefined,
    recordOrchestrationMetric: ({ name, value, tags }) => {
      logger.debug("Orchestration metric", { name, value, ...(tags ?? {}) });
    },
    reflectionService,
    handleFeedbackResolution: async ({ spaceId, turnId, request, response, approvalGrant, principalId, deviceId }) => {
      state.eventBus.emit({
        type: "space.turn_event",
        spaceId,
        turnId,
        event: {
          type: "feedback_resolved",
          response,
          requestId: request?.id,
          agentId: request?.agentId,
        },
        timestamp: new Date(),
      });

      if (response !== "approve" || !approvalGrant || !request) {
        return;
      }
      persistFeedbackApprovalSelection({
        spaceId,
        approvalGrant,
        feedbackRequest: request,
        principalId,
        deviceId,
        accessGrantService: state.accessGrantService ?? undefined,
        gatewayCapabilityAccessService: state.gatewayCapabilityAccessService ?? undefined,
        toolApprovalGrantService: state.toolApprovalGrantService ?? undefined,
      });
    },
    loadSpaceConfig: async (spaceId: string): Promise<SpaceConfig | null> => state.spaceAdminService.getSpace(spaceId),
    updateSpaceStatus: async (spaceId: string, status: string): Promise<void> => {
      state.spaceRepo?.updateStatus(spaceId, status);
    },
    saveTurn: async (turn: SaveTurnInput): Promise<void> => {
      if (!state.turnRepo) return;
      const completedAt = new Date().toISOString();
      let tokenInput = turn.promptTokens;
      const tokenOutput = turn.completionTokens;
      if (tokenInput === 0 && turn.totalTokens > tokenOutput) {
        tokenInput = turn.totalTokens - tokenOutput;
      }
      state.turnRepo.create({
        turnId: turn.turnId,
        spaceId: turn.spaceId,
        actorType: "agent",
        actorId: turn.agentId,
        inputJson: JSON.stringify({ text: turn.input }),
        userTurnId: turn.userTurnId,
      });
      if (turn.status === "failed") {
        state.turnRepo.fail(turn.turnId, turn.output);
      } else {
        state.turnRepo.complete(turn.turnId, {
          outputJson: JSON.stringify({ text: turn.output }),
          tokenInput,
          tokenOutput,
        });
      }

      const logicalTurnId = turn.userTurnId?.trim() || turn.turnId;
      const shouldCaptureMemory = state.spaceMemoryPolicyService
        ? state.spaceMemoryPolicyService.shouldGenerateExperiences(turn.spaceId)
        : true;
      if (shouldCaptureMemory) {
        const memoryProvider = state.memoryRegistry.getDefault();
        try {
          await memoryProvider?.onTurnCompleted?.({
            spaceId: turn.spaceId,
            turnId: logicalTurnId,
            agentId: turn.agentId,
            input: turn.input,
            output: turn.output,
            toolCalls: [],
            usage: {
              promptTokens: tokenInput,
              completionTokens: tokenOutput,
            },
          });
        } catch (error) {
          logger.warn("Memory provider onTurnCompleted hook failed", {
            spaceId: turn.spaceId,
            turnId: logicalTurnId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      const sessionUpdate = state.spaceMemoryPolicyService?.noteTurnPersisted(turn.spaceId, completedAt);
      if (sessionUpdate?.shouldGenerateExperience) {
        state.spaceMemoryPolicyService?.markSelfCheckCompleted(turn.spaceId, sessionUpdate.session.turn_count);
        state.eventBus.emit({
          type: "space.self_check",
          spaceId: turn.spaceId,
          turnId: logicalTurnId,
          agentId: turn.agentId,
          sessionId: sessionUpdate.session.session_id,
          turnCount: sessionUpdate.session.turn_count,
          lastSelfCheckTurnCount: sessionUpdate.session.last_self_check_turn_count,
          trigger: "turn_count_threshold",
          timestamp: new Date(completedAt),
        });
      }
    },
    loadHistory: async (spaceId: string, limit = 50): Promise<ModelMessage[]> => {
      if (!state.turnRepo) return [];
      const turns = [...state.turnRepo.listBySpace(spaceId, limit)].reverse();
      const history: ModelMessage[] = [];
      const emittedUserTurns = new Set<string>();
      const parseRecord = (raw: string | null): Record<string, unknown> => {
        if (!raw) return {};
        try {
          const parsed = JSON.parse(raw);
          return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
        } catch {
          return {};
        }
      };
      const resolveLogicalTurnId = (turn: { turn_id: string; user_turn_id: string }): string => {
        const userTurnId = turn.user_turn_id.trim();
        return userTurnId.length > 0 ? userTurnId : turn.turn_id;
      };

      for (const turn of turns) {
        const logicalTurnId = resolveLogicalTurnId(turn);
        const inputText = typeof parseRecord(turn.input_json).text === "string"
          ? String(parseRecord(turn.input_json).text).trim()
          : "";
        if (inputText && !emittedUserTurns.has(logicalTurnId)) {
          emittedUserTurns.add(logicalTurnId);
          history.push({ role: "user", content: inputText });
        }

        const outputText = typeof parseRecord(turn.output_json).text === "string"
          ? String(parseRecord(turn.output_json).text).trim()
          : "";
        if (outputText) {
          history.push({ role: "assistant", content: outputText });
        }
      }

      return history;
    },
    loadAgentHistory: async (spaceId: string, agentId: string, limit = 50): Promise<ModelMessage[]> => {
      if (!state.turnRepo) return [];
      const normalizedLimit = Math.max(1, Math.floor(limit));
      const activeSession = state.agentUsageSessionRepo?.getActive(spaceId, agentId);
      let turns = activeSession
        ? [...listTurnsForActiveSessionBoundary(
          state.turnRepo,
          spaceId,
          agentId,
          activeSession.started_at,
          normalizedLimit,
        )]
        : [...state.turnRepo.listBySpaceAndAgent(spaceId, agentId, normalizedLimit)];
      const history: ModelMessage[] = [];
      const injectedMessages: ModelMessage[] = [];
      const emittedUserTurns = new Set<string>();
      const resolveLogicalTurnId = (turn: { turn_id: string; user_turn_id: string }): string => {
        const userTurnId = turn.user_turn_id.trim();
        return userTurnId.length > 0 ? userTurnId : turn.turn_id;
      };

      if (activeSession && turns.length === 0 && state.spaceWorkspaceService) {
        const recentTurns = state.turnRepo.listBySpaceAndAgent(
          spaceId,
          agentId,
          Math.max(normalizedLimit, 24),
        );
        const preBoundaryTurns = recentTurns.filter((turn: any) => turn.created_at < activeSession.started_at);
        if (preBoundaryTurns.length > 0) {
          try {
            const workspace = await state.spaceWorkspaceService.getWorkspace(spaceId);
            const handoffDigest = buildDeterministicHandoffDigest(preBoundaryTurns);
            const handoffPath = await writeDeterministicHandoffDigest(
              workspace.sharedContextPath,
              agentId,
              handoffDigest,
            );
            injectedMessages.push({
              role: "system",
              content: [
                "Deterministic handoff digest injected for fresh runtime session.",
                `Digest file: ${handoffPath}`,
                "",
                handoffDigest,
              ].join("\n"),
            });
          } catch (error) {
            logger.warn("Failed to build deterministic handoff digest", {
              spaceId,
              agentId,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
      }

      for (const turn of turns.reverse()) {
        const logicalTurnId = resolveLogicalTurnId(turn);
        const inputText = parseTurnText(turn.input_json) ?? "";
        if (inputText && !emittedUserTurns.has(logicalTurnId)) {
          emittedUserTurns.add(logicalTurnId);
          history.push({ role: "user", content: inputText });
        }
        const outputText = parseTurnText(turn.output_json) ?? "";
        if (outputText) {
          history.push({ role: "assistant", content: outputText });
        }
      }

      return [...injectedMessages, ...history];
    },
    loadAgentSessionMetadata: async (spaceId: string, agentId: string) => {
      const activeSession = state.agentUsageSessionRepo?.getActive(spaceId, agentId);
      if (!activeSession) {
        return undefined;
      }
      return {
        displayTitle: activeSession.display_title || undefined,
        providerSessionHandle: parseProviderSessionHandle(activeSession.provider_session_handle_json),
      };
    },
    saveAgentSessionMetadata: async (metadata) => {
      state.agentUsageSessionRepo?.updateRuntimeMetadata({
        spaceId: metadata.spaceId,
        agentId: metadata.agentId,
        displayTitle: metadata.displayTitle,
        providerSessionHandleJson: metadata.providerSessionHandle
          ? JSON.stringify(metadata.providerSessionHandle)
          : undefined,
      });
    },
    resolveRuntime: async (spaceId: string, agentId: string) => {
      const externalBinding = state.spaceMcpService.getBinding(spaceId, agentId);
      if (externalBinding) {
        return new ExternalMcpAgentRuntime({
          agentId,
          remoteAgentId: externalBinding.remoteAgentId,
          eventBus: state.eventBus,
          executeRemoteTurn: async (input) => state.spaceMcpService.invokeExternalAgentTurn({
            ...input,
            messages: input.messages as unknown as Array<Record<string, unknown>>,
          }),
        });
      }

      const profileRuntime = await resolveAgentProfileRuntime(spaceId, agentId);
      const providerSelection = await state.gatewayAdminService.resolveProviderForProfile(
        profileRuntime.providerHint,
        profileRuntime.modelHint,
      );
      const modelProvider = state.executionAdapterFactory.createModelProvider({
        providerId: providerSelection.providerId,
        model: providerSelection.model,
        apiKey: providerSelection.apiKey,
        authMode: providerSelection.authMode,
        baseURL: providerSelection.baseURL,
        isLocal: providerSelection.isLocal,
        allowUnsafeHostBypass: config.sandboxAllowHostPassthrough,
      });
      const activeSkillMarkdownById = state.gatewaySkillCatalogService
        ? state.gatewaySkillCatalogService.getActiveSkillMarkdownMap(profileRuntime.effectiveSkillIds)
        : undefined;
      const baseSystemPrompt = applyEffectiveSkillContext(
        profileRuntime.systemPrompt,
        profileRuntime.effectiveSkillIds,
        activeSkillMarkdownById,
      );
      const workspace = state.spaceWorkspaceService
        ? await state.spaceWorkspaceService.ensureWorkspace(spaceId).catch(() => null)
        : null;
      const workspaceContextBlock = workspace && state.spaceWorkspaceService
        ? await buildWorkspaceContextBlock(state.spaceWorkspaceService, spaceId, agentId).catch(() => undefined)
        : undefined;

      // Assemble the 5-layer prompt stack:
      // L0 persona + L1 skills = baseSystemPrompt (already assembled above)
      // L2 capability = workspace context + tool usage guidance
      // L3 mission = spawnContext
      const withWorkspace = appendWorkspaceContext(baseSystemPrompt, workspaceContextBlock);
      const withToolGuidance = appendToolUsageGuidance(withWorkspace);
      const assembledSystemPrompt = appendMissionContext(withToolGuidance, profileRuntime.spawnContext);

      return new DefaultAgentRuntime({
        config: {
          id: agentId,
          profileId: profileRuntime.profileId,
          systemPrompt: assembledSystemPrompt,
          modelProvider: providerSelection.providerId,
          modelId: providerSelection.model,
          tools: [],
          maxSteps: 10,
          workingDirectory: workspace?.effectiveWorkspaceRoot,
          nativeCliToolsEnabled: providerSelection.nativeCliToolsEnabled,
          resolvedSafetyProfileId: (profileRuntime as { safetyProfileId?: string }).safetyProfileId ?? profileRuntime.profileId,
        },
        modelProvider,
        toolExecutor: state.toolExecutor,
        middleware: state.middleware,
        eventBus: state.eventBus,
        resolveApprovalBypass: async (sid, aid, accessMode, executionOrigin) => {
          if (accessMode !== "full_access") return false;
          if (!state.toolAccessPolicyService) return false;
          const effective = await state.toolAccessPolicyService.getEffectiveToolAccess({
            spaceId: sid,
            agentId: aid,
            executionOrigin,
            accessMode: "full_access",
          });
          return effective.dangerousCapabilities.some(
            (c: { capabilityId: string; enabled: boolean }) => c.capabilityId === "approval_bypass" && c.enabled,
          );
        },
        createCliExecutionObserver: async ({ spaceId: sid, turnId, agentId, stepIndex, providerId, modelId }) => {
          if (!state.cliExecutionAuditService) return undefined;
          if (state.executionAdapterFactory.classify(providerId) !== "executor") {
            return undefined;
          }
          if (state.spaceMemoryPolicyService && !state.spaceMemoryPolicyService.shouldPersistTurnTrace(sid)) {
            return undefined;
          }
          return state.cliExecutionAuditService.createObserver({
            spaceId: sid,
            turnId,
            agentId,
            stepIndex,
            providerId,
            modelId,
          });
        },
      });
    },
  });

  logger.info("Space manager initialized");
  state.spaceManager = spaceManager;
}

function parseProviderSessionHandle(value: string | null | undefined): ProviderSessionHandle | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return undefined;
    }
    const record = parsed as Record<string, unknown>;
    if (record.type === "openai_response" && typeof record.previousResponseId === "string" && record.previousResponseId.trim()) {
      return {
        type: "openai_response",
        previousResponseId: record.previousResponseId,
      };
    }
    if (record.type === "codex_app_server_thread" && typeof record.threadId === "string" && record.threadId.trim()) {
      return {
        type: "codex_app_server_thread",
        threadId: record.threadId,
      };
    }
  } catch {
    return undefined;
  }
  return undefined;
}
