/**
 * SpaceManager — orchestrates space lifecycle and agent execution.
 *
 * Manages the runtime state of active spaces. Each active space has:
 * - Its SpaceConfig (from database)
 * - An AgentRuntime per assigned agent
 * - Turn model orchestration (which agents respond, in what order)
 *
 * This is the core orchestration engine that makes spaces actually work.
 * It implements the 7 turn model strategies defined in the protocol.
 *
 * Security features:
 * - Per-space turn queue (concurrency control): only one turn executes
 *   per space at a time. Concurrent calls queue up and execute sequentially.
 * - Transaction boundaries: failed turns are sent to the dead letter queue
 *   for later inspection/retry.
 *
 * Stolen patterns:
 * - CrewAI: Sequential/hierarchical process orchestration
 * - Microsoft AF: Superstep-based parallel execution (maps to parallel_race)
 * - Spaceskit original: 7 turn models, feedback protocol, inter-agent calls
 */

import { randomUUID } from "node:crypto";
import type { EventBus } from "../events/event-bus.js";
import type {
  AgentRuntime,
  RuntimeApprovalSelection,
  RuntimeFeedbackCheckpoint,
  TurnContext,
  TurnEvent,
  TurnResult,
  CliLaunchSnapshot,
} from "../agents/agent-runtime.js";
import type {
  ModelMessage,
  ProviderSessionHandle,
} from "../agents/model-provider.js";
import type {
  ConversationTopology,
  SpaceConfig,
  SpaceState,
  SpaceAgentAssignment,
  TurnModelStrategy,
} from "./types.js";
import type { CheckpointManager } from "./checkpoint.js";
import type { DeadLetterQueue } from "./dead-letter.js";
import {
  renderTemplate,
  type MasterModePromptTemplates,
} from "./master-mode-prompts.js";
import type { ReflectionService } from "../reflection/reflection-service.js";
import type { OrchestratorSummaryTrace } from "./space-summary-trace.js";
import {
  normalizeAgentIdentifier,
  normalizeExecutionIdentity,
  normalizeOptionalString,
  type TurnExecutionIdentity,
} from "./space-manager-normalizers.js";
import {
  buildFallbackGuestInstruction,
  buildFallbackPlannerInstructions,
  buildRevisionFeedback,
  buildRingPeerReviewAssignments,
  checkMasterModeConvergence,
  formatGuestList,
  formatGuestReports,
  formatPeerReviewResults,
  parsePeerReviewResult,
  parsePlannerInstructions,
  parseSlashPlannerDirectives,
  resolveMasterFlowAssignments,
  resolveMasterModePromptTemplates,
  resolvePeerReviewEnabled,
  resolvePeerReviewTopology,
  shouldUseMasterMode,
  type GuestReport,
  type MasterFlowAssignments,
  type PeerReviewResult,
  type PlannerInstructions,
  type PlannerPhaseResult,
} from "./space-manager-master-mode-helpers.js";
import {
  resolveTurnScopedSpace,
  selectAgents,
} from "./space-manager-turn-routing.js";
import {
  appendRedactedOrchestrationJournalEntry,
  type OrchestrationJournalEntry,
} from "./space-manager-orchestration-journal.js";
import { buildCompletedSaveTurnInput } from "./space-manager-turn-records.js";
import {
  createSpaceManagerSummaryTrace,
  emitSpaceManagerSummaryEvent,
  recordSpaceManagerSummaryEvent,
} from "./space-manager-summary-events.js";
import {
  buildLaunchSnapshots as buildAgentLaunchSnapshots,
  ensureActiveSpace,
  getActiveSpaceState as getAgentSessionStateSnapshot,
  getOrCreateAgentSession as getOrCreateAgentSessionState,
  getRuntimeForAgent,
  restoreActiveSpaceFromCheckpoint,
  resolveCommittedSessionFields as resolveAgentCommittedSessionFields,
  updateAgentSession as updateAgentSessionState,
  type ActiveSpace,
  type AgentSessionRuntimeMetadata,
  type AgentSessionState,
  type RestoreAgentSessionCheckpointInput,
  type SaveAgentSessionRuntimeMetadataInput,
} from "./space-manager-agent-sessions.js";

export type { TurnExecutionIdentity } from "./space-manager-normalizers.js";
export type {
  AgentSessionRuntimeMetadata,
  SaveAgentSessionRuntimeMetadataInput,
} from "./space-manager-agent-sessions.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SpaceManagerOptions {
  eventBus: EventBus;
  /** Load a space config by ID. */
  loadSpaceConfig: (spaceId: string) => Promise<SpaceConfig | null>;
  /** Update space status in persistence. */
  updateSpaceStatus: (spaceId: string, status: SpaceState) => Promise<void>;
  /** Save a completed turn to persistence. */
  saveTurn: (turn: SaveTurnInput) => Promise<void>;
  /** Load conversation history for a space. */
  loadHistory: (spaceId: string, limit?: number) => Promise<ModelMessage[]>;
  /** Optional per-agent history loader for agent session continuity. */
  loadAgentHistory?: (spaceId: string, agentId: string, limit?: number) => Promise<ModelMessage[]>;
  /** Optional per-agent runtime metadata loader for provider-native session continuity. */
  loadAgentSessionMetadata?: (
    spaceId: string,
    agentId: string,
  ) => Promise<AgentSessionRuntimeMetadata | undefined> | AgentSessionRuntimeMetadata | undefined;
  /** Optional per-agent runtime metadata persistence hook. */
  saveAgentSessionMetadata?: (metadata: SaveAgentSessionRuntimeMetadataInput) => Promise<void> | void;
  /** Resolve (or create) an AgentRuntime for an agent in a space. */
  resolveRuntime: (spaceId: string, agentId: string) => Promise<AgentRuntime>;
  /** Optional checkpoint manager for crash recovery. */
  checkpointManager?: CheckpointManager;
  /** Optional dead letter queue for failed turns. */
  deadLetterQueue?: DeadLetterQueue;
  /** Timeout in ms for human feedback before auto-rejecting. Default: 300000 (5 min). */
  feedbackTimeoutMs?: number;
  /** Global toggle for coordinator-led master orchestration mode. Default: true. */
  masterModeEnabled?: boolean;
  /** Prompt template for the master planner phase. */
  masterPlannerPromptTemplate?: string;
  /** Prompt template used for each guest agent turn. */
  guestAgentPromptTemplate?: string;
  /** Prompt template for peer-review turns in master mode. */
  peerReviewPromptTemplate?: string;
  /** Prompt template for the master synthesis phase. */
  masterSynthesisPromptTemplate?: string;
  /** Maximum number of agent-to-agent hops permitted in a single delegation chain. Default: 5. */
  maxHops?: number;
  /** Persist one redacted orchestration journal event (best-effort). */
  appendOrchestrationJournalEntry?: (entry: {
    spaceId: string;
    turnId: string;
    eventType: string;
    actorId: string;
    lineageId?: string;
    hopCount?: number;
    payload: Record<string, unknown>;
  }) => Promise<void>;
  /** Optional metric hook for orchestration counters. */
  recordOrchestrationMetric?: (metric: {
    name: string;
    value: number;
    tags?: Record<string, string>;
  }) => void;
  /** Optional hook to persist approval selections before a paused runtime resumes. */
  handleFeedbackResolution?: (input: {
    spaceId: string;
    turnId: string;
    request?: RuntimeFeedbackCheckpoint;
    response: "approve" | "reject" | "revise" | "defer";
    revision?: string;
    approvalGrant?: RuntimeApprovalSelection;
    principalId?: string;
    deviceId?: string;
  }) => Promise<void> | void;
  /** Optional reflection service for summary generation. */
  reflectionService?: Pick<ReflectionService, "runSummaryJob">;
}

