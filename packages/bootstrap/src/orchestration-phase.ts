import { ExperienceGenerator, ReflectionService } from "@spaceskit/core";
import type { BootstrapState } from "./bootstrap-state.js";
import { GatewayResetService } from "./services/gateway-reset-service.js";
import { OrchestratorCommandService } from "./services/orchestrator-command-service.js";
import { SchedulerService } from "./services/scheduler-service.js";
import { SpeechSessionService } from "./services/speech-session-service.js";
import { ConciergeCallRuntimeService } from "./services/concierge-call-runtime-service.js";
import { WorkbenchService } from "./services/workbench-service.js";

export async function initializeOrchestrationServices(state: BootstrapState): Promise<void> {
  const { config, logger, db } = state;
  const selfCheckTurnBySpace = new Map<string, string>();
  const workbenchAgentLoopEnabled = Bun.env.SPACESKIT_WORKBENCH_AGENT_LOOP !== "false";

  const orchestratorCommandService = (
    state.orchestratorCommandRepo
    && state.spaceContextService
  )
    ? new OrchestratorCommandService({
      repository: state.orchestratorCommandRepo,
      spaceAdminService: state.spaceAdminService,
      spaceManager: state.spaceManager,
      spaceContextService: state.spaceContextService,
      defaultTargetSpaceId: config.mainSpaceId,
      turnRepo: state.turnRepo ?? undefined,
      reflectionService: state.reflectionService ?? undefined,
      requireCallerPrincipal: config.gatewayProfile === "external",
      authorizeCommand: state.spaceSharingService
        ? ({ targetSpaceId, principalId }) => {
          const decision = state.spaceSharingService.evaluateAccess({
            spaceId: targetSpaceId,
            principalId,
            action: "write",
          });
          return { allowed: decision.allowed, reason: decision.reason };
        }
        : undefined,
      gatewaySkillCatalogService: state.gatewaySkillCatalogService ?? undefined,
    })
    : null;

  const schedulerService = (
    state.schedulerJobRepo
    && state.schedulerJobSpaceRepo
    && state.schedulerJobRunRepo
    && state.spaceRepo
    && orchestratorCommandService
  )
    ? new SchedulerService({
      jobs: state.schedulerJobRepo,
      jobSpaces: state.schedulerJobSpaceRepo,
      runs: state.schedulerJobRunRepo,
      spaces: state.spaceRepo,
      spaceAdminService: state.spaceAdminService,
      orchestratorCommandService,
      spaceSharingService: state.spaceSharingService,
      logger: logger.child({ module: "scheduler" }),
    })
    : null;

  if (schedulerService) {
    try {
      await schedulerService.reconcileSchedulesOnStartup();
      logger.info("Scheduler service initialized");
    } catch (error) {
      logger.warn("Failed to reconcile scheduler state on startup", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const workbenchService = (
    config.gatewayProfile === "external"
    && state.workbenchBatchRepo
    && state.workbenchRunRepo
    && state.workbenchArtifactRepo
    && state.workbenchPolicyRepo
  )
    ? new WorkbenchService({
      batches: state.workbenchBatchRepo,
      runs: state.workbenchRunRepo,
      artifacts: state.workbenchArtifactRepo,
      policy: state.workbenchPolicyRepo,
      repoRoot: Bun.env.SPACESKIT_WORKBENCH_REPO_ROOT ?? process.cwd(),
      workProjectsRoot: Bun.env.SPACESKIT_WORKBENCH_PROJECTS_ROOT,
      workbenchProjectSlug: Bun.env.SPACESKIT_WORKBENCH_PROJECT_SLUG,
      logger: logger.child({ module: "workbench" }),
      ...(workbenchAgentLoopEnabled
        ? {
          spaceAdminService: state.spaceAdminService,
          spaceManager: state.spaceManager,
          eventBus: state.eventBus,
        }
        : {}),
    })
    : null;

  const gatewayResetService = db
    ? new GatewayResetService({
      db: db.db,
      logger: logger.child({ module: "gateway-reset" }),
      spaceManager: state.spaceManager,
      gatewayAdminService: state.gatewayAdminService,
      getGatewayId: () => config.mainSpaceResourceId,
      getGatewayUuid: () => state.gatewayUuid,
    })
    : null;

  const speechSessionService = Bun.env.SPACESKIT_ENABLE_SPEECH_MVP === "true"
    ? new SpeechSessionService({
      spaceManager: state.spaceManager,
      voiceUsageRepo: state.voiceUsageRepo ?? undefined,
      voiceProviderConfigRepo: state.voiceProviderConfigRepo ?? undefined,
      voiceUsageLockService: state.voiceUsageLockService,
      voiceRoutingService: state.voiceRoutingService,
      defaultVoiceRoute: state.defaultVoiceRoute,
    })
    : null;
  if (speechSessionService) {
    logger.info("Speech session service enabled (SPACESKIT_ENABLE_SPEECH_MVP=true)", {
      defaultVoiceSource: state.defaultVoiceRoute.preferredSource,
      allowByokFallback: state.defaultVoiceRoute.allowByokFallback,
      allowLocalFallback: state.defaultVoiceRoute.allowLocalFallback,
      allowAppleSpeechFallback: state.defaultVoiceRoute.allowAppleSpeechFallback,
      voiceLockEnabled: state.voiceUsageLockService.getSnapshot().policy.enabled,
    });
  }

  const conciergeCallRuntimeService = new ConciergeCallRuntimeService({
    eventBus: state.eventBus,
    logger: logger.child({ module: "concierge-call-runtime" }),
    spaceManager: state.spaceManager,
  });
  state.conciergeEscalationService?.setConciergeCallRuntimeService(conciergeCallRuntimeService);

  if (db && state.experienceRepo && state.turnRepo) {
    const defaultMemory = state.memoryRegistry.getDefault();
    const reflectionService = state.reflectionService ?? new ReflectionService({
      modelPolicy: {
        experience: {
          modelProvider: state.defaultModelProvider ?? undefined,
          modelId: state.config.defaultModelId ?? undefined,
        },
      },
    });
    state.reflectionService = reflectionService;
    const experienceGenerator = new ExperienceGenerator({
      eventBus: state.eventBus,
      reflectionService,
      memoryProvider: defaultMemory ?? undefined,
      loadHistory: async (spaceId: string) => state.turnRepo.listBySpace(spaceId, 100).map((turn: any) => {
        const inputJson = turn.input_json ? JSON.parse(turn.input_json) : {};
        const outputJson = turn.output_json ? JSON.parse(turn.output_json) : {};
        return {
          turnId: turn.turn_id,
          agentId: turn.actor_id,
          input: inputJson.text ?? "",
          output: outputJson.text ?? "",
          promptTokens: turn.token_input_count ?? 0,
          completionTokens: turn.token_output_count ?? 0,
          status: turn.status,
        };
      }),
      loadSpaceConfig: async (spaceId: string) => {
        const space = await state.spaceAdminService.getSpace(spaceId);
        if (!space) return null;
        return {
          spaceId: space.id,
          resourceId: space.resourceId,
          name: space.name,
          goal: space.goal ?? undefined,
          turnModel: space.turnModel,
          agents: space.agents.map((agent: any) => ({
            agentId: agent.agentId,
            profileId: agent.profileId,
            isPrimary: agent.isPrimary,
          })),
        };
      },
      saveExperience: async (experience) => {
        state.experienceRepo.create({
          experienceId: experience.experienceId,
          spaceId: experience.spaceId,
          summary: experience.summary,
          tags: experience.tags,
          lessons: [...experience.strengths, ...experience.weaknesses],
        });
        if (experience.status !== "draft") {
          state.experienceRepo.updateStatus(experience.experienceId, experience.status);
        }

        for (const observation of experience.agentObservations) {
          state.experienceRepo.createObservation({
            observationId: crypto.randomUUID(),
            experienceId: experience.experienceId,
            agentId: observation.agentId,
            observation: observation.observation,
            strengths: observation.profileDeltaSuggestion ? [observation.profileDeltaSuggestion] : [],
            weaknesses: [],
          });

          await defaultMemory?.save({
            content: observation.observation,
            type: "observation",
            scope: {
              spaceId: experience.spaceId,
              agentId: observation.agentId,
            },
            metadata: {
              experienceId: experience.experienceId,
              profileId: observation.profileId,
              sourceType: "agent_observation",
              sourceId: `${experience.experienceId}:${observation.agentId}`,
              sourceStatus: experience.status,
            },
            importance: observation.relevance,
            tags: ["experience-observation", ...experience.tags],
          });
        }

        const turnId = selfCheckTurnBySpace.get(experience.spaceId);
        if (turnId) {
          state.eventBus.emit({
            type: "space.turn_event",
            spaceId: experience.spaceId,
            turnId,
            event: {
              type: "experience.saved",
              experienceId: experience.experienceId,
            },
            timestamp: new Date(),
          });
        }
      },
      saveInsight: state.personalityInsightRepo
        ? async (insight) => {
          state.personalityInsightRepo!.create({
            insightId: insight.insightId,
            experienceId: insight.experienceId,
            spaceId: insight.spaceId,
            profileId: insight.profileId,
            baseRevision: insight.baseRevision,
            proposedPromptDelta: insight.proposedPromptDelta,
            rationale: insight.rationale,
            confidence: insight.confidence,
            status: insight.status,
            createdBy: "experience-generator",
          });

          await defaultMemory?.save({
            content: insight.proposedPromptDelta,
            type: "procedural",
            scope: {
              spaceId: insight.spaceId,
            },
            metadata: {
              profileId: insight.profileId,
              rationale: insight.rationale,
              sourceType: "personality_insight",
              sourceId: insight.insightId,
              sourceStatus: insight.status,
            },
            importance: insight.confidence,
            tags: ["personality-insight", `profile:${insight.profileId}`],
          });

          const turnId = selfCheckTurnBySpace.get(insight.spaceId);
          if (turnId) {
            state.eventBus.emit({
              type: "space.turn_event",
              spaceId: insight.spaceId,
              turnId,
              event: {
                type: "insight.proposed",
                insightId: insight.insightId,
                profileId: insight.profileId,
                confidence: insight.confidence,
              },
              timestamp: new Date(),
            });
          }
        }
        : undefined,
    });
    logger.info("Experience generator initialized");
    state.experienceGenerator = experienceGenerator;

    state.eventBus.on("space.self_check", async (event: any) => {
      const spaceId = typeof event?.spaceId === "string" ? event.spaceId.trim() : "";
      const turnId = typeof event?.turnId === "string" ? event.turnId.trim() : "";
      if (!spaceId) return;
      if (turnId) {
        selfCheckTurnBySpace.set(spaceId, turnId);
      }

      try {
        if (!state.spaceMemoryPolicyService || state.spaceMemoryPolicyService.shouldGenerateExperiences(spaceId)) {
          await defaultMemory?.onSpaceCompleted?.(spaceId);
        }
      } catch (error) {
        logger.warn("Failed running memory self-check completion hook", {
          spaceId,
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        state.spaceMemoryPolicyService?.markSelfCheckCompleted(spaceId);
      }
    });
  }

  Object.assign(state, {
    gatewayResetService,
    orchestratorCommandService,
    schedulerService,
    workbenchService,
    speechSessionService,
    conciergeCallRuntimeService,
  });
}
