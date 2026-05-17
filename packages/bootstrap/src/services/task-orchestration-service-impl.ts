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
import { resolveArchetypeHint, isCapabilityTier } from "@spaceskit/core";
import type { CapabilityTier, ArchetypeDefinition } from "@spaceskit/core";
import type {
  TaskRecordRepository,
  TaskState,
  SpaceTemplateRepository,
} from "@spaceskit/persistence";
import {
  buildTaskAgentAssignments,
  createEarlyTaskOutcomeListener,
  generateTaskSpaceName,
  resolveProfileIdForTier,
  resolveTemplateForTask,
  resolveTurnModel,
  resolveTurnModelConfig,
  type TaskAgentAssignment,
  type TaskOrchestrationProfileRepository,
  type TaskOutcome,
} from "./task-orchestration-service-helpers.js";

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
  profileRepo: TaskOrchestrationProfileRepository;
  /**
   * Called when a task description is truncated to fit the configured
   * length budget. Receives the original and truncated lengths. Default
   * is silent — pass a logger.warn binding when you want telemetry.
   */
  onTaskDescriptionTruncated?: (info: { from: number; to: number }) => void;
}

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
    const resolved = resolveTemplateForTask(input, this.spaceTemplateRepo, resolveArchetypeHint);
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
    const agents = buildTaskAgentAssignments({
      agentCount,
      requestedTier,
      topology,
      archetype,
      templateConfig: resolved.templateConfig,
    });
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
    const outcomeListener = createEarlyTaskOutcomeListener({
      taskId,
      spaceId,
      topology,
      totalSteps: input.maxTurns ?? 20,
      taskRecordRepo: this.taskRecordRepo,
      eventBus: this.eventBus,
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
      turnModel: resolveTurnModel(topology, archetype),
      turnModelConfig: resolveTurnModelConfig(topology, archetype),
    });
    return result.id;
  }

  private async deployAgents(
    spaceId: string,
    taskDescription: string,
    agents: TaskAgentAssignment[],
    requestedTier: CapabilityTier | undefined,
  ): Promise<void> {
    for (const agent of agents) {
      const profileId = resolveProfileIdForTier({
        baseProfileId: agent.profileId,
        tier: requestedTier ?? agent.agentTier ?? "standard",
        profileRepo: this.profileRepo,
      });
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
    return generateTaskSpaceName(description);
  }

}