export interface SaveTurnInput {
  turnId: string;
  userTurnId?: string;
  replyToTurnId?: string;
  conversationTopology?: ConversationTopology;
  spaceId: string;
  agentId: string;
  input: string;
  output: string;
  status: "completed" | "failed";
  promptTokens: number;
  completionTokens: number;
  /** Original totalTokens from the provider (may differ from promptTokens + completionTokens). */
  totalTokens: number;
}

// ---------------------------------------------------------------------------
// SpaceManager
// ---------------------------------------------------------------------------

export class SpaceManager {
  private activeSpaces = new Map<string, ActiveSpace>();
  private eventBus: EventBus;
  private options: SpaceManagerOptions;

  /**
   * Per-space turn lock. Each space has a promise chain that ensures
   * turns execute sequentially. A new turn chains onto the existing
   * promise, guaranteeing mutual exclusion without blocking the event loop.
   */
  private turnLocks = new Map<string, Promise<void>>();

  constructor(options: SpaceManagerOptions) {
    this.eventBus = options.eventBus;
    this.options = options;
  }

  /** Invalidate cached space config so next turn re-loads from persistence. */
  invalidateCache(spaceId: string): void {
    this.deactivate(spaceId);
  }

  /**
   * Invalidate only the space config so it's reloaded on the next turn,
   * but preserve agent sessions and runtimes for continuity.
   */
  invalidateConfig(spaceId: string): void {
    const active = this.activeSpaces.get(spaceId);
    if (active) {
      active.configStale = true;
    }
  }

  /** Drop one cached agent session so the next turn reloads from the active persistence boundary. */
  resetAgentSession(spaceId: string, agentId: string): void {
    const active = this.activeSpaces.get(spaceId);
    active?.agentSessions.delete(agentId);
  }

  /**
   * Pre-warm a space by loading its config and agent sessions into cache.
   * This is a best-effort operation — errors are silently ignored.
   * Useful for warming during subscription before the first turn.
   */
  async preWarmSpace(spaceId: string, targetAgentId?: string): Promise<void> {
    try {
      const space = await this.ensureActive(spaceId);
      // Optionally pre-load a specific agent's session and runtime
      if (targetAgentId) {
        await this.getRuntime(space, targetAgentId);
        await this.getOrCreateAgentSession(space, targetAgentId);
      }
    } catch {
      // Pre-warming is best-effort
    }
  }

  /**
   * Execute a turn in a space. Determines which agent(s) should
   * respond based on the turn model strategy.
   *
   * Turns are serialized per-space using a promise chain lock.
   * Concurrent calls to executeTurn for the same space will queue
   * and execute in order.
   */
  async executeTurn(
    spaceId: string,
    input: string,
    targetAgentId?: string,
    executionIdentity?: TurnExecutionIdentity,
  ): Promise<{ turnId: string }> {
    const turnId = randomUUID();
    const normalizedExecutionIdentity = normalizeExecutionIdentity(executionIdentity);

    // Start loading space config + sessions in parallel with waiting for the lock.
    // If the lock wait is longer than the load time, the space is already warm
    // by the time executeTurnInternal runs.
    const warmup = this.preWarmSpace(spaceId, targetAgentId);

    // Chain onto the per-space lock to ensure sequential execution
    const prevLock = this.turnLocks.get(spaceId) ?? Promise.resolve();
    const currentExecution = prevLock.then(async () => {
      await warmup; // Already resolved if lock wait > load time
      return this.executeTurnInternal(
        spaceId,
        turnId,
        input,
        targetAgentId,
        normalizedExecutionIdentity,
      );
    });

    // Store the current execution as the new lock (swallow errors so
    // the chain doesn't break for subsequent turns)
    this.turnLocks.set(
      spaceId,
      currentExecution.catch(() => {}),
    );

    // We return immediately with the turnId — the caller can listen
    // on the EventBus for results. But we still need to handle errors.
    currentExecution.catch((err) => {
      this.handleTurnError(spaceId, turnId, input, err);
    });

    return { turnId };
  }

  /**
   * Internal turn execution — runs under the per-space lock.
   */
  private async executeTurnInternal(
    spaceId: string,
    turnId: string,
    input: string,
    targetAgentId?: string,
    executionIdentity?: TurnExecutionIdentity,
  ): Promise<void> {
    const space = await this.ensureActive(spaceId);
    const turnSpace = resolveTurnScopedSpace(space, targetAgentId, executionIdentity);
    const userMessage: ModelMessage = { role: "user", content: input };

    const strategy = turnSpace.config.turnModel;
    const targetingSingleAgent = normalizeAgentIdentifier(targetAgentId) !== undefined
      || turnSpace.config.agents.length === 1;
    const masterFlow = !targetingSingleAgent && shouldUseMasterMode(turnSpace, this.options.masterModeEnabled)
      ? resolveMasterFlowAssignments(turnSpace)
      : null;
    const agents = masterFlow
      ? [masterFlow.master, ...masterFlow.guests]
      : selectAgents(turnSpace, targetAgentId);

    if (agents.length === 0) {
      throw new Error(
        `No agents available in space ${spaceId}${targetAgentId ? ` matching target ${targetAgentId}` : ""}`,
      );
    }

    const launchSnapshots = await this.buildLaunchSnapshots(turnSpace, turnId, agents, userMessage, executionIdentity);

    for (const snap of launchSnapshots) {
      console.info(`[space:${spaceId}] [turn:${turnId}] agent=${snap.agentId} provider=${snap.providerId} model=${snap.modelId}`);
    }

    // Emit space event
    this.eventBus.emit({
      type: "space.turn_started",
      spaceId,
      turnId,
      input,
      agents: agents.map((a) => a.agentId),
      launchSnapshots,
      data: { launchSnapshots },
      requestedByPrincipalId: executionIdentity?.principalId,
      timestamp: new Date(),
    });

    const summaryTrace = this.createSummaryTrace(turnSpace, turnId, input, strategy, agents);
    let executionError: unknown;

    try {
      if (masterFlow) {
        await this.executeMasterMode(
          turnSpace,
          turnId,
          userMessage,
          masterFlow,
          executionIdentity,
          summaryTrace,
        );
      } else if (strategy === "parallel_race") {
        await this.executeParallelRace(
          turnSpace,
          turnId,
          agents,
          userMessage,
          executionIdentity,
          summaryTrace,
        );
      } else if (strategy === "debate_synthesis") {
        await this.executeDebateSynthesis(
          turnSpace,
          turnId,
          agents,
          userMessage,
          executionIdentity,
          summaryTrace,
        );
      } else {
        await this.executeSequential(
          turnSpace,
          turnId,
          agents,
          userMessage,
          strategy,
          executionIdentity,
          summaryTrace,
        );
      }
    } catch (error) {
      executionError = error;
      throw error;
    } finally {
      this.emitSummaryEvent(turnSpace.config.id, turnId, summaryTrace, executionError);
    }
  }

