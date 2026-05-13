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
import type { ReflectionService } from "../reflection/reflection-service.js";
import type { OrchestratorSummaryTrace } from "./space-summary-trace.js";
import {
  normalizeAgentIdentifier,
  normalizeExecutionIdentity,
  normalizeOptionalString,
  type TurnExecutionIdentity,
} from "./space-manager-normalizers.js";
import {
  resolveMasterFlowAssignments,
  resolvePeerReviewEnabled,
  resolvePeerReviewTopology,
  shouldUseMasterMode,
  type MasterFlowAssignments,
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
import {
  executeDebateSynthesisStrategy,
  executeParallelRaceStrategy,
  executeSequentialStrategy,
  type TurnStrategyContext,
} from "./space-manager-turn-strategies.js";
import {
  executeMasterModeFlow,
  type MasterModeContext,
} from "./space-manager-master-mode.js";

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
    return executeSequentialStrategy(
      this.turnStrategyContext(),
      space,
      turnId,
      agents,
      userMessage,
      strategy,
      executionIdentity,
      summaryTrace,
    );
  }

  private async executeMasterMode(
    space: ActiveSpace,
    turnId: string,
    userMessage: ModelMessage,
    assignments: MasterFlowAssignments,
    executionIdentity?: TurnExecutionIdentity,
    summaryTrace?: OrchestratorSummaryTrace | null,
  ): Promise<void> {
    return executeMasterModeFlow(
      this.masterModeContext(),
      space,
      turnId,
      userMessage,
      assignments,
      executionIdentity,
      summaryTrace,
    );
  }

  private masterModeContext(): MasterModeContext {
    return {
      maxHops: this.options.maxHops ?? 5,
      masterPlannerPromptTemplate: this.options.masterPlannerPromptTemplate,
      guestAgentPromptTemplate: this.options.guestAgentPromptTemplate,
      peerReviewPromptTemplate: this.options.peerReviewPromptTemplate,
      masterSynthesisPromptTemplate: this.options.masterSynthesisPromptTemplate,
      getRuntime: this.getRuntime.bind(this),
      getOrCreateAgentSession: this.getOrCreateAgentSession.bind(this),
      resolveCommittedSessionFields: this.resolveCommittedSessionFields.bind(this),
      updateAgentSession: this.updateAgentSession.bind(this),
      forwardEvent: this.forwardEvent.bind(this),
      recordSummaryEvent: this.recordSummaryEvent.bind(this),
      startFeedbackTimeout: this.startFeedbackTimeout.bind(this),
      handleTurnError: this.handleTurnError.bind(this),
      appendOrchestrationJournalEntry: this.appendOrchestrationJournalEntry.bind(this),
      recordOrchestrationMetric: this.recordOrchestrationMetric.bind(this),
      saveTurn: this.options.saveTurn,
      updateSpaceStatus: this.options.updateSpaceStatus,
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
    return executeParallelRaceStrategy(
      this.turnStrategyContext(),
      space,
      turnId,
      agents,
      userMessage,
      executionIdentity,
      summaryTrace,
    );
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
    return executeDebateSynthesisStrategy(
      this.turnStrategyContext(),
      space,
      turnId,
      agents,
      userMessage,
      executionIdentity,
      summaryTrace,
    );
  }

  /**
   * Build a context object for delegated turn strategy helpers.
   */
  private turnStrategyContext(): TurnStrategyContext {
    return {
      maxHops: this.options.maxHops ?? 5,
      getRuntime: this.getRuntime.bind(this),
      getOrCreateAgentSession: this.getOrCreateAgentSession.bind(this),
      resolveCommittedSessionFields: this.resolveCommittedSessionFields.bind(this),
      updateAgentSession: this.updateAgentSession.bind(this),
      forwardEvent: this.forwardEvent.bind(this),
      recordSummaryEvent: this.recordSummaryEvent.bind(this),
      startFeedbackTimeout: this.startFeedbackTimeout.bind(this),
      handleTurnError: this.handleTurnError.bind(this),
      saveTurn: this.options.saveTurn,
      updateSpaceStatus: this.options.updateSpaceStatus,
    };
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
