/**
 * TaskOrchestrationService — the core loop for voice/text-initiated
 * multi-agent orchestration.
 *
 * A single `orchestrate()` call:
 * 1. Resolves a template (by hint, id, or archetype match)
 * 2. Creates or reuses a space
 * 3. Deploys agents by tier
 * 4. Executes initial turn via SpaceManager
 * 5. Returns immediately with taskId + spaceId (fire-and-notify)
 *
 * Completion is detected from SpaceManager event-bus signals for the
 * orchestrated root turn.
 */

import { randomUUID } from "node:crypto";
import type { SpaceAdminService, EventBus, SpaceManager } from "@spaceskit/core";
import type { TurnModelStrategy, TurnModelConfig } from "@spaceskit/core";
import {
  resolveArchetypeHint,
  isCapabilityTier,
  resolveTierProviderHints,
} from "@spaceskit/core";
import type { CapabilityTier, ArchetypeDefinition } from "@spaceskit/core";
import type {
  CreateProfileInput,
  ProfileModelConfig,
  TaskRecordRepository,
  TaskState,
  SpaceTemplateRepository,
} from "@spaceskit/persistence";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OrchestrateTaskInput {
  taskDescription: string;
  requestedBy: string;
  deviceId?: string;
  /** Explicit template ID. */
  templateId?: string;
  /** Fuzzy template/archetype hint (e.g., "research", "debate"). */
  templateHint?: string;
  /** Total number of agents to deploy. */
  agentCount?: number;
  /** Capability tier for agents. */
  agentTier?: CapabilityTier;
  /** Conversation topology override. */
  topology?: "direct" | "shared_team_chat" | "broadcast_team";
  /** Reuse an existing space instead of creating a new one. */
  spaceId?: string;
  /** Maximum turns before forcing synthesis. */
  maxTurns?: number;
}

export interface OrchestrateTaskResult {
  taskId: string;
  spaceId: string;
  rootTurnId: string;
  templateId: string;
  agentCount: number;
  state: TaskState;
}

export interface TaskOrchestrationServiceOptions {
  spaceAdminService: SpaceAdminService;
  spaceManager: SpaceManager;
  eventBus: EventBus;
  taskRecordRepo: TaskRecordRepository;
  spaceTemplateRepo: SpaceTemplateRepository;
  profileRepo: {
    getById(id: string): {
      profile_id: string;
      name: string;
      description: string;
      can_moderate: number;
      is_default: number;
      preferred_tier?: string;
    } | undefined;
    getActiveRevision(id: string): {
      profile_id: string;
      personality_prompt: string;
      default_skill_set_ids_json: string;
      provider_hint: string;
      model_hint: string;
      model_config_json: string;
    } | undefined;
    create(input: CreateProfileInput): unknown;
  };
  /**
   * Called when a task description is truncated to fit the configured
   * length budget. Receives the original and truncated lengths. Default
   * is silent — pass a logger.warn binding when you want telemetry.
   */
  onTaskDescriptionTruncated?: (info: { from: number; to: number }) => void;
}