  /**
   * Handle a turn execution error:
   * 1. Enqueue to dead letter queue (if available) for later retry/inspection
   * 2. Emit error event
   */
  private handleTurnError(
    spaceId: string,
    turnId: string,
    input: string,
    err: unknown,
  ): void {
    const error = err instanceof Error ? err : new Error(String(err));

    // Enqueue to dead letter queue for crash recovery
    if (this.options.deadLetterQueue) {
      this.options.deadLetterQueue.enqueue({
        turnId,
        spaceId,
        agentId: "unknown",
        input,
        error,
      }).catch((dlqErr) => {
        // DLQ write failure should not mask the original error
        console.error("Failed to enqueue to dead letter queue:", dlqErr);
      });
    }

    this.eventBus.emit({
      type: "space.turn_event",
      spaceId,
      turnId,
      event: {
        type: "error",
        error,
      },
      timestamp: new Date(),
    });
  }

  /**
   * Resume a paused turn after feedback.
   */
  async resumeFeedback(
    spaceId: string,
    turnId: string,
    response: "approve" | "reject" | "revise" | "defer",
    revision?: string,
    options?: {
      approvalGrant?: RuntimeApprovalSelection;
      principalId?: string;
      deviceId?: string;
    },
  ): Promise<void> {
    const space = this.activeSpaces.get(spaceId);
    if (!space) throw new Error(`Space ${spaceId} not active`);

    const runtime = space.pausedRuntimes.get(turnId);
    if (!runtime) throw new Error(`No paused turn ${turnId} in space ${spaceId}`);
    const pausedAgentId = space.pausedRuntimeAgentIds.get(turnId);
    const pausedRequest = space.pausedFeedbackRequests.get(turnId);

    space.pausedRuntimes.delete(turnId);
    space.pausedRuntimeAgentIds.delete(turnId);
    space.pausedFeedbackRequests.delete(turnId);

    // Clear feedback timeout timer
    const timer = space.feedbackTimers.get(turnId);
    if (timer) {
      clearTimeout(timer);
      space.feedbackTimers.delete(turnId);
    }

    await this.options.handleFeedbackResolution?.({
      spaceId,
      turnId,
      request: pausedRequest,
      response,
      revision,
      approvalGrant: options?.approvalGrant,
      principalId: options?.principalId,
      deviceId: options?.deviceId,
    });

    // Resume — events will flow through the original generator
    for await (const event of runtime.resumeWithFeedback(turnId, response, revision)) {
      this.forwardEvent(spaceId, turnId, event, pausedAgentId);
    }
  }

  /**
   * Cancel an active or paused turn.
   * Returns true if the turn was found and cancelled, false otherwise.
   */
  async cancelTurn(spaceId: string, turnId: string): Promise<boolean> {
    const space = this.activeSpaces.get(spaceId);
    if (!space) return false;

    // Check active (executing) turns first
    const activeRuntime = space.activeTurnRuntimes.get(turnId);
    if (activeRuntime) {
      await activeRuntime.cancel();
      space.activeTurnRuntimes.delete(turnId);
      this.eventBus.emit({
        type: "space.turn_event",
        spaceId,
        turnId,
        event: { type: "turn_cancelled" },
        timestamp: new Date(),
      });
      return true;
    }

    // Check paused (awaiting feedback) turns
    const pausedRuntime = space.pausedRuntimes.get(turnId);
    if (pausedRuntime) {
      await pausedRuntime.cancel();
      space.pausedRuntimes.delete(turnId);
      space.pausedRuntimeAgentIds.delete(turnId);
      space.pausedFeedbackRequests.delete(turnId);
      const timer = space.feedbackTimers.get(turnId);
      if (timer) {
        clearTimeout(timer);
        space.feedbackTimers.delete(turnId);
      }
      this.eventBus.emit({
        type: "space.turn_event",
        spaceId,
        turnId,
        event: { type: "turn_cancelled" },
        timestamp: new Date(),
      });
      return true;
    }

    return false;
  }

  // ---------------------------------------------------------------------------
  // Turn model implementations
  // ---------------------------------------------------------------------------

  /**
   * Sequential execution: run agents one at a time.
   * Covers: sequential_all, primary_only, first_success, round_robin.
   */
  private async executeSequential(
    space: ActiveSpace,
    turnId: string,
    agents: SpaceAgentAssignment[],
    userMessage: ModelMessage,
    strategy: TurnModelStrategy,
    executionIdentity?: TurnExecutionIdentity,
    summaryTrace?: OrchestratorSummaryTrace | null,
  ): Promise<void> {
    const turnHistory: ModelMessage[] = [userMessage];

    for (const assignment of agents) {
      const runtime = await this.getRuntime(space, assignment.agentId);
      const session = await this.getOrCreateAgentSession(space, assignment.agentId);

      const context: TurnContext = {
        spaceId: space.config.id,
        turnId,
        messages: [...session.messages, ...turnHistory],
        lineageId: randomUUID(),
        hopCount: 0,
        maxHops: this.options.maxHops ?? 5,
        principalId: executionIdentity?.principalId,
        deviceId: executionIdentity?.deviceId,
        executionOrigin: executionIdentity?.executionOrigin,
        accessMode: executionIdentity?.accessMode,
        mode: executionIdentity?.mode,
        effort: executionIdentity?.effort,
        ...(await this.resolveCommittedSessionFields(space, session, userMessage)),
      };

      let result: TurnResult | null = null;
      space.activeTurnRuntimes.set(turnId, runtime);

      try {
      for await (const event of runtime.executeTurn(context)) {
        this.recordSummaryEvent(summaryTrace, assignment.agentId, event);
        this.forwardEvent(space.config.id, turnId, event, assignment.agentId);

        if (event.type === "feedback_requested") {
          space.activeTurnRuntimes.delete(turnId);
          space.pausedRuntimes.set(turnId, runtime);
          space.pausedRuntimeAgentIds.set(turnId, assignment.agentId);
          space.pausedFeedbackRequests.set(turnId, event.request);
          this.startFeedbackTimeout(space.config.id, turnId);
          await this.options.updateSpaceStatus(space.config.id, "paused");
          return; // Execution paused
        }

        if (event.type === "turn_completed") {
          result = event.result;
        }
      }
      } finally {
        space.activeTurnRuntimes.delete(turnId);
      }

      if (result) {
        // Save turn — fire-and-forget with dead letter queue fallback
        this.updateAgentSession(session, turnId, userMessage, result.finalMessage, {
          spaceId: space.config.id,
          providerSessionHandle: result.metadata?.providerSessionHandle,
        });
        this.options.saveTurn(buildCompletedSaveTurnInput({
          turnId,
          spaceId: space.config.id,
          agentId: assignment.agentId,
          userMessage,
          result,
        })).catch((saveErr) => {
          this.handleTurnError(space.config.id, turnId, userMessage.content, saveErr);
        });

        // For first_success, stop after first successful completion
        if (strategy === "first_success") break;

        // Append result to history for next agent in sequence
        turnHistory.push(result.finalMessage);
      }
    }
  }

  private async executeMasterMode(
    space: ActiveSpace,
    turnId: string,
    userMessage: ModelMessage,
    assignments: MasterFlowAssignments,
    executionIdentity?: TurnExecutionIdentity,
    summaryTrace?: OrchestratorSummaryTrace | null,
  ): Promise<void> {
    const promptTemplates = resolveMasterModePromptTemplates(space, {
      masterPlannerPromptTemplate: this.options.masterPlannerPromptTemplate,
      guestAgentPromptTemplate: this.options.guestAgentPromptTemplate,
      peerReviewPromptTemplate: this.options.peerReviewPromptTemplate,
      masterSynthesisPromptTemplate: this.options.masterSynthesisPromptTemplate,
    });
    await this.appendOrchestrationJournalEntry({
      spaceId: space.config.id,
      turnId,
      eventType: "planner.input",
      actorId: assignments.master.agentId,
      payload: {
        userInput: userMessage.content,
        guestAgentIds: assignments.guests.map((guest) => guest.agentId),
      },
    });

    const plannerPhase = await this.runMasterPlannerPhase(
      space,
      turnId,
      userMessage,
      assignments,
      promptTemplates,
      executionIdentity,
    );
    const plannerInstructions = plannerPhase.instructions;
    await this.appendOrchestrationJournalEntry({
      spaceId: space.config.id,
      turnId,
      eventType: "planner.output",
      actorId: assignments.master.agentId,
      payload: {
        source: plannerPhase.source,
        fallbackReason: plannerPhase.fallbackReason,
        globalInstruction: plannerInstructions.globalInstruction,
        guestInstructions: Object.fromEntries(plannerInstructions.guestInstructions.entries()),
      },
    });
    if (plannerPhase.source === "fallback") {
      this.recordOrchestrationMetric("planner_fallback_total", 1, {
        spaceId: space.config.id,
      });
    }

    // ---------------------------------------------------------------------------
    // Convergence loop: guest execution + peer review, up to maxIterations.
    // Each iteration re-runs guests with revision feedback if peer review
    // did not converge. Converges when all reviews approve with average
    // confidence >= threshold, or when iterations are exhausted.
    // ---------------------------------------------------------------------------
    const maxIterations = space.config.turnModelConfig?.masterModeMaxIterations ?? 1;
    const convergenceThreshold = space.config.turnModelConfig?.masterModeConvergenceThreshold ?? 0.8;
    const tokenBudget = space.config.turnModelConfig?.maxTokenBudget ?? 0;
    let totalTokensUsed = 0;

    let guestReports: GuestReport[] = [];
    let peerReviewResults: Awaited<ReturnType<typeof this.runPeerReviewRing>> = {
      results: [],
      assignments: 0,
      completed: 0,
      failed: 0,
      status: "skipped",
    };
    let revisionFeedback: string | undefined;

    for (let iteration = 0; iteration < maxIterations; iteration++) {
      guestReports = [];

      for (const guest of assignments.guests) {
        const runtime = await this.getRuntime(space, guest.agentId);
        const session = await this.getOrCreateAgentSession(space, guest.agentId);
        const delegatedInstruction = plannerInstructions.guestInstructions.get(guest.agentId)
          ?? buildFallbackGuestInstruction(guest.agentId);
        const guestPrompt = renderTemplate(
          promptTemplates.guest,
          {
            user_input: userMessage.content,
            guest_agent_id: guest.agentId,
            guest_list: formatGuestList(assignments.guests),
            guest_reports: "",
            global_instruction: plannerInstructions.globalInstruction,
            guest_instruction: delegatedInstruction,
          },
        );
        await this.appendOrchestrationJournalEntry({
          spaceId: space.config.id,
          turnId,
          eventType: "guest.dispatch",
          actorId: guest.agentId,
          payload: {
            iteration,
            delegatedInstruction,
            globalInstruction: plannerInstructions.globalInstruction,
            revisionFeedback: revisionFeedback ?? null,
          },
        });

        // Build messages: include revision feedback from prior iteration if available (Layer 4 turn context).
        const guestMessages: ModelMessage[] = [
          ...session.messages,
          userMessage,
        ];
        if (revisionFeedback) {
          guestMessages.push({
            role: "system",
            content: `Revision feedback from peer review (iteration ${iteration}):\n${revisionFeedback}`,
          });
        }
        guestMessages.push({ role: "user", content: guestPrompt });

        const context: TurnContext = {
          spaceId: space.config.id,
          turnId,
          messages: guestMessages,
          lineageId: randomUUID(),
          hopCount: 0,
          maxHops: this.options.maxHops ?? 5,
          principalId: executionIdentity?.principalId,
          deviceId: executionIdentity?.deviceId,
          executionOrigin: executionIdentity?.executionOrigin,
          accessMode: executionIdentity?.accessMode,
          mode: executionIdentity?.mode,
          effort: executionIdentity?.effort,
          ...(await this.resolveCommittedSessionFields(space, session, userMessage)),
        };

        let result: TurnResult | null = null;
        let guestFailed = false;

        try {
          for await (const event of runtime.executeTurn(context)) {
            this.recordSummaryEvent(summaryTrace, guest.agentId, event);
            this.forwardEvent(space.config.id, turnId, event, guest.agentId);

            if (event.type === "feedback_requested") {
              space.pausedRuntimes.set(turnId, runtime);
              space.pausedRuntimeAgentIds.set(turnId, guest.agentId);
              space.pausedFeedbackRequests.set(turnId, event.request);
              this.startFeedbackTimeout(space.config.id, turnId);
              await this.options.updateSpaceStatus(space.config.id, "paused");
              return; // Execution paused
            }

            if (event.type === "turn_completed") {
              result = event.result;
            }
          }
        } catch (error) {
          guestFailed = true;
          const normalized = error instanceof Error ? error : new Error(String(error));
          const errorEvent: TurnEvent = { type: "error", error: normalized };
          this.recordSummaryEvent(summaryTrace, guest.agentId, errorEvent);
          this.forwardEvent(space.config.id, turnId, errorEvent, guest.agentId);
          guestReports.push({
            agentId: guest.agentId,
            status: "failed",
            report: normalized.message,
          });
          await this.appendOrchestrationJournalEntry({
            spaceId: space.config.id,
            turnId,
            eventType: "failure",
            actorId: guest.agentId,
            payload: {
              phase: "guest_execution",
              iteration,
              error: normalized.message,
            },
          });
        }

        if (result) {
          totalTokensUsed += result.usage.totalTokens;
          this.updateAgentSession(session, turnId, userMessage, result.finalMessage, {
            spaceId: space.config.id,
            providerSessionHandle: result.metadata?.providerSessionHandle,
          });
          this.options.saveTurn(buildCompletedSaveTurnInput({
            turnId,
            spaceId: space.config.id,
            agentId: guest.agentId,
            userMessage,
            result,
          })).catch((saveErr) => {
            this.handleTurnError(space.config.id, turnId, userMessage.content, saveErr);
          });
          guestReports.push({
            agentId: guest.agentId,
            status: "completed",
            report: result.finalMessage.content,
          });
          await this.appendOrchestrationJournalEntry({
            spaceId: space.config.id,
            turnId,
            eventType: "guest.report",
            actorId: guest.agentId,
            payload: {
              status: "completed",
              iteration,
              report: result.finalMessage.content,
            },
          });
        } else if (!guestFailed) {
          const noResultError = new Error(`Guest agent ${guest.agentId} did not return a completion result.`);
          const errorEvent: TurnEvent = { type: "error", error: noResultError };
          this.recordSummaryEvent(summaryTrace, guest.agentId, errorEvent);
          this.forwardEvent(space.config.id, turnId, errorEvent, guest.agentId);
          guestReports.push({
            agentId: guest.agentId,
            status: "failed",
            report: noResultError.message,
          });
          await this.appendOrchestrationJournalEntry({
            spaceId: space.config.id,
            turnId,
            eventType: "guest.report",
            actorId: guest.agentId,
            payload: {
              status: "failed",
              iteration,
              report: noResultError.message,
            },
          });
        }
      }

      // Run peer review
      peerReviewResults = await this.runPeerReviewRing(
        space,
        turnId,
        userMessage,
        assignments,
        guestReports,
        plannerInstructions,
        promptTemplates,
        executionIdentity,
      );
      // Check convergence
      const converged = checkMasterModeConvergence(peerReviewResults.results, convergenceThreshold);
      const budgetExhausted = tokenBudget > 0 && totalTokensUsed >= tokenBudget * 0.8;

      await this.appendOrchestrationJournalEntry({
        spaceId: space.config.id,
        turnId,
        eventType: "convergence.check",
        actorId: assignments.master.agentId,
        payload: {
          iteration,
          converged,
          budgetExhausted,
          totalTokensUsed,
          tokenBudget: tokenBudget || "unlimited",
        },
      });

      if (converged || budgetExhausted || iteration >= maxIterations - 1) {
        break;
      }

      // Build revision feedback for next iteration from peer review issues
      revisionFeedback = buildRevisionFeedback(peerReviewResults.results);
    }

    const peerReviewEnabled = resolvePeerReviewEnabled(space);
    const peerReviewTopology = resolvePeerReviewTopology(space);
    if (summaryTrace) {
      summaryTrace.peerReview.enabled = peerReviewEnabled;
      summaryTrace.peerReview.topology = peerReviewTopology;
      summaryTrace.peerReview.assignments = peerReviewResults.assignments;
      summaryTrace.peerReview.completed = peerReviewResults.completed;
      summaryTrace.peerReview.failed = peerReviewResults.failed;
      summaryTrace.peerReview.status = peerReviewResults.status;
      summaryTrace.peerReview.failureReason = peerReviewResults.failureReason;
    }
    this.recordOrchestrationMetric("peer_review_completion_total", peerReviewResults.completed, {
      spaceId: space.config.id,
    });
    if (peerReviewResults.failed > 0) {
      this.recordOrchestrationMetric("peer_review_failure_total", peerReviewResults.failed, {
        spaceId: space.config.id,
      });
    }

    const masterRuntime = await this.getRuntime(space, assignments.master.agentId);
    const masterSession = await this.getOrCreateAgentSession(space, assignments.master.agentId);
    const synthesisPrompt = renderTemplate(
      promptTemplates.synthesis,
      {
        user_input: userMessage.content,
        guest_agent_id: assignments.master.agentId,
        guest_list: formatGuestList(assignments.guests),
        guest_reports: formatGuestReports(guestReports),
        peer_review_results: formatPeerReviewResults(peerReviewResults.results),
        global_instruction: plannerInstructions.globalInstruction,
        guest_instruction: "",
      },
    );
    await this.appendOrchestrationJournalEntry({
      spaceId: space.config.id,
      turnId,
      eventType: "synthesis.dispatch",
      actorId: assignments.master.agentId,
      payload: {
        globalInstruction: plannerInstructions.globalInstruction,
        guestReports: formatGuestReports(guestReports),
        peerReviewResults: formatPeerReviewResults(peerReviewResults.results),
      },
    });
    const synthesisContext: TurnContext = {
      spaceId: space.config.id,
      turnId,
      messages: [
        ...masterSession.messages,
        userMessage,
        { role: "user", content: synthesisPrompt },
      ],
      lineageId: randomUUID(),
      hopCount: 0,
      maxHops: this.options.maxHops ?? 5,
      principalId: executionIdentity?.principalId,
      deviceId: executionIdentity?.deviceId,
      executionOrigin: executionIdentity?.executionOrigin,
      accessMode: executionIdentity?.accessMode,
      mode: executionIdentity?.mode,
      effort: executionIdentity?.effort,
      ...(await this.resolveCommittedSessionFields(space, masterSession, userMessage)),
    };

    let synthesisResult: TurnResult | null = null;
    for await (const event of masterRuntime.executeTurn(synthesisContext)) {
      this.recordSummaryEvent(summaryTrace, assignments.master.agentId, event);
      this.forwardEvent(space.config.id, turnId, event, assignments.master.agentId);

      if (event.type === "feedback_requested") {
        space.pausedRuntimes.set(turnId, masterRuntime);
        space.pausedRuntimeAgentIds.set(turnId, assignments.master.agentId);
        space.pausedFeedbackRequests.set(turnId, event.request);
        this.startFeedbackTimeout(space.config.id, turnId);
        await this.options.updateSpaceStatus(space.config.id, "paused");
        return; // Execution paused
      }

      if (event.type === "turn_completed") {
        synthesisResult = event.result;
      }
    }

    if (!synthesisResult) {
      await this.appendOrchestrationJournalEntry({
        spaceId: space.config.id,
        turnId,
        eventType: "failure",
        actorId: assignments.master.agentId,
        payload: {
          phase: "synthesis_execution",
          error: "Master synthesis phase completed without a final result.",
        },
      });
      throw new Error("Master synthesis phase completed without a final result.");
    }

    this.updateAgentSession(masterSession, turnId, userMessage, synthesisResult.finalMessage, {
      spaceId: space.config.id,
      providerSessionHandle: synthesisResult.metadata?.providerSessionHandle,
    });
    this.options.saveTurn(buildCompletedSaveTurnInput({
      turnId,
      spaceId: space.config.id,
      agentId: assignments.master.agentId,
      userMessage,
      result: synthesisResult,
    })).catch((saveErr) => {
      this.handleTurnError(space.config.id, turnId, userMessage.content, saveErr);
    });
    await this.appendOrchestrationJournalEntry({
      spaceId: space.config.id,
      turnId,
      eventType: "synthesis.result",
      actorId: assignments.master.agentId,
      payload: {
        output: synthesisResult.finalMessage.content,
      },
    });
  }