type TaskOutcome =
  | { type: "completed"; detail?: string; turnsCompleted: number }
  | { type: "failed"; detail: string; turnsCompleted: number }
  | { type: "input_required"; detail: string; turnsCompleted: number };

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class TaskOrchestrationService {
  private readonly spaceAdminService: SpaceAdminService;
  private readonly spaceManager: SpaceManager;
  private readonly eventBus: EventBus;
  private readonly taskRecordRepo: TaskRecordRepository;
  private readonly spaceTemplateRepo: SpaceTemplateRepository;
  private readonly profileRepo: TaskOrchestrationServiceOptions["profileRepo"];
  private readonly onTaskDescriptionTruncated?: (info: { from: number; to: number }) => void;

  constructor(options: TaskOrchestrationServiceOptions) {
    this.spaceAdminService = options.spaceAdminService;
    this.spaceManager = options.spaceManager;
    this.eventBus = options.eventBus;
    this.taskRecordRepo = options.taskRecordRepo;
    this.spaceTemplateRepo = options.spaceTemplateRepo;
    this.profileRepo = options.profileRepo;
    this.onTaskDescriptionTruncated = options.onTaskDescriptionTruncated;
  }

  /**
   * Orchestrate a multi-agent task. Fire-and-notify pattern:
   * returns immediately with taskId + spaceId, executes in background.
   */
  async orchestrate(input: OrchestrateTaskInput): Promise<OrchestrateTaskResult> {
    // --- Input validation ---
    const trimmedDescription = input.taskDescription?.trim() ?? "";
    if (!trimmedDescription) {
      throw new Error("Task description is required and cannot be empty.");
    }
    if (trimmedDescription.length < 10) {
      throw new Error(
        `Task description must be at least 10 characters (got ${trimmedDescription.length}). Provide a more detailed description.`,
      );
    }
    if (trimmedDescription.length > 2000) {
      this.onTaskDescriptionTruncated?.({ from: trimmedDescription.length, to: 2000 });
      input = { ...input, taskDescription: trimmedDescription.substring(0, 2000) };
    } else if (trimmedDescription !== input.taskDescription) {
      input = { ...input, taskDescription: trimmedDescription };
    }
    if (input.agentCount !== undefined && input.agentCount > 10) {
      throw new Error(
        `Agent count must not exceed 10 (got ${input.agentCount}).`,
      );
    }
    if (input.maxTurns !== undefined && input.maxTurns > 50) {
      throw new Error(
        `Max turns must not exceed 50 (got ${input.maxTurns}).`,
      );
    }

    const taskId = randomUUID();
    const requestedTier = input.agentTier && isCapabilityTier(input.agentTier)
      ? input.agentTier
      : undefined;

    // 1. Resolve template
    const resolved = this.resolveTemplate(input);
    const templateId = resolved.templateId;
    const archetype = resolved.archetype;
    const topology = input.topology ?? archetype?.topology ?? "broadcast_team";

    // 2. Determine agent count (total agents, including coordinator when present)
    const minimumAgentCount = topology === "direct" ? 1 : 2;
    const defaultAgentCount = topology === "direct"
      ? (input.agentCount ?? 1)
      : (archetype?.defaultAgentCount ?? 2);
    const agentCount = Math.max(minimumAgentCount, input.agentCount ?? defaultAgentCount);

    // 3. Create or reuse space before returning so callers get a usable spaceId.
    const spaceId = input.spaceId ?? await this.ensureSpace(taskId, input, topology, archetype);

    // 4. Deploy agents before returning so the task is actually runnable.
    const agents = this.buildAgentAssignments(agentCount, requestedTier, topology, archetype, resolved.templateConfig);
    await this.deployAgents(spaceId, input.taskDescription, agents, requestedTier);

    // 5. Create task record with the real spaceId.
    const taskRecord = this.taskRecordRepo.create({
      taskId,
      spaceId,
      requestedBy: input.requestedBy,
      taskDescription: input.taskDescription,
      agentTier: requestedTier ?? "template-default",
      agentCount,
      topology,
      templateId,
      maxTurns: input.maxTurns ?? 20,
    });

    // 6. Set up event listeners BEFORE executeTurn() so the summary event
    //    emitted in the finally block is not missed. We buffer matching
    //    events and replay them once we know the rootTurnId.
    const outcomeListener = this.createEarlyOutcomeListener({
      taskId,
      spaceId,
      topology,
      totalSteps: input.maxTurns ?? 20,
    });

    // 7. Start the root turn. The summary event fires in executeTurn's
    //    finally block and is caught by the listener set up in step 6.
    let rootTurnId: string;
    try {
      ({ turnId: rootTurnId } = await this.spaceManager.executeTurn(
        spaceId,
        input.taskDescription,
        undefined, // let space manager pick the primary agent
        {
          principalId: input.requestedBy,
          deviceId: input.deviceId,
          executionOrigin: "system" as const,
        },
      ));
    } catch (err) {
      outcomeListener.dispose();
      const message = err instanceof Error ? err.message : String(err);
      this.taskRecordRepo.update({
        taskId,
        state: "failed",
        progress: {
          turnsCompleted: 0,
          turnsTotal: input.maxTurns ?? 20,
          currentPhase: "failed",
          latestMessage: message,
        },
        errorMessage: message,
      });
      this.eventBus.emit({
        type: "task.failed",
        timestamp: new Date(),
        spaceId,
        data: { taskId, spaceId, error: message },
      });
      throw err;
    }

    // Now that we have the rootTurnId, bind it to the outcome listener.
    outcomeListener.bindTurnId(rootTurnId);

    this.taskRecordRepo.update({
      taskId,
      state: "running",
      progress: {
        turnsCompleted: 0,
        turnsTotal: input.maxTurns ?? 20,
        currentPhase: "executing",
        rootTurnId,
      },
    });

    // 8. Monitor orchestration in background (fire-and-notify)
    this.monitorOutcome(taskId, spaceId, input, rootTurnId, outcomeListener.promise)
      .catch((err) => {
        this.taskRecordRepo.update({
          taskId,
          state: "failed",
          progress: {
            turnsCompleted: 0,
            turnsTotal: input.maxTurns ?? 20,
            currentPhase: "failed",
            rootTurnId,
            latestMessage: err instanceof Error ? err.message : String(err),
          },
          errorMessage: err instanceof Error ? err.message : String(err),
        });
        this.eventBus.emit({
          type: "task.failed",
          timestamp: new Date(),
          spaceId,
          data: { taskId, spaceId, error: String(err) },
        });
      });

    return {
      taskId,
      spaceId: taskRecord.space_id,
      rootTurnId,
      templateId,
      agentCount,
      state: "running",
    };
  }

  /**
   * Get current progress for a task.
   */
  getTaskProgress(taskId: string, requestedBy?: string): {
    taskId: string;
    state: TaskState;
    spaceId: string;
    progress: {
      turnsCompleted: number;
      turnsTotal: number;
      currentPhase: string;
      rootTurnId?: string;
      latestMessage?: string;
      finalSummaryText?: string;
    };
    taskDescription: string;
    agentTier: string;
    agentCount: number;
    topology: string;
    createdAt: string;
    completedAt: string | null;
    errorMessage: string;
  } | undefined {
    const record = this.taskRecordRepo.getById(taskId);
    if (!record) return undefined;
    if (requestedBy && record.requested_by !== requestedBy) return undefined;

    let progress = {
      turnsCompleted: 0,
      turnsTotal: record.max_turns,
      currentPhase: record.state,
      rootTurnId: undefined as string | undefined,
    };
    try {
      progress = JSON.parse(record.progress_json);
    } catch { /* use default */ }

    return {
      taskId: record.task_id,
      state: record.state,
      spaceId: record.space_id,
      progress,
      taskDescription: record.task_description,
      agentTier: record.agent_tier,
      agentCount: record.agent_count,
      topology: record.topology,
      createdAt: record.created_at,
      completedAt: record.completed_at,
      errorMessage: record.error_message,
    };
  }

  /**
   * List tasks for a principal.
   */
  listTasks(requestedBy: string, options?: { states?: TaskState[]; limit?: number }) {
    return this.taskRecordRepo.listByRequestedBy(requestedBy, options);
  }

  // -----------------------------------------------------------------------
  // Template resolution
  // -----------------------------------------------------------------------

  private resolveTemplate(input: OrchestrateTaskInput): {
    templateId: string;
    archetype: ArchetypeDefinition | undefined;
    templateConfig: Record<string, unknown> | undefined;
  } {
    // 1. Explicit templateId
    if (input.templateId) {
      const rev = this.spaceTemplateRepo.getActiveRevision(input.templateId);
      const config = rev ? safeParseJson(rev.space_config_json) : undefined;
      return { templateId: input.templateId, archetype: undefined, templateConfig: config };
    }

    // 2. Template hint → archetype match
    if (input.templateHint) {
      const archetype = resolveArchetypeHint(input.templateHint);
      if (archetype) {
        const templateId = `archetype/${archetype.id}`;
        const rev = this.spaceTemplateRepo.getActiveRevision(templateId);
        const config = rev ? safeParseJson(rev.space_config_json) : undefined;
        return { templateId, archetype, templateConfig: config };
      }

      // Try SpaceTemplate name fuzzy match
      const templates = this.spaceTemplateRepo.list();
      const hint = input.templateHint.toLowerCase();
      const match = templates.find((t) =>
        t.name.toLowerCase().includes(hint) ||
        t.description.toLowerCase().includes(hint),
      );
      if (match) {
        const rev = this.spaceTemplateRepo.getActiveRevision(match.template_id);
        const config = rev ? safeParseJson(rev.space_config_json) : undefined;
        return { templateId: match.template_id, archetype: undefined, templateConfig: config };
      }
    }

    // 3. Fallback to research archetype
    const archetype = resolveArchetypeHint("research")!;
    return { templateId: "archetype/research", archetype, templateConfig: undefined };
  }

  // -----------------------------------------------------------------------
  // Background execution
  // -----------------------------------------------------------------------

  /**
   * Create an event listener BEFORE executeTurn() so orchestrator summary
   * events emitted in the finally block are not missed.
   *
   * Events are buffered until `bindTurnId()` is called with the actual
   * rootTurnId, at which point buffered events matching that turnId are
   * replayed and future events are filtered normally.
   */
  private createEarlyOutcomeListener(input: {
    taskId: string;
    spaceId: string;
    topology: string;
    totalSteps: number;
  }): {
    promise: Promise<TaskOutcome>;
    bindTurnId: (turnId: string) => void;
    dispose: () => void;
  } {
    let boundTurnId: string | undefined;
    let settled = false;
    let turnsCompleted = 0;
    let resolvePromise: (outcome: TaskOutcome) => void;

    const promise = new Promise<TaskOutcome>((resolve) => {
      resolvePromise = resolve;
    });

    const bufferedOrchestratorEvents: Array<Record<string, unknown>> = [];
    const bufferedTurnEvents: Array<Record<string, unknown>> = [];

    const finish = (outcome: TaskOutcome) => {
      if (settled) return;
      settled = true;
      unsubOrchestrator();
      unsubTurn();
      resolvePromise(outcome);
    };

    const updateProgress = (currentPhase: string, latestMessage?: string) => {
      if (!boundTurnId) return;
      this.taskRecordRepo.update({
        taskId: input.taskId,
        progress: {
          turnsCompleted,
          turnsTotal: input.totalSteps,
          currentPhase,
          rootTurnId: boundTurnId,
          latestMessage,
        },
      });
      this.eventBus.emit({
        type: "task.progress",
        timestamp: new Date(),
        spaceId: input.spaceId,
        data: {
          taskId: input.taskId,
          progress: {
            turnsCompleted,
            turnsTotal: input.totalSteps,
            currentPhase,
          },
          message: latestMessage,
        },
      });
    };

    const processOrchestratorEvent = (event: Record<string, unknown>) => {
      const typed = event as {
        spaceId?: string;
        correlationId?: string;
        eventType?: string;
        event?: { summary?: { finalSummaryText?: string; failureReason?: string } };
      };
      if (typed.spaceId !== input.spaceId) return;
      if (typed.correlationId !== boundTurnId) return;
      if (typed.eventType === "summary.completed") {
        turnsCompleted = Math.max(turnsCompleted, 1);
        updateProgress("completed", typed.event?.summary?.finalSummaryText);
        finish({
          type: "completed",
          detail: typed.event?.summary?.finalSummaryText,
          turnsCompleted,
        });
        return;
      }
      if (typed.eventType === "summary.failed") {
        updateProgress("failed", typed.event?.summary?.failureReason ?? "Task orchestration failed");
        finish({
          type: "failed",
          detail: typed.event?.summary?.failureReason ?? "Task orchestration failed",
          turnsCompleted,
        });
      }
    };

    const processTurnEvent = (event: Record<string, unknown>) => {
      const typed = event as {
        spaceId?: string;
        turnId?: string;
        event?: {
          type?: string;
          text?: string;
          error?: { message?: string };
          request?: { description?: string };
          result?: { finalMessage?: { content?: string } };
        };
      };
      if (typed.spaceId !== input.spaceId) return;
      if (typed.turnId !== boundTurnId) return;
      const eventType = typed.event?.type ?? "";
      if (eventType === "text_delta") {
        updateProgress("executing", typeof typed.event?.text === "string" ? typed.event.text : undefined);
        return;
      }
      if (eventType === "turn_completed") {
        const finalMessage = typed.event?.result && typeof typed.event.result === "object" && typed.event.result
          && "finalMessage" in typed.event.result
          ? (typed.event.result as { finalMessage?: { content?: string } }).finalMessage?.content
          : undefined;
        turnsCompleted += 1;
        updateProgress(input.topology === "direct" ? "completed" : "executing", finalMessage);
        if (input.topology === "direct") {
          finish({ type: "completed", detail: finalMessage, turnsCompleted });
        }
        return;
      }
      if (eventType === "feedback_requested") {
        updateProgress("input-required", typed.event?.request?.description ?? "Task paused awaiting feedback");
        finish({
          type: "input_required",
          detail: typed.event?.request?.description ?? "Task paused awaiting feedback",
          turnsCompleted,
        });
        return;
      }
      if (eventType === "error") {
        updateProgress("failed", typed.event?.error?.message ?? "Task orchestration failed");
        finish({
          type: "failed",
          detail: typed.event?.error?.message ?? "Task orchestration failed",
          turnsCompleted,
        });
      }
    };

    const unsubOrchestrator = this.eventBus.on("space.orchestrator_event", (event) => {
      if (!boundTurnId) {
        bufferedOrchestratorEvents.push(event as Record<string, unknown>);
        return;
      }
      processOrchestratorEvent(event as Record<string, unknown>);
    });

    const unsubTurn = this.eventBus.on("space.turn_event", (event) => {
      if (!boundTurnId) {
        bufferedTurnEvents.push(event as Record<string, unknown>);
        return;
      }
      processTurnEvent(event as Record<string, unknown>);
    });

    const bindTurnId = (turnId: string) => {
      boundTurnId = turnId;
      // Replay buffered events now that we know the turnId
      for (const event of bufferedOrchestratorEvents) {
        if (settled) break;
        processOrchestratorEvent(event);
      }
      bufferedOrchestratorEvents.length = 0;
      for (const event of bufferedTurnEvents) {
        if (settled) break;
        processTurnEvent(event);
      }
      bufferedTurnEvents.length = 0;
    };

    const dispose = () => {
      if (settled) return;
      settled = true;
      unsubOrchestrator();
      unsubTurn();
      bufferedOrchestratorEvents.length = 0;
      bufferedTurnEvents.length = 0;
    };

    return { promise, bindTurnId, dispose };
  }

  /**
   * Monitor a pre-established outcome promise and update task records.
   */
  private async monitorOutcome(
    taskId: string,
    spaceId: string,
    input: OrchestrateTaskInput,
    rootTurnId: string,
    outcomePromise: Promise<TaskOutcome>,
  ): Promise<void> {
    const outcome = await outcomePromise;

    if (outcome.type === "completed") {
      this.taskRecordRepo.update({
        taskId,
        state: "completed",
        progress: {
          turnsCompleted: outcome.turnsCompleted,
          turnsTotal: input.maxTurns ?? 20,
          currentPhase: "completed",
          rootTurnId,
          finalSummaryText: outcome.detail,
        },
        errorMessage: "",
      });
      this.eventBus.emit({
        type: "task.completed",
        timestamp: new Date(),
        spaceId,
        data: {
          taskId,
          spaceId,
          taskDescription: input.taskDescription,
          requestedBy: input.requestedBy,
          finalSummaryText: outcome.detail,
        },
      });
      return;
    }

    if (outcome.type === "input_required") {
      this.taskRecordRepo.update({
        taskId,
        state: "input_required",
        progress: {
          turnsCompleted: outcome.turnsCompleted,
          turnsTotal: input.maxTurns ?? 20,
          currentPhase: "input-required",
          rootTurnId,
          latestMessage: outcome.detail,
        },
        errorMessage: "",
      });
      this.eventBus.emit({
        type: "task.input-required",
        timestamp: new Date(),
        spaceId,
        data: {
          taskId,
          spaceId,
          message: outcome.detail,
        },
      });
      return;
    }

    this.taskRecordRepo.update({
      taskId,
      state: "failed",
      progress: {
        turnsCompleted: outcome.turnsCompleted,
        turnsTotal: input.maxTurns ?? 20,
        currentPhase: "failed",
        rootTurnId,
        latestMessage: outcome.detail,
      },
      errorMessage: outcome.detail,
    });
    this.eventBus.emit({
      type: "task.failed",
      timestamp: new Date(),
      spaceId,
      data: {
        taskId,
        spaceId,
        error: outcome.detail,
      },
    });
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  private async ensureSpace(
    taskId: string,
    input: OrchestrateTaskInput,
    topology: string,
    archetype: ArchetypeDefinition | undefined,
  ): Promise<string> {
    const result = await this.spaceAdminService.createSpace({
      name: this.generateSpaceName(input.taskDescription),
      goal: input.taskDescription,
      resourceId: `task:${taskId}`,
      conversationTopology: topology as "direct" | "shared_team_chat" | "broadcast_team",
      turnModel: this.resolveTurnModel(topology, archetype) as TurnModelStrategy,
      turnModelConfig: archetype?.masterModeEnabled
        ? { strategy: this.resolveTurnModel(topology, archetype) as TurnModelStrategy, masterModeEnabled: true } as TurnModelConfig
        : undefined,
    });
    return result.id;
  }

  private async deployAgents(
    spaceId: string,
    taskDescription: string,
    agents: Array<{
      agentId: string;
      profileId: string;
      role: string;
      isPrimary: boolean;
      agentTier?: CapabilityTier;
    }>,
    requestedTier: CapabilityTier | undefined,
  ): Promise<void> {
    for (const agent of agents) {
      const profileId = this.resolveProfileIdForTier(
        agent.profileId,
        requestedTier ?? agent.agentTier ?? "standard",
      );
      if (!this.profileRepo.getById(profileId)) {
        continue;
      }
      try {
        await this.spaceAdminService.addAgent({
          spaceId,
          agentId: agent.agentId,
          profileId,
          role: agent.role as "participant" | "global_coordinator" | "space_moderator",
          isPrimary: agent.isPrimary,
          spawnContext: taskDescription,
        });
      } catch (error) {
        const code = typeof error === "object" && error && "code" in error
          ? String((error as { code?: unknown }).code)
          : "";
        if (code === "ALREADY_EXISTS") {
          continue;
        }
        throw error;
      }
    }
  }

  private generateSpaceName(description: string): string {
    const words = description.split(/\s+/).slice(0, 5).join(" ");
    return words.length > 50 ? words.substring(0, 47) + "..." : words;
  }

  private resolveTurnModel(
    topology: string,
    archetype: ArchetypeDefinition | undefined,
  ): string {
    if (archetype?.turnModel) return archetype.turnModel;
    switch (topology) {
      case "broadcast_team":
        return "primary_only";
      case "shared_team_chat":
        return "sequential_all";
      default:
        return "primary_only";
    }
  }

  private buildAgentAssignments(
    agentCount: number,
    requestedTier: CapabilityTier | undefined,
    topology: string,
    archetype: ArchetypeDefinition | undefined,
    templateConfig: Record<string, unknown> | undefined,
  ): Array<{ agentId: string; profileId: string; role: string; isPrimary: boolean; agentTier?: CapabilityTier }> {
    // Use template config agents if available
    if (templateConfig?.agents && Array.isArray(templateConfig.agents)) {
      const templateAgents = templateConfig.agents as Array<{
        agentId: string;
        profileId: string;
        role: string;
        isPrimary: boolean;
        agentTier?: CapabilityTier;
      }>;

      // Adjust count: keep coordinator, scale workers
      if (agentCount === templateAgents.length) {
        return templateAgents;
      }

      const coordinator = templateAgents.find((a) => a.role === "global_coordinator");
      const workers = templateAgents.filter((a) => a.role !== "global_coordinator");
      const targetWorkers = coordinator ? agentCount - 1 : agentCount;

      const result: typeof templateAgents = [];
      if (coordinator) result.push(coordinator);

      for (let i = 0; i < targetWorkers; i++) {
        const baseWorker = workers[i % workers.length];
        if (baseWorker) {
          result.push({
            ...baseWorker,
            agentId: i < workers.length ? baseWorker.agentId : `${baseWorker.agentId}-${i + 1}`,
            agentTier: requestedTier ?? baseWorker.agentTier,
          });
        }
      }

      return result;
    }

    // Fallback: build from archetype or defaults
    const agents: Array<{ agentId: string; profileId: string; role: string; isPrimary: boolean; agentTier?: CapabilityTier }> = [];

    if (topology === "broadcast_team") {
      // Coordinator + workers
      const coordProfileId = archetype
        ? `archetype/${archetype.id === "debate" ? "debate-synthesizer" : `${archetype.id}-coordinator`}`
        : "archetype/research-coordinator";

      agents.push({
        agentId: "coordinator",
        profileId: coordProfileId,
        role: "global_coordinator",
        isPrimary: true,
        agentTier: requestedTier ?? archetype?.coordinatorTier ?? "advanced",
      });

      const workerProfileId = archetype
        ? `archetype/${archetype.id === "debate" ? "debater" : archetype.id === "analysis" ? "analyst" : "researcher"}`
        : "archetype/researcher";

      for (let i = 0; i < agentCount - 1; i++) {
        agents.push({
          agentId: `worker-${i + 1}`,
          profileId: workerProfileId,
          role: "participant",
          isPrimary: false,
          agentTier: requestedTier ?? archetype?.workerTier ?? "standard",
        });
      }
    } else {
      // Shared team chat — all participants
      const profileId = archetype
        ? `archetype/${archetype.id === "coding" ? "developer" : "discussant"}`
        : "archetype/discussant";

      for (let i = 0; i < agentCount; i++) {
        agents.push({
          agentId: `agent-${i + 1}`,
          profileId,
          role: "participant",
          isPrimary: i === 0,
          agentTier: requestedTier ?? archetype?.workerTier ?? "standard",
        });
      }
    }

    return agents;
  }

  private resolveProfileIdForTier(baseProfileId: string, tier: CapabilityTier): string {
    const baseProfile = this.profileRepo.getById(baseProfileId);
    if (!baseProfile) return baseProfileId;

    const preferredTier = normalizeCapabilityTier(baseProfile.preferred_tier);
    if (preferredTier === tier) return baseProfileId;

    const revision = this.profileRepo.getActiveRevision(baseProfileId);
    if (!revision) return baseProfileId;

    const derivedProfileId = `${baseProfileId}::${tier}`;
    if (this.profileRepo.getById(derivedProfileId)) {
      return derivedProfileId;
    }

    const providerHints = resolveTierProviderHints(tier);
    const primaryProvider = providerHints.providers[0] ?? revision.provider_hint;
    const preferredModels = providerHints.providers
      .map((providerId) => providerHints.modelHints[providerId])
      .filter((value): value is string => typeof value === "string" && value.length > 0);
    const modelConfig: ProfileModelConfig | undefined = preferredModels.length > 0
      ? {
        preferredModels,
        constraints: { capabilityTier: tier },
      }
      : undefined;

    this.profileRepo.create({
      profileId: derivedProfileId,
      name: `${baseProfile.name} (${tier})`,
      description: baseProfile.description,
      personalityPrompt: revision.personality_prompt,
      defaultSkillIds: parseStringArray(revision.default_skill_set_ids_json),
      canModerate: baseProfile.can_moderate === 1,
      isDefault: false,
      providerHint: primaryProvider,
      modelHint: providerHints.modelHints[primaryProvider] ?? revision.model_hint,
      modelConfig,
      source: `task-orchestration-tier:${baseProfileId}`,
    });

    return derivedProfileId;
  }

}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function safeParseJson(json: string | null | undefined): Record<string, unknown> | undefined {
  if (!json) return undefined;
  try {
    return JSON.parse(json);
  } catch {
    return undefined;
  }
}

function parseStringArray(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
      : [];
  } catch {
    return [];
  }
}

function normalizeCapabilityTier(value: string | undefined): CapabilityTier | undefined {
  return value && isCapabilityTier(value) ? value : undefined;
}