  private async runMasterPlannerPhase(
    space: ActiveSpace,
    turnId: string,
    userMessage: ModelMessage,
    assignments: MasterFlowAssignments,
    promptTemplates: MasterModePromptTemplates,
    executionIdentity?: TurnExecutionIdentity,
  ): Promise<PlannerPhaseResult> {
    const fallback = buildFallbackPlannerInstructions(assignments.guests, userMessage.content);
    const slashInstructions = parseSlashPlannerDirectives(userMessage.content, assignments.guests);
    if (slashInstructions) {
      return {
        instructions: slashInstructions,
        source: "slash",
      };
    }

    const runtime = await this.getRuntime(space, assignments.master.agentId);
    const session = await this.getOrCreateAgentSession(space, assignments.master.agentId);
    const plannerPrompt = renderTemplate(
      promptTemplates.planner,
      {
        user_input: userMessage.content,
        guest_agent_id: assignments.master.agentId,
        guest_list: formatGuestList(assignments.guests),
        guest_reports: "",
        global_instruction: "",
        guest_instruction: "",
      },
    );
    const plannerContext: TurnContext = {
      spaceId: space.config.id,
      turnId,
      messages: [
        ...session.messages,
        userMessage,
        { role: "user", content: plannerPrompt },
      ],
      lineageId: randomUUID(),
      hopCount: 0,
      maxHops: this.options.maxHops ?? 5,
      principalId: executionIdentity?.principalId,
      deviceId: executionIdentity?.deviceId,
      executionOrigin: executionIdentity?.executionOrigin,
      accessMode: executionIdentity?.accessMode,
      mode: executionIdentity?.mode,
      effort: executionIdentity?.effort,
    };

    let plannerResult: TurnResult | null = null;
    try {
      for await (const event of runtime.executeTurn(plannerContext)) {
        if (event.type === "turn_completed") {
          plannerResult = event.result;
        }
      }
    } catch {
      return {
        instructions: fallback,
        source: "fallback",
        fallbackReason: "planner_execution_error",
      };
    }

    if (!plannerResult) {
      return {
        instructions: fallback,
        source: "fallback",
        fallbackReason: "planner_missing_completion",
      };
    }
    const parsed = parsePlannerInstructions(plannerResult.finalMessage.content, assignments.guests);
    if (parsed) {
      return {
        instructions: parsed,
        source: "planner",
        rawOutput: plannerResult.finalMessage.content,
      };
    }
    return {
      instructions: fallback,
      source: "fallback",
      rawOutput: plannerResult.finalMessage.content,
      fallbackReason: "planner_invalid_json",
    };
  }

  private async runPeerReviewRing(
    space: ActiveSpace,
    turnId: string,
    userMessage: ModelMessage,
    assignments: MasterFlowAssignments,
    guestReports: GuestReport[],
    plannerInstructions: PlannerInstructions,
    promptTemplates: MasterModePromptTemplates,
    executionIdentity?: TurnExecutionIdentity,
  ): Promise<{
    results: PeerReviewResult[];
    assignments: number;
    completed: number;
    failed: number;
    status: "not_run" | "skipped" | "completed" | "degraded";
    failureReason?: string;
  }> {
    const peerReviewEnabled = resolvePeerReviewEnabled(space);
    if (!peerReviewEnabled) {
      return { results: [], assignments: 0, completed: 0, failed: 0, status: "skipped" };
    }

    const peerReviewAssignments = buildRingPeerReviewAssignments(assignments.guests, guestReports);
    if (peerReviewAssignments.length === 0) {
      return { results: [], assignments: 0, completed: 0, failed: 0, status: "skipped" };
    }

    const results: PeerReviewResult[] = [];
    let completed = 0;
    let failed = 0;
    for (const assignment of peerReviewAssignments) {
      await this.appendOrchestrationJournalEntry({
        spaceId: space.config.id,
        turnId,
        eventType: "peer_review.assignment",
        actorId: assignment.reviewerAgentId,
        payload: {
          reviewerAgentId: assignment.reviewerAgentId,
          targetAgentId: assignment.targetAgentId,
        },
      });

      const runtime = await this.getRuntime(space, assignment.reviewerAgentId);
      const session = await this.getOrCreateAgentSession(space, assignment.reviewerAgentId);
      const reviewPrompt = renderTemplate(
        promptTemplates.peerReview,
        {
          user_input: userMessage.content,
          global_instruction: plannerInstructions.globalInstruction,
          reviewer_agent_id: assignment.reviewerAgentId,
          target_agent_id: assignment.targetAgentId,
          target_report: assignment.targetReport,
          guest_list: formatGuestList(assignments.guests),
          guest_reports: formatGuestReports(guestReports),
          guest_agent_id: assignment.reviewerAgentId,
          guest_instruction: "",
          peer_review_results: "",
        },
      );
      const context: TurnContext = {
        spaceId: space.config.id,
        turnId,
        messages: [
          ...session.messages,
          userMessage,
          { role: "user", content: reviewPrompt },
        ],
        lineageId: randomUUID(),
        hopCount: 0,
        maxHops: this.options.maxHops ?? 5,
        principalId: executionIdentity?.principalId,
        deviceId: executionIdentity?.deviceId,
        executionOrigin: executionIdentity?.executionOrigin,
        accessMode: executionIdentity?.accessMode,
        mode: executionIdentity?.mode,
        effort: executionIdentity?.effort,
        ...(await this.resolveCommittedSessionFields(space, session, userMessage)),
      };

      let reviewResult: TurnResult | null = null;
      try {
        for await (const event of runtime.executeTurn(context)) {
          if (event.type === "turn_completed") {
            reviewResult = event.result;
          }
        }
      } catch (error) {
        const normalized = error instanceof Error ? error : new Error(String(error));
        failed += 1;
        const failedResult: PeerReviewResult = {
          reviewerAgentId: assignment.reviewerAgentId,
          targetAgentId: assignment.targetAgentId,
          status: "failed",
          verdict: "error",
          issues: [normalized.message],
          raw: normalized.message,
        };
        results.push(failedResult);
        await this.appendOrchestrationJournalEntry({
          spaceId: space.config.id,
          turnId,
          eventType: "peer_review.result",
          actorId: assignment.reviewerAgentId,
          payload: failedResult as unknown as Record<string, unknown>,
        });
        continue;
      }

      if (!reviewResult) {
        failed += 1;
        const failedResult: PeerReviewResult = {
          reviewerAgentId: assignment.reviewerAgentId,
          targetAgentId: assignment.targetAgentId,
          status: "failed",
          verdict: "error",
          issues: ["Reviewer did not return a completion result."],
          raw: "",
        };
        results.push(failedResult);
        await this.appendOrchestrationJournalEntry({
          spaceId: space.config.id,
          turnId,
          eventType: "peer_review.result",
          actorId: assignment.reviewerAgentId,
          payload: failedResult as unknown as Record<string, unknown>,
        });
        continue;
      }

      this.updateAgentSession(session, turnId, userMessage, reviewResult.finalMessage);
      const parsed = parsePeerReviewResult(
        assignment.reviewerAgentId,
        assignment.targetAgentId,
        reviewResult.finalMessage.content,
      );
      const normalizedResult = parsed ?? {
        reviewerAgentId: assignment.reviewerAgentId,
        targetAgentId: assignment.targetAgentId,
        status: "failed" as const,
        verdict: "error" as const,
        issues: ["Peer-review output invalid; expected strict JSON."],
        raw: reviewResult.finalMessage.content,
      };
      if (normalizedResult.status === "completed") {
        completed += 1;
      } else {
        failed += 1;
      }
      results.push(normalizedResult);
      await this.appendOrchestrationJournalEntry({
        spaceId: space.config.id,
        turnId,
        eventType: "peer_review.result",
        actorId: assignment.reviewerAgentId,
        payload: normalizedResult as unknown as Record<string, unknown>,
      });
    }

    return {
      results,
      assignments: peerReviewAssignments.length,
      completed,
      failed,
      status: failed > 0 ? "degraded" : "completed",
      failureReason: failed > 0 ? "One or more peer reviews failed." : undefined,
    };
  }

  private async appendOrchestrationJournalEntry(entry: OrchestrationJournalEntry): Promise<void> {
    await appendRedactedOrchestrationJournalEntry({
      entry,
      append: this.options.appendOrchestrationJournalEntry,
      recordMetric: (name, value, tags) => this.recordOrchestrationMetric(name, value, tags),
    });
  }

  private recordOrchestrationMetric(
    name: string,
    value: number,
    tags?: Record<string, string>,
  ): void {
    this.options.recordOrchestrationMetric?.({ name, value, tags });
  }

  /**
   * Parallel race: all agents execute concurrently, first to complete wins.
   * Stolen from: Microsoft AF's superstep model.
   */
  private async executeParallelRace(
    space: ActiveSpace,
    turnId: string,
    agents: SpaceAgentAssignment[],
    userMessage: ModelMessage,
    executionIdentity?: TurnExecutionIdentity,
    summaryTrace?: OrchestratorSummaryTrace | null,
  ): Promise<void> {
    const raceTimeout = space.config.turnModelConfig?.raceTimeoutSeconds ?? 120;

    // Resolve all runtimes up-front so we can cancel the actual instances later
    const runtimeMap = new Map<string, AgentRuntime>();
    for (const assignment of agents) {
      const runtime = await this.getRuntime(space, assignment.agentId);
      runtimeMap.set(assignment.agentId, runtime);
    }

    const racePromises = agents.map(async (assignment) => {
      const runtime = runtimeMap.get(assignment.agentId)!;
      const session = await this.getOrCreateAgentSession(space, assignment.agentId);

      const context: TurnContext = {
        spaceId: space.config.id,
        turnId,
        messages: [...session.messages, userMessage],
        lineageId: randomUUID(),
        hopCount: 0,
        maxHops: this.options.maxHops ?? 5,
        principalId: executionIdentity?.principalId,
        deviceId: executionIdentity?.deviceId,
        executionOrigin: executionIdentity?.executionOrigin,
        accessMode: executionIdentity?.accessMode,
        mode: executionIdentity?.mode,
        effort: executionIdentity?.effort,
      };

      let result: TurnResult | null = null;

      for await (const event of runtime.executeTurn(context)) {
        this.recordSummaryEvent(summaryTrace, assignment.agentId, event);
        this.forwardEvent(space.config.id, turnId, event, assignment.agentId);
        if (event.type === "turn_completed") {
          result = event.result;
          this.updateAgentSession(session, turnId, userMessage, event.result.finalMessage, {
            spaceId: space.config.id,
            providerSessionHandle: event.result.metadata?.providerSessionHandle,
          });
        }
      }

      return { agentId: assignment.agentId, result };
    });

    // Race with timeout
    const timeoutPromise = new Promise<null>((resolve) =>
      setTimeout(() => resolve(null), raceTimeout * 1000),
    );

    let winner: { agentId: string; result: TurnResult | null } | null = null;
    try {
      const raceResult = await Promise.race([
        Promise.any(racePromises),
        timeoutPromise,
      ]);
      if (raceResult && typeof raceResult === "object" && "result" in raceResult) {
        winner = raceResult;
      }
    } catch {
      // All agents failed — winner stays null
    }

    if (winner?.result) {
      this.options.saveTurn(buildCompletedSaveTurnInput({
        turnId,
        spaceId: space.config.id,
        agentId: winner.agentId,
        userMessage,
        result: winner.result,
      })).catch((saveErr) => {
        this.handleTurnError(space.config.id, turnId, userMessage.content, saveErr);
      });
    }

    // Cancel all runtimes (the winner's cancel is a no-op since it already completed)
    for (const runtime of runtimeMap.values()) {
      await runtime.cancel().catch(() => {});
    }
  }

  /**
   * Debate synthesis: all agents respond, then a synthesizer produces
   * the final answer. Spaceskit's unique orchestration pattern.
   */
  private async executeDebateSynthesis(
    space: ActiveSpace,
    turnId: string,
    agents: SpaceAgentAssignment[],
    userMessage: ModelMessage,
    executionIdentity?: TurnExecutionIdentity,
    summaryTrace?: OrchestratorSummaryTrace | null,
  ): Promise<void> {
    const rounds = space.config.turnModelConfig?.debateRounds ?? 1;
    const synthesizerAgentId = space.config.turnModelConfig?.synthesizerAgentId;

    // Separate debaters from synthesizer
    const debaters = agents.filter(
      (a) => a.agentId !== synthesizerAgentId,
    );

    let debateHistory: ModelMessage[] = [userMessage];

    for (let round = 0; round < rounds; round++) {
      // All debaters respond in parallel
      const debatePromises = debaters.map(async (assignment) => {
        const runtime = await this.getRuntime(space, assignment.agentId);
        const session = await this.getOrCreateAgentSession(space, assignment.agentId);

        const context: TurnContext = {
          spaceId: space.config.id,
          turnId,
          messages: [...session.messages, ...debateHistory],
          lineageId: randomUUID(),
          hopCount: 0,
          maxHops: this.options.maxHops ?? 5,
          principalId: executionIdentity?.principalId,
          deviceId: executionIdentity?.deviceId,
          executionOrigin: executionIdentity?.executionOrigin,
          accessMode: executionIdentity?.accessMode,
          mode: executionIdentity?.mode,
          effort: executionIdentity?.effort,
          ...(await this.resolveCommittedSessionFields(space, session, userMessage)),
        };

        let result: TurnResult | null = null;
        for await (const event of runtime.executeTurn(context)) {
          this.recordSummaryEvent(summaryTrace, assignment.agentId, event);
          this.forwardEvent(space.config.id, turnId, event, assignment.agentId);
          if (event.type === "turn_completed") {
            result = event.result;
            this.updateAgentSession(session, turnId, userMessage, event.result.finalMessage, {
              spaceId: space.config.id,
              providerSessionHandle: event.result.metadata?.providerSessionHandle,
            });
          }
        }

        return { agentId: assignment.agentId, result };
      });

      const debateResults = await Promise.allSettled(debatePromises);

      // Collect responses into history for the next round
      for (const settled of debateResults) {
        if (settled.status === "fulfilled" && settled.value.result) {
          debateHistory.push({
            role: "assistant",
            content: `[${settled.value.agentId}]: ${settled.value.result.finalMessage.content}`,
          });
        }
      }
    }

    // Synthesizer produces the final answer
    if (synthesizerAgentId) {
      const synthRuntime = await this.getRuntime(space, synthesizerAgentId);
      const synthSession = await this.getOrCreateAgentSession(space, synthesizerAgentId);

      const synthContext: TurnContext = {
        spaceId: space.config.id,
        turnId,
        messages: [
          ...synthSession.messages,
          ...debateHistory,
          {
            role: "user",
            content:
              "You are the synthesizer. Review all agent responses above and produce a unified, balanced answer.",
          },
        ],
        lineageId: randomUUID(),
        hopCount: 0,
        maxHops: this.options.maxHops ?? 5,
        principalId: executionIdentity?.principalId,
        deviceId: executionIdentity?.deviceId,
        executionOrigin: executionIdentity?.executionOrigin,
        accessMode: executionIdentity?.accessMode,
        mode: executionIdentity?.mode,
        effort: executionIdentity?.effort,
        ...(await this.resolveCommittedSessionFields(space, synthSession, userMessage)),
      };

      for await (const event of synthRuntime.executeTurn(synthContext)) {
        this.recordSummaryEvent(summaryTrace, synthesizerAgentId, event);
        this.forwardEvent(space.config.id, turnId, event, synthesizerAgentId);

        if (event.type === "turn_completed" && event.result) {
          this.updateAgentSession(synthSession, turnId, userMessage, event.result.finalMessage, {
            spaceId: space.config.id,
            providerSessionHandle: event.result.metadata?.providerSessionHandle,
          });
          this.options.saveTurn(buildCompletedSaveTurnInput({
            turnId,
            spaceId: space.config.id,
            agentId: synthesizerAgentId,
            userMessage,
            result: event.result,
          })).catch((saveErr) => {
            this.handleTurnError(space.config.id, turnId, userMessage.content, saveErr);
          });
        }
      }
    }
  }

  private createSummaryTrace(
    space: ActiveSpace,
    turnId: string,
    input: string,
    strategy: TurnModelStrategy,
    agents: SpaceAgentAssignment[],
  ): OrchestratorSummaryTrace | null {
    return createSpaceManagerSummaryTrace({
      spaceId: space.config.id,
      turnId,
      userInput: input,
      strategy,
      agents,
      peerReview: {
        enabled: resolvePeerReviewEnabled(space),
        topology: resolvePeerReviewTopology(space),
      },
    });
  }

  private recordSummaryEvent(
    trace: OrchestratorSummaryTrace | null | undefined,
    agentId: string,
    event: TurnEvent,
  ): void {
    recordSpaceManagerSummaryEvent(trace, agentId, event);
  }

  private emitSummaryEvent(
    spaceId: string,
    turnId: string,
    trace: OrchestratorSummaryTrace | null | undefined,
    executionError?: unknown,
  ): void {
    emitSpaceManagerSummaryEvent({
      eventBus: this.eventBus,
      reflectionService: this.options.reflectionService,
      spaceId,
      turnId,
      trace,
      executionError,
    });
  }

  // ---------------------------------------------------------------------------
  // Session continuity helpers
  // ---------------------------------------------------------------------------

  /**
   * Get serializable state for all agent sessions in a space.
   * Used by SessionContinuityManager to create checkpoints.
   */
  getActiveSpaceState(spaceId: string): {
    agentStates: Record<string, { status: string; lastTurnId?: string; messages: ModelMessage[] }>;
    turnIds: string[];
  } | null {
    return getAgentSessionStateSnapshot(this.activeSpaces, spaceId);
  }

  /**
   * Restore agent sessions from a checkpoint.
   * Runtimes are NOT restored — they re-resolve lazily on next turn.
   */
  async restoreFromCheckpoint(
    spaceId: string,
    checkpoint: RestoreAgentSessionCheckpointInput,
  ): Promise<boolean> {
    return restoreActiveSpaceFromCheckpoint({
      activeSpaces: this.activeSpaces,
      spaceId,
      checkpoint,
      loadSpaceConfig: this.options.loadSpaceConfig,
    });
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private async ensureActive(spaceId: string): Promise<ActiveSpace> {
    return ensureActiveSpace({
      activeSpaces: this.activeSpaces,
      spaceId,
      loadSpaceConfig: this.options.loadSpaceConfig,
    });
  }

  private async getRuntime(space: ActiveSpace, agentId: string): Promise<AgentRuntime> {
    return getRuntimeForAgent({
      space,
      agentId,
      resolveRuntime: this.options.resolveRuntime,
    });
  }

  private async getOrCreateAgentSession(
    space: ActiveSpace,
    agentId: string,
  ): Promise<AgentSessionState> {
    return getOrCreateAgentSessionState({
      space,
      agentId,
      loadHistory: this.options.loadHistory,
      ...(this.options.loadAgentHistory ? { loadAgentHistory: this.options.loadAgentHistory } : {}),
      ...(this.options.loadAgentSessionMetadata
        ? { loadAgentSessionMetadata: this.options.loadAgentSessionMetadata }
        : {}),
    });
  }

  private async resolveCommittedSessionFields(
    space: ActiveSpace,
    session: AgentSessionState,
    userMessage: ModelMessage,
  ): Promise<Pick<TurnContext, "providerSessionHandle" | "sessionTitle">> {
    return resolveAgentCommittedSessionFields({
      space,
      session,
      userMessage,
      persistAgentSessionMetadata: this.persistAgentSessionMetadata.bind(this),
    });
  }

  private async persistAgentSessionMetadata(
    spaceId: string,
    session: AgentSessionState,
    metadata: Omit<SaveAgentSessionRuntimeMetadataInput, "spaceId" | "agentId">,
  ): Promise<void> {
    if (!this.options.saveAgentSessionMetadata) {
      return;
    }
    await this.options.saveAgentSessionMetadata({
      spaceId,
      agentId: session.agentId,
      ...metadata,
    });
  }

  private async buildLaunchSnapshots(
    space: ActiveSpace,
    turnId: string,
    agents: SpaceAgentAssignment[],
    userMessage: ModelMessage,
    executionIdentity?: TurnExecutionIdentity,
  ): Promise<CliLaunchSnapshot[]> {
    return buildAgentLaunchSnapshots({
      space,
      turnId,
      agents,
      userMessage,
      maxHops: this.options.maxHops ?? 5,
      getRuntime: this.getRuntime.bind(this),
      getSession: this.getOrCreateAgentSession.bind(this),
      ...(executionIdentity ? { executionIdentity } : {}),
    });
  }

  private updateAgentSession(
    session: AgentSessionState,
    turnId: string,
    userMessage: ModelMessage,
    assistantMessage: ModelMessage,
    options?: {
      spaceId: string;
      providerSessionHandle?: ProviderSessionHandle;
    },
  ): void {
    updateAgentSessionState({
      session,
      turnId,
      userMessage,
      assistantMessage,
      persistAgentSessionMetadata: this.persistAgentSessionMetadata.bind(this),
      ...(options ? { options } : {}),
    });
  }

  /**
   * Start a feedback timeout for a paused turn. If no feedback is received
   * within the timeout, auto-reject the turn and emit a warning.
   */
  private startFeedbackTimeout(spaceId: string, turnId: string): void {
    const space = this.activeSpaces.get(spaceId);
    if (!space) return;

    const timeoutMs = this.options.feedbackTimeoutMs ?? 300_000; // 5 minutes

    const timer = setTimeout(() => {
      space.feedbackTimers.delete(turnId);
      const runtime = space.pausedRuntimes.get(turnId);
      if (!runtime) {
        space.pausedRuntimeAgentIds.delete(turnId);
        space.pausedFeedbackRequests.delete(turnId);
        return; // Already resumed
      }

      // Auto-reject the paused turn
      this.eventBus.emit({
        type: "space.feedback_timeout",
        spaceId,
        turnId,
        timeoutMs,
        timestamp: new Date(),
      });

      // Resume with rejection
      this.resumeFeedback(spaceId, turnId, "reject").catch((err) => {
        console.error(`Failed to auto-reject timed-out feedback for turn ${turnId}:`, err);
      });
    }, timeoutMs);

    space.feedbackTimers.set(turnId, timer);
  }

  private forwardEvent(spaceId: string, turnId: string, event: TurnEvent, agentId?: string): void {
    const resolvedAgentId = normalizeOptionalString(agentId) ?? this.resolveEventAgentId(event);
    const eventWithAgent = resolvedAgentId
      ? { ...event, agentId: resolvedAgentId } as TurnEvent & { agentId: string }
      : event;
    this.eventBus.emit({
      type: "space.turn_event",
      spaceId,
      turnId,
      agentId: resolvedAgentId,
      event: eventWithAgent,
      timestamp: new Date(),
    });
  }

  private resolveEventAgentId(event: TurnEvent): string | undefined {
    if (event.type === "turn_completed") {
      return normalizeOptionalString(event.result.agentId);
    }
    if (event.type === "feedback_requested") {
      return normalizeOptionalString(event.request.agentId);
    }
    return undefined;
  }

  /** Release an active space from memory. */
  deactivate(spaceId: string): void {
    // Clear any pending feedback timers
    const space = this.activeSpaces.get(spaceId);
    if (space) {
      for (const timer of space.feedbackTimers.values()) {
        clearTimeout(timer);
      }
      space.pausedRuntimeAgentIds.clear();
      space.pausedFeedbackRequests.clear();
      for (const runtime of space.runtimes.values()) {
        void runtime.cancel().catch(() => {});
      }
    }
    this.activeSpaces.delete(spaceId);
    this.turnLocks.delete(spaceId);
  }

  /** Release all active spaces from memory. */
  deactivateAll(): void {
    for (const spaceId of this.activeSpaces.keys()) {
      this.deactivate(spaceId);
    }
  }
}
