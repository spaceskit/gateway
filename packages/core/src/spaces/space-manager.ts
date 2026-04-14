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
  TurnAccessMode,
  TurnExecutionMode,
  TurnReasoningEffort,
  ProviderSessionHandle,
} from "../agents/model-provider.js";
import type { CapabilityExecutionOrigin } from "../capabilities/registry.js";
import type {
  ConversationTopology,
  SpaceConfig,
  SpaceState,
  SpaceAgentAssignment,
  TurnModelConfig,
  TurnModelStrategy,
} from "./types.js";
import type { CheckpointManager } from "./checkpoint.js";
import type { DeadLetterQueue } from "./dead-letter.js";
import {
  renderTemplate,
  resolveMasterModePromptTemplates as resolvePromptTemplates,
  type MasterModePromptTemplates,
} from "./master-mode-prompts.js";
import type { ReflectionService } from "../reflection/reflection-service.js";

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

export interface AgentSessionRuntimeMetadata {
  displayTitle?: string;
  providerSessionHandle?: ProviderSessionHandle;
}

export interface SaveAgentSessionRuntimeMetadataInput {
  spaceId: string;
  agentId: string;
  displayTitle?: string;
  providerSessionHandle?: ProviderSessionHandle;
}

export interface TurnExecutionIdentity {
  principalId?: string;
  deviceId?: string;
  executionOrigin?: CapabilityExecutionOrigin;
  accessMode?: TurnAccessMode;
  mode?: TurnExecutionMode;
  effort?: TurnReasoningEffort;
  targetAgentIds?: string[];
  replyToTurnId?: string;
  conversationTopology?: ConversationTopology;
}

interface ActiveSpace {
  config: SpaceConfig;
  /** When true, config will be reloaded on the next turn without tearing down sessions. */
  configStale: boolean;
  /** Stable orchestrator session key for the lifetime of this active space. */
  orchestratorSessionId: string;
  /** Round-robin index for round_robin strategy. */
  roundRobinIndex: number;
  /** Cached runtimes (space+agent) so session continuity survives across turns. */
  runtimes: Map<string, AgentRuntime>;
  /** Per-agent conversation sessions (history and continuity metadata). */
  agentSessions: Map<string, AgentSessionState>;
  /** Active runtimes currently executing a turn (turnId → runtime). */
  activeTurnRuntimes: Map<string, AgentRuntime>;
  /** Paused runtimes awaiting feedback (turnId → runtime). */
  pausedRuntimes: Map<string, AgentRuntime>;
  /** Feedback timeout timers (turnId → timer). */
  feedbackTimers: Map<string, ReturnType<typeof setTimeout>>;
  /** Agent IDs for paused runtimes (turnId → agentId). */
  pausedRuntimeAgentIds: Map<string, string>;
  /** Stored feedback checkpoints for paused turns (turnId → request). */
  pausedFeedbackRequests: Map<string, RuntimeFeedbackCheckpoint>;
}

interface AgentSessionState {
  sessionId: string;
  agentId: string;
  messages: ModelMessage[];
  displayTitle?: string;
  providerSessionHandle?: ProviderSessionHandle;
  lastTurnId?: string;
  lastActivityAt: Date;
}

const MAX_AGENT_SESSION_MESSAGES = 200;

interface SummaryParticipantTrace {
  agentId: string;
  turnOrder: number;
  isPrimary: boolean;
  status: "pending" | "completed" | "failed";
  promptTokens: number;
  completionTokens: number;
  finalMessage?: string;
  error?: string;
}

interface SummaryHighlight {
  agentId: string;
  eventType: "text_delta" | "turn_completed" | "error" | "feedback_requested";
  text: string;
  timestamp: string;
}

interface OrchestratorSummaryTrace {
  summaryId: string;
  spaceId: string;
  turnId: string;
  turnModel: TurnModelStrategy;
  input: string;
  createdAt: Date;
  participants: Map<string, SummaryParticipantTrace>;
  highlights: SummaryHighlight[];
  peerReview: {
    enabled: boolean;
    topology: "ring";
    assignments: number;
    completed: number;
    failed: number;
    status: "not_run" | "skipped" | "completed" | "degraded";
    failureReason?: string;
  };
}

interface MasterModeTurnModelConfig {
  masterModeEnabled?: boolean;
  masterPlannerPromptTemplate?: string;
  guestAgentPromptTemplate?: string;
  peerReviewEnabled?: boolean;
  peerReviewTopology?: "ring";
  peerReviewPromptTemplate?: string;
  masterSynthesisPromptTemplate?: string;
}

interface MasterFlowAssignments {
  master: SpaceAgentAssignment;
  guests: SpaceAgentAssignment[];
}

interface PlannerInstructions {
  globalInstruction: string;
  guestInstructions: Map<string, string>;
}

interface PlannerJsonPayload {
  globalInstruction?: unknown;
  guestInstructions?: unknown;
}

interface PlannerPhaseResult {
  instructions: PlannerInstructions;
  source: "slash" | "planner" | "fallback";
  rawOutput?: string;
  fallbackReason?: string;
}

interface GuestReport {
  agentId: string;
  status: "completed" | "failed";
  report: string;
}

interface PeerReviewAssignment {
  reviewerAgentId: string;
  targetAgentId: string;
  targetReport: string;
}

interface PeerReviewResult {
  reviewerAgentId: string;
  targetAgentId: string;
  status: "completed" | "failed";
  verdict: "approve" | "needs_revision" | "conflict" | "error";
  issues: string[];
  confidence?: number;
  notes?: string;
  raw: string;
}

const SUMMARY_ELIGIBLE_TURN_MODELS = new Set<TurnModelStrategy>([
  "sequential_all",
  "primary_only",
  "first_success",
  "parallel_race",
  "debate_synthesis",
  "adaptive_auto",
]);

const MASTER_MODE_SUPPORTED_TURN_MODELS = new Set<TurnModelStrategy>([
  "sequential_all",
  "primary_only",
]);

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
    const turnSpace = this.resolveTurnScopedSpace(space, targetAgentId, executionIdentity);
    const userMessage: ModelMessage = { role: "user", content: input };

    const strategy = turnSpace.config.turnModel;
    const targetingSingleAgent = normalizeAgentIdentifier(targetAgentId) !== undefined
      || turnSpace.config.agents.length === 1;
    const masterFlow = !targetingSingleAgent && this.shouldUseMasterMode(turnSpace)
      ? this.resolveMasterFlowAssignments(turnSpace)
      : null;
    const agents = masterFlow
      ? [masterFlow.master, ...masterFlow.guests]
      : this.selectAgents(turnSpace, targetAgentId);

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
        this.options.saveTurn({
          turnId: this.buildPersistedTurnId(turnId, assignment.agentId),
          userTurnId: turnId,
          spaceId: space.config.id,
          agentId: assignment.agentId,
          input: userMessage.content,
          output: result.finalMessage.content,
          status: "completed",
          promptTokens: result.usage.promptTokens,
          completionTokens: result.usage.completionTokens,
          totalTokens: result.usage.totalTokens,
        }).catch((saveErr) => {
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
    const promptTemplates = this.resolveMasterModePromptTemplates(space);
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
          ?? this.buildFallbackGuestInstruction(guest.agentId);
        const guestPrompt = renderTemplate(
          promptTemplates.guest,
          {
            user_input: userMessage.content,
            guest_agent_id: guest.agentId,
            guest_list: this.formatGuestList(assignments.guests),
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
          this.options.saveTurn({
            turnId: this.buildPersistedTurnId(turnId, guest.agentId),
            userTurnId: turnId,
            spaceId: space.config.id,
            agentId: guest.agentId,
            input: userMessage.content,
            output: result.finalMessage.content,
            status: "completed",
            promptTokens: result.usage.promptTokens,
            completionTokens: result.usage.completionTokens,
            totalTokens: result.usage.totalTokens,
          }).catch((saveErr) => {
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
      const converged = this.checkMasterModeConvergence(peerReviewResults.results, convergenceThreshold);
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
      revisionFeedback = this.buildRevisionFeedback(peerReviewResults.results);
    }

    const peerReviewEnabled = this.resolvePeerReviewEnabled(space);
    const peerReviewTopology = this.resolvePeerReviewTopology(space);
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
        guest_list: this.formatGuestList(assignments.guests),
        guest_reports: this.formatGuestReports(guestReports),
        peer_review_results: this.formatPeerReviewResults(peerReviewResults.results),
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
        guestReports: this.formatGuestReports(guestReports),
        peerReviewResults: this.formatPeerReviewResults(peerReviewResults.results),
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
    this.options.saveTurn({
      turnId: this.buildPersistedTurnId(turnId, assignments.master.agentId),
      userTurnId: turnId,
      spaceId: space.config.id,
      agentId: assignments.master.agentId,
      input: userMessage.content,
      output: synthesisResult.finalMessage.content,
      status: "completed",
      promptTokens: synthesisResult.usage.promptTokens,
      completionTokens: synthesisResult.usage.completionTokens,
      totalTokens: synthesisResult.usage.totalTokens,
    }).catch((saveErr) => {
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
    const fallback = this.buildFallbackPlannerInstructions(assignments.guests, userMessage.content);
    const slashInstructions = this.parseSlashPlannerDirectives(userMessage.content, assignments.guests);
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
        guest_list: this.formatGuestList(assignments.guests),
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
    const parsed = this.parsePlannerInstructions(plannerResult.finalMessage.content, assignments.guests);
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
    const peerReviewEnabled = this.resolvePeerReviewEnabled(space);
    if (!peerReviewEnabled) {
      return { results: [], assignments: 0, completed: 0, failed: 0, status: "skipped" };
    }

    const peerReviewAssignments = this.buildRingPeerReviewAssignments(assignments.guests, guestReports);
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
          guest_list: this.formatGuestList(assignments.guests),
          guest_reports: this.formatGuestReports(guestReports),
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
      const parsed = this.parsePeerReviewResult(
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

  private parsePlannerInstructions(
    rawPlannerOutput: string,
    guests: SpaceAgentAssignment[],
  ): PlannerInstructions | null {
    const parsed = this.parsePlannerJsonPayload(rawPlannerOutput);
    if (!parsed) return null;

    const globalInstruction = typeof parsed.globalInstruction === "string"
      ? parsed.globalInstruction.trim()
      : typeof (parsed as Record<string, unknown>).global_instruction === "string"
        ? ((parsed as Record<string, unknown>).global_instruction as string).trim()
      : "";
    if (!globalInstruction) return null;
    const rawGuestInstructions = parsed.guestInstructions
      ?? (parsed as Record<string, unknown>).guest_instructions;
    const guestInstructionRecord = (
      rawGuestInstructions && typeof rawGuestInstructions === "object"
        ? rawGuestInstructions as Record<string, unknown>
        : {}
    );
    const guestInstructions = new Map<string, string>();
    const orderedInstructionValues = Object.values(guestInstructionRecord)
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.trim())
      .filter((value) => value.length > 0);

    let orderedValueIndex = 0;
    for (const guest of guests) {
      const raw = guestInstructionRecord[guest.agentId];
      let instruction = typeof raw === "string" ? raw.trim() : "";
      if (!instruction && guests.length === 1 && orderedInstructionValues.length > 0) {
        instruction = orderedInstructionValues[0] ?? "";
      } else if (!instruction && orderedInstructionValues.length === guests.length) {
        instruction = orderedInstructionValues[orderedValueIndex] ?? "";
        orderedValueIndex += 1;
      }
      if (!instruction) {
        instruction = globalInstruction;
      }
      guestInstructions.set(guest.agentId, instruction);
    }

    return { globalInstruction, guestInstructions };
  }

  private parsePlannerJsonPayload(rawPlannerOutput: string): PlannerJsonPayload | null {
    const normalized = rawPlannerOutput.trim();
    if (!normalized) return null;

    const parseRecord = (candidate: string): PlannerJsonPayload | null => {
      try {
        const parsed = JSON.parse(candidate);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          return null;
        }
        return parsed as PlannerJsonPayload;
      } catch {
        return null;
      }
    };

    const direct = parseRecord(normalized);
    if (direct) return direct;

    const fencedMatch = normalized.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fencedMatch?.[1]) {
      const fencedParsed = parseRecord(fencedMatch[1].trim());
      if (fencedParsed) return fencedParsed;
    }

    const firstBrace = normalized.indexOf("{");
    const lastBrace = normalized.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      return parseRecord(normalized.slice(firstBrace, lastBrace + 1).trim());
    }

    return null;
  }

  private buildFallbackPlannerInstructions(
    guests: SpaceAgentAssignment[],
    userInput?: string,
  ): PlannerInstructions {
    const guestInstructions = new Map<string, string>();
    for (const guest of guests) {
      guestInstructions.set(
        guest.agentId,
        this.buildFallbackGuestInstruction(guest.agentId, userInput),
      );
    }
    const normalizedUserInput = userInput?.trim();
    return {
      globalInstruction: normalizedUserInput && normalizedUserInput.length > 0
        ? `Coordinate guest execution to resolve the user request: "${normalizedUserInput}".`
        : "Coordinate guest execution and prepare for final synthesis.",
      guestInstructions,
    };
  }

  /**
   * Check if peer review results indicate convergence.
   * Converges when all reviews approve with average confidence >= threshold.
   */
  private checkMasterModeConvergence(
    results: Array<{ verdict?: string; confidence?: number }>,
    threshold: number,
  ): boolean {
    if (results.length === 0) return true; // No reviews = trivially converged
    const validResults = results.filter((r) => r.verdict);
    if (validResults.length === 0) return true;
    const allApproved = validResults.every((r) => r.verdict === "approve");
    if (!allApproved) return false;
    const avgConfidence = validResults.reduce((sum, r) => sum + (r.confidence ?? 0), 0) / validResults.length;
    return avgConfidence >= threshold;
  }

  /**
   * Build revision feedback string from peer review issues for the next convergence iteration.
   */
  private buildRevisionFeedback(
    results: Array<{ verdict?: string; issues?: string[]; notes?: string }>,
  ): string {
    const feedbackParts: string[] = [];
    for (const result of results) {
      if (result.verdict === "approve") continue;
      if (result.issues?.length) {
        feedbackParts.push(`Issues: ${result.issues.join("; ")}`);
      }
      if (result.notes?.trim()) {
        feedbackParts.push(`Notes: ${result.notes.trim()}`);
      }
    }
    return feedbackParts.length > 0
      ? feedbackParts.join("\n")
      : "Peer review flagged issues but provided no specific feedback.";
  }

  private buildFallbackGuestInstruction(guestAgentId: string, userInput?: string): string {
    const normalizedUserInput = userInput?.trim();
    if (normalizedUserInput && normalizedUserInput.length > 0) {
      return [
        `Guest ${guestAgentId}: execute the user's request directly ("${normalizedUserInput}").`,
        "Use available tools when they help gather concrete facts.",
        "Return concise actionable findings plus blockers for synthesis.",
      ].join(" ");
    }
    return [
      `Guest ${guestAgentId}: execute the user's request directly.`,
      "Use available tools when they help gather concrete facts.",
      "Return concise actionable findings plus blockers for synthesis.",
    ].join(" ");
  }

  private parseSlashPlannerDirectives(
    userInput: string,
    guests: SpaceAgentAssignment[],
  ): PlannerInstructions | null {
    const lines = userInput.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0);
    const hasDirective = lines.some((line) => line.startsWith("/global") || line.startsWith("/guest"));
    if (!hasDirective) return null;

    let globalInstruction = "";
    const guestInstructions = new Map<string, string>();
    for (const line of lines) {
      if (line.startsWith("/global")) {
        const parsed = line.replace(/^\/global\s*:?\s*/i, "").trim();
        if (parsed.length > 0) {
          globalInstruction = parsed;
        }
        continue;
      }
      if (line.startsWith("/guest")) {
        const match = line.match(/^\/guest\s+([^\s:]+)\s*:?\s*(.+)$/i);
        if (!match) continue;
        const guestAgentId = match[1]?.trim();
        const instruction = match[2]?.trim();
        if (!guestAgentId || !instruction) continue;
        guestInstructions.set(guestAgentId, instruction);
      }
    }

    const normalizedGlobal = globalInstruction.length > 0
      ? globalInstruction
      : "Coordinate concise guest reports and prepare for final synthesis.";
    const normalizedGuestInstructions = new Map<string, string>();
    for (const guest of guests) {
      normalizedGuestInstructions.set(
        guest.agentId,
        guestInstructions.get(guest.agentId) ?? this.buildFallbackGuestInstruction(guest.agentId, userInput),
      );
    }

    return {
      globalInstruction: normalizedGlobal,
      guestInstructions: normalizedGuestInstructions,
    };
  }

  private parsePeerReviewResult(
    reviewerAgentId: string,
    targetAgentId: string,
    rawOutput: string,
  ): PeerReviewResult | null {
    const parsed = this.parsePlannerJsonPayload(rawOutput);
    if (!parsed) return null;

    const verdictRaw = typeof (parsed as Record<string, unknown>).verdict === "string"
      ? ((parsed as Record<string, unknown>).verdict as string).trim().toLowerCase()
      : "";
    const verdict = verdictRaw === "approve" || verdictRaw === "needs_revision" || verdictRaw === "conflict"
      ? verdictRaw
      : null;
    if (!verdict) return null;

    const issuesRaw = (parsed as Record<string, unknown>).issues;
    const issues = Array.isArray(issuesRaw)
      ? issuesRaw.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
      : [];
    const notes = typeof (parsed as Record<string, unknown>).notes === "string"
      ? ((parsed as Record<string, unknown>).notes as string).trim()
      : undefined;
    const confidenceRaw = (parsed as Record<string, unknown>).confidence;
    const confidence = typeof confidenceRaw === "number" && Number.isFinite(confidenceRaw)
      ? Math.max(0, Math.min(1, confidenceRaw))
      : undefined;

    return {
      reviewerAgentId,
      targetAgentId,
      status: "completed",
      verdict,
      issues,
      confidence,
      notes: notes && notes.length > 0 ? notes : undefined,
      raw: rawOutput,
    };
  }

  private buildRingPeerReviewAssignments(
    guests: SpaceAgentAssignment[],
    guestReports: GuestReport[],
  ): PeerReviewAssignment[] {
    if (guests.length < 2) return [];
    const reportByAgentId = new Map(guestReports.map((report) => [report.agentId, report]));
    const sortedGuests = this.sortAssignments(guests);
    const assignments: PeerReviewAssignment[] = [];
    for (let idx = 0; idx < sortedGuests.length; idx += 1) {
      const reviewer = sortedGuests[idx]!;
      const target = sortedGuests[(idx + 1) % sortedGuests.length]!;
      const targetReport = reportByAgentId.get(target.agentId)?.report
        ?? "Target agent did not provide a report.";
      assignments.push({
        reviewerAgentId: reviewer.agentId,
        targetAgentId: target.agentId,
        targetReport,
      });
    }
    return assignments;
  }

  private formatPeerReviewResults(results: PeerReviewResult[]): string {
    if (results.length === 0) return "(no peer-review results)";
    return results.map((result) => {
      const issues = result.issues.length > 0
        ? result.issues.join("; ")
        : "none";
      return [
        `- reviewer=${result.reviewerAgentId}`,
        `target=${result.targetAgentId}`,
        `status=${result.status}`,
        `verdict=${result.verdict}`,
        `issues=${issues}`,
      ].join(" ");
    }).join("\n");
  }

  private resolveMasterModePromptTemplates(space: ActiveSpace): MasterModePromptTemplates {
    return resolvePromptTemplates(
      space.config.turnModelConfig as TurnModelConfig | undefined,
      {
        masterPlannerPromptTemplate: this.options.masterPlannerPromptTemplate,
        guestAgentPromptTemplate: this.options.guestAgentPromptTemplate,
        peerReviewPromptTemplate: this.options.peerReviewPromptTemplate,
        masterSynthesisPromptTemplate: this.options.masterSynthesisPromptTemplate,
      },
    );
  }

  private resolvePeerReviewEnabled(space: ActiveSpace): boolean {
    const config = this.getMasterModeTurnModelConfig(space);
    if (config?.peerReviewEnabled === false) {
      return false;
    }
    return true;
  }

  private resolvePeerReviewTopology(space: ActiveSpace): "ring" {
    const config = this.getMasterModeTurnModelConfig(space);
    if (config?.peerReviewTopology === "ring") {
      return "ring";
    }
    return "ring";
  }

  private async appendOrchestrationJournalEntry(entry: {
    spaceId: string;
    turnId: string;
    eventType: string;
    actorId: string;
    lineageId?: string;
    hopCount?: number;
    payload: Record<string, unknown>;
  }): Promise<void> {
    const append = this.options.appendOrchestrationJournalEntry;
    if (!append) return;
    try {
      await append({
        ...entry,
        payload: this.redactOrchestrationPayload(entry.payload),
      });
      this.recordOrchestrationMetric("orchestration_journal_write_total", 1, {
        status: "ok",
        spaceId: entry.spaceId,
      });
    } catch {
      this.recordOrchestrationMetric("orchestration_journal_write_total", 1, {
        status: "failed",
        spaceId: entry.spaceId,
      });
    }
  }

  private redactOrchestrationPayload(payload: Record<string, unknown>): Record<string, unknown> {
    return this.redactOrchestrationValue(payload) as Record<string, unknown>;
  }

  private redactOrchestrationValue(value: unknown, keyPath: string[] = []): unknown {
    if (Array.isArray(value)) {
      return value.map((entry) => this.redactOrchestrationValue(entry, keyPath));
    }
    if (value && typeof value === "object") {
      const redacted: Record<string, unknown> = {};
      for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
        const nextPath = [...keyPath, key];
        if (this.isSensitiveOrchestrationKey(key)) {
          redacted[key] = "[REDACTED]";
        } else {
          redacted[key] = this.redactOrchestrationValue(nested, nextPath);
        }
      }
      return redacted;
    }
    if (typeof value === "string" && value.length > 2_000) {
      return `${value.slice(0, 2_000)}...`;
    }
    return value;
  }

  private isSensitiveOrchestrationKey(key: string): boolean {
    const normalized = key.trim().toLowerCase().replace(/[_-]/g, "");
    return normalized === "messages"
      || normalized.includes("prompt")
      || normalized.includes("instruction")
      || normalized.includes("tooltrace");
  }

  private recordOrchestrationMetric(
    name: string,
    value: number,
    tags?: Record<string, string>,
  ): void {
    this.options.recordOrchestrationMetric?.({ name, value, tags });
  }

  private resolveTurnScopedSpace(
    space: ActiveSpace,
    targetAgentId?: string,
    executionIdentity?: TurnExecutionIdentity,
  ): ActiveSpace {
    const conversationTopology = normalizeConversationTopology(executionIdentity?.conversationTopology);
    const hasSingleTarget = normalizeAgentIdentifier(targetAgentId) !== undefined;
    const targetAgentIds = hasSingleTarget
      ? []
      : normalizeAgentIdentifiers(executionIdentity?.targetAgentIds);
    const hasAgentSubset = targetAgentIds.length > 0;

    if (!conversationTopology && !hasAgentSubset) {
      return space;
    }

    const agents = hasAgentSubset
      ? this.filterAgentsByTargetIds(space.config.agents, targetAgentIds)
      : space.config.agents;
    const nextConfig: SpaceConfig = {
      ...space.config,
      agents,
      ...(conversationTopology ? { conversationTopology } : {}),
    };

    if (conversationTopology) {
      const turnModel = this.turnModelForConversationTopology(conversationTopology);
      nextConfig.turnModel = turnModel;
      nextConfig.turnModelConfig = {
        ...(space.config.turnModelConfig ?? { strategy: turnModel }),
        strategy: turnModel,
        masterModeEnabled: conversationTopology === "broadcast_team",
      };
    }

    return {
      ...space,
      config: nextConfig,
    };
  }

  private filterAgentsByTargetIds(
    agents: SpaceAgentAssignment[],
    targetAgentIds: string[],
  ): SpaceAgentAssignment[] {
    if (targetAgentIds.length === 0) return agents;
    const targets = new Set(targetAgentIds);
    return this.sortAssignments(agents).filter((assignment) => {
      const agentId = normalizeAgentIdentifier(assignment.agentId);
      return Boolean(agentId && targets.has(agentId));
    });
  }

  private turnModelForConversationTopology(
    conversationTopology: ConversationTopology,
  ): TurnModelStrategy {
    switch (conversationTopology) {
      case "broadcast_team":
      case "direct":
        return "primary_only";
      case "shared_team_chat":
        return "sequential_all";
    }
  }

  private shouldUseMasterMode(space: ActiveSpace): boolean {
    const config = this.getMasterModeTurnModelConfig(space);
    if ((this.options.masterModeEnabled ?? true) === false) {
      return false;
    }
    if (config?.masterModeEnabled === false) {
      return false;
    }
    if (!MASTER_MODE_SUPPORTED_TURN_MODELS.has(space.config.turnModel)) {
      return false;
    }

    const sortedAgents = this.sortAssignments(space.config.agents);
    const coordinator = sortedAgents.find((assignment) => assignment.role === "global_coordinator");
    if (coordinator) {
      return sortedAgents.some((assignment) => assignment.agentId !== coordinator.agentId);
    }

    if (config?.masterModeEnabled !== true) {
      return false;
    }
    const primaries = sortedAgents.filter((assignment) => assignment.isPrimary);
    if (primaries.length !== 1) {
      return false;
    }
    return sortedAgents.some((assignment) => assignment.agentId !== primaries[0]!.agentId);
  }

  private resolveMasterFlowAssignments(space: ActiveSpace): MasterFlowAssignments | null {
    const sortedAgents = this.sortAssignments(space.config.agents);
    const coordinator = sortedAgents.find((assignment) => assignment.role === "global_coordinator");
    if (coordinator) {
      const guests = sortedAgents.filter((assignment) => assignment.agentId !== coordinator.agentId);
      if (guests.length === 0) return null;
      return { master: coordinator, guests };
    }

    const config = this.getMasterModeTurnModelConfig(space);
    if (config?.masterModeEnabled !== true) return null;
    const primaries = sortedAgents.filter((assignment) => assignment.isPrimary);
    if (primaries.length !== 1) return null;
    const master = primaries[0]!;
    const guests = sortedAgents.filter((assignment) => assignment.agentId !== master.agentId);
    if (guests.length === 0) return null;
    return { master, guests };
  }

  private getMasterModeTurnModelConfig(space: ActiveSpace): MasterModeTurnModelConfig | undefined {
    const config = space.config.turnModelConfig;
    if (!config || typeof config !== "object") return undefined;
    return config as unknown as MasterModeTurnModelConfig;
  }

  private formatGuestList(guests: SpaceAgentAssignment[]): string {
    if (guests.length === 0) return "(none)";
    return guests
      .map((guest) => `${guest.turnOrder}. ${guest.agentId}`)
      .join("\n");
  }

  private formatGuestReports(guestReports: GuestReport[]): string {
    if (guestReports.length === 0) return "(no guest reports)";
    return guestReports
      .map((entry) => {
        const normalizedReport = entry.report.replace(/\s+/g, " ").trim();
        const clippedReport = normalizedReport.length > 500 ? `${normalizedReport.slice(0, 500)}...` : normalizedReport;
        return `- ${entry.agentId} [${entry.status}]: ${clippedReport || "(empty report)"}`;
      })
      .join("\n");
  }

  private sortAssignments(assignments: SpaceAgentAssignment[]): SpaceAgentAssignment[] {
    return [...assignments].sort((lhs, rhs) => {
      if (lhs.turnOrder !== rhs.turnOrder) return lhs.turnOrder - rhs.turnOrder;
      return lhs.agentId.localeCompare(rhs.agentId);
    });
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
      this.options.saveTurn({
        turnId: this.buildPersistedTurnId(turnId, winner.agentId),
        userTurnId: turnId,
        spaceId: space.config.id,
        agentId: winner.agentId,
        input: userMessage.content,
        output: winner.result.finalMessage.content,
        status: "completed",
        promptTokens: winner.result.usage.promptTokens,
        completionTokens: winner.result.usage.completionTokens,
        totalTokens: winner.result.usage.totalTokens,
      }).catch((saveErr) => {
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
          this.options.saveTurn({
            turnId: this.buildPersistedTurnId(turnId, synthesizerAgentId),
            userTurnId: turnId,
            spaceId: space.config.id,
            agentId: synthesizerAgentId,
            input: userMessage.content,
            output: event.result.finalMessage.content,
            status: "completed",
            promptTokens: event.result.usage.promptTokens,
            completionTokens: event.result.usage.completionTokens,
            totalTokens: event.result.usage.totalTokens,
          }).catch((saveErr) => {
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
    if (!SUMMARY_ELIGIBLE_TURN_MODELS.has(strategy)) return null;
    if (agents.length < 2) return null;

    const orderedAgents = [...agents].sort((lhs, rhs) => {
      if (lhs.turnOrder !== rhs.turnOrder) return lhs.turnOrder - rhs.turnOrder;
      return lhs.agentId.localeCompare(rhs.agentId);
    });

    const participants = new Map<string, SummaryParticipantTrace>();
    for (const assignment of orderedAgents) {
      participants.set(assignment.agentId, {
        agentId: assignment.agentId,
        turnOrder: assignment.turnOrder,
        isPrimary: assignment.isPrimary,
        status: "pending",
        promptTokens: 0,
        completionTokens: 0,
      });
    }

    return {
      summaryId: randomUUID(),
      spaceId: space.config.id,
      turnId,
      turnModel: strategy,
      input,
      createdAt: new Date(),
      participants,
      highlights: [],
      peerReview: {
        enabled: this.resolvePeerReviewEnabled(space),
        topology: this.resolvePeerReviewTopology(space),
        assignments: 0,
        completed: 0,
        failed: 0,
        status: "not_run",
      },
    };
  }

  private recordSummaryEvent(
    trace: OrchestratorSummaryTrace | null | undefined,
    agentId: string,
    event: TurnEvent,
  ): void {
    if (!trace) return;
    const participant = trace.participants.get(agentId);
    if (!participant) return;

    const nowIso = new Date().toISOString();
    switch (event.type) {
      case "text_delta": {
        const text = event.text.trim();
        if (!text) return;
        if (trace.highlights.length >= 12) return;
        trace.highlights.push({
          agentId,
          eventType: "text_delta",
          text: text.length > 220 ? `${text.slice(0, 220)}...` : text,
          timestamp: nowIso,
        });
        return;
      }
      case "feedback_requested": {
        if (trace.highlights.length >= 12) return;
        trace.highlights.push({
          agentId,
          eventType: "feedback_requested",
          text: event.request.description,
          timestamp: nowIso,
        });
        return;
      }
      case "turn_completed": {
        participant.status = "completed";
        participant.promptTokens += event.result.usage.promptTokens;
        participant.completionTokens += event.result.usage.completionTokens;
        const message = event.result.finalMessage.content.trim();
        if (message) {
          participant.finalMessage = message;
          if (trace.highlights.length < 12) {
            trace.highlights.push({
              agentId,
              eventType: "turn_completed",
              text: message.length > 220 ? `${message.slice(0, 220)}...` : message,
              timestamp: nowIso,
            });
          }
        }
        return;
      }
      case "error": {
        participant.status = "failed";
        participant.error = event.error.message;
        if (trace.highlights.length < 12) {
          trace.highlights.push({
            agentId,
            eventType: "error",
            text: event.error.message,
            timestamp: nowIso,
          });
        }
      }
    }
  }

  private emitSummaryEvent(
    spaceId: string,
    turnId: string,
    trace: OrchestratorSummaryTrace | null | undefined,
    executionError?: unknown,
  ): void {
    if (!trace) return;

    const participants = [...trace.participants.values()].sort((lhs, rhs) => {
      if (lhs.turnOrder !== rhs.turnOrder) return lhs.turnOrder - rhs.turnOrder;
      return lhs.agentId.localeCompare(rhs.agentId);
    });

    if (participants.length < 2) return;

    const executionFailureReason = executionError instanceof Error
      ? executionError.message
      : executionError
        ? String(executionError)
        : undefined;
    const hasParticipantFailure = participants.some((participant) => participant.status === "failed");
    const hasPeerReviewFailure = trace.peerReview.status === "degraded" || trace.peerReview.failed > 0;
    const summaryStatus = executionFailureReason || hasParticipantFailure || hasPeerReviewFailure
      ? "degraded"
      : "completed";
    const eventType = executionFailureReason ? "summary.failed" : "summary.completed";

    const summaryTextPromise = this.options.reflectionService?.runSummaryJob({
      kind: "orchestrator",
      conversationTopology: trace.turnModel === "primary_only" ? "broadcast_team" : "shared_team_chat",
      turnModel: trace.turnModel,
      userInput: trace.input,
      participants: participants.map((participant) => ({
        agentId: participant.agentId,
        isPrimary: participant.isPrimary,
        status: participant.status,
        finalMessage: participant.finalMessage,
        error: participant.error,
      })),
      peerReview: trace.peerReview,
      highlights: trace.highlights.map((highlight) => ({
        agentId: highlight.agentId,
        text: highlight.text,
      })),
    });

    const summary = {
      summaryId: trace.summaryId,
      version: "v1",
      spaceId: trace.spaceId,
      turnId: trace.turnId,
      turnModel: trace.turnModel,
      generatedAt: new Date().toISOString(),
      status: summaryStatus,
      failureReason: executionFailureReason
        ?? (hasParticipantFailure ? "One or more participant turns failed." : undefined)
        ?? (hasPeerReviewFailure ? "One or more peer-review turns failed." : undefined),
      participants: participants.map((participant) => ({
        agentId: participant.agentId,
        turnOrder: participant.turnOrder,
        isPrimary: participant.isPrimary,
        status: participant.status,
        promptTokens: participant.promptTokens,
        completionTokens: participant.completionTokens,
        finalMessage: participant.finalMessage,
        error: participant.error,
      })),
      peerReview: trace.peerReview,
      highlights: trace.highlights.slice(0, 8),
      finalSummaryText: undefined as string | undefined,
    };

    const emitSummary = (finalSummaryText: string) => this.eventBus.emit({
      type: "space.orchestrator_event",
      spaceId,
      turnId,
      commandId: `summary-${turnId}`,
      correlationId: turnId,
      status: eventType === "summary.failed" ? "failed" : "completed",
      createdAt: new Date().toISOString(),
      eventType,
      event: {
        type: eventType,
        summary: {
          ...summary,
          finalSummaryText,
        },
      },
      timestamp: new Date(),
    });
    if (summaryTextPromise) {
      void summaryTextPromise
        .then((result) => emitSummary(result.summaryText))
        .catch(() => emitSummary(this.buildSummaryText(
          trace.turnModel,
          trace.input,
          participants,
          summaryStatus,
          trace.peerReview,
        )));
      return;
    }
    emitSummary(this.buildSummaryText(
      trace.turnModel,
      trace.input,
      participants,
      summaryStatus,
      trace.peerReview,
    ));
  }

  private buildSummaryText(
    _turnModel: TurnModelStrategy,
    _input: string,
    participants: SummaryParticipantTrace[],
    status: "completed" | "degraded",
    peerReview: OrchestratorSummaryTrace["peerReview"],
  ): string {
    const failed = participants.filter((participant) => participant.status === "failed");
    const primaryParticipant = participants.find((participant) => participant.isPrimary);
    const guestCount = Math.max(
      participants.length - (primaryParticipant ? 1 : 0),
      0,
    );
    const summaryParts = [
      `Master coordinated ${guestCount} ${guestCount === 1 ? "guest" : "guests"}`,
      status,
      "Full log available",
    ];
    if (failed.length > 0) {
      summaryParts.push(
        `failed: ${failed.map((participant) => participant.agentId).join(", ")}`,
      );
    }
    if (peerReview.status !== "not_run" && peerReview.status !== "skipped") {
      summaryParts.push(`peer-review: ${peerReview.completed}/${peerReview.assignments} completed`);
      if (peerReview.failed > 0) {
        summaryParts.push(`peer-review failed: ${peerReview.failed}`);
      }
    }
    return summaryParts.join(" · ");
  }

  // ---------------------------------------------------------------------------
  // Agent selection
  // ---------------------------------------------------------------------------

  private selectAgents(
    space: ActiveSpace,
    targetAgentId?: string,
  ): SpaceAgentAssignment[] {
    const agents = space.config.agents;

    // Explicit target overrides strategy
    if (targetAgentId) {
      const normalizedTargetAgentId = normalizeAgentIdentifier(targetAgentId);
      if (normalizedTargetAgentId) {
        const match = agents.find(
          (a) => normalizeAgentIdentifier(a.agentId) === normalizedTargetAgentId,
        );
        if (match) {
          return [match];
        }
      }
    }

    switch (space.config.turnModel) {
      case "primary_only": {
        const primary = agents.find((a) => a.isPrimary);
        return primary ? [primary] : agents.slice(0, 1);
      }

      case "round_robin": {
        if (agents.length === 0) return [];
        const idx = space.roundRobinIndex % agents.length;
        space.roundRobinIndex++;
        return [agents[idx]];
      }

      case "sequential_all":
      case "first_success":
        return [...agents].sort((a, b) => a.turnOrder - b.turnOrder);

      case "parallel_race":
      case "debate_synthesis":
        return [...agents]; // All participate

      case "adaptive_auto":
        // TODO: Ask LLM which strategy to use. For now, default to sequential.
        return [...agents].sort((a, b) => a.turnOrder - b.turnOrder);

      default:
        return agents.slice(0, 1);
    }
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
    const active = this.activeSpaces.get(spaceId);
    if (!active) return null;

    const agentStates: Record<string, { status: string; lastTurnId?: string; messages: ModelMessage[] }> = {};
    for (const [agentId, session] of active.agentSessions) {
      agentStates[agentId] = {
        status: "active",
        lastTurnId: session.lastTurnId,
        messages: [...session.messages],
      };
    }

    // Collect turn IDs from agent sessions (latest turn per agent)
    const turnIds: string[] = [];
    for (const session of active.agentSessions.values()) {
      if (session.lastTurnId) {
        turnIds.push(session.lastTurnId);
      }
    }

    return { agentStates, turnIds };
  }

  /**
   * Restore agent sessions from a checkpoint.
   * Runtimes are NOT restored — they re-resolve lazily on next turn.
   */
  async restoreFromCheckpoint(
    spaceId: string,
    checkpoint: {
      agentStates: Record<string, { status: string; lastTurnId?: string; messages?: ModelMessage[] }>;
      configLoader?: () => Promise<SpaceConfig | null>;
    },
  ): Promise<boolean> {
    const loader = checkpoint.configLoader ?? (() => this.options.loadSpaceConfig(spaceId));
    const config = await loader();
    if (!config) return false;

    const active: ActiveSpace = {
      config,
      configStale: false,
      orchestratorSessionId: `space:${spaceId}`,
      roundRobinIndex: 0,
      runtimes: new Map(),
      agentSessions: new Map(),
      activeTurnRuntimes: new Map(),
      pausedRuntimes: new Map(),
      feedbackTimers: new Map(),
      pausedRuntimeAgentIds: new Map(),
      pausedFeedbackRequests: new Map(),
    };

    // Populate agent sessions from checkpoint data
    for (const [agentId, state] of Object.entries(checkpoint.agentStates)) {
      const messages = state.messages ?? [];
      const capped = messages.length > MAX_AGENT_SESSION_MESSAGES
        ? messages.slice(messages.length - MAX_AGENT_SESSION_MESSAGES)
        : [...messages];

      active.agentSessions.set(agentId, {
        sessionId: `${active.orchestratorSessionId}:agent:${agentId}`,
        agentId,
        messages: capped,
        lastTurnId: state.lastTurnId,
        lastActivityAt: new Date(),
      });
    }

    this.activeSpaces.set(spaceId, active);
    return true;
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private async ensureActive(spaceId: string): Promise<ActiveSpace> {
    let active = this.activeSpaces.get(spaceId);
    if (active && !active.configStale) return active;

    if (active && active.configStale) {
      // Reload config but preserve sessions and runtimes
      const config = await this.options.loadSpaceConfig(spaceId);
      if (!config) throw new Error(`Space ${spaceId} not found`);
      if (config.status === "archived" || config.status === "deleted") {
        throw new Error(`Space ${spaceId} is ${config.status}`);
      }
      active.config = config;
      active.configStale = false;
      return active;
    }

    const config = await this.options.loadSpaceConfig(spaceId);
    if (!config) throw new Error(`Space ${spaceId} not found`);
    if (config.status === "archived" || config.status === "deleted") {
      throw new Error(`Space ${spaceId} is ${config.status}`);
    }

    active = {
      config,
      configStale: false,
      orchestratorSessionId: `space:${spaceId}`,
      roundRobinIndex: 0,
      runtimes: new Map(),
      agentSessions: new Map(),
      activeTurnRuntimes: new Map(),
      pausedRuntimes: new Map(),
      feedbackTimers: new Map(),
      pausedRuntimeAgentIds: new Map(),
      pausedFeedbackRequests: new Map(),
    };

    this.activeSpaces.set(spaceId, active);
    return active;
  }

  private async getRuntime(space: ActiveSpace, agentId: string): Promise<AgentRuntime> {
    const cached = space.runtimes.get(agentId);
    if (cached) return cached;

    const runtime = await this.options.resolveRuntime(space.config.id, agentId);
    space.runtimes.set(agentId, runtime);
    return runtime;
  }

  private async getOrCreateAgentSession(
    space: ActiveSpace,
    agentId: string,
  ): Promise<AgentSessionState> {
    const existing = space.agentSessions.get(agentId);
    if (existing) return existing;

    const loadedHistory = this.options.loadAgentHistory
      ? await this.options.loadAgentHistory(space.config.id, agentId, 100)
      : await this.options.loadHistory(space.config.id, 100);
    const loadedMetadata = await this.options.loadAgentSessionMetadata?.(space.config.id, agentId);

    const session: AgentSessionState = {
      sessionId: `${space.orchestratorSessionId}:agent:${agentId}`,
      agentId,
      messages: [...loadedHistory],
      displayTitle: normalizeOptionalString(loadedMetadata?.displayTitle),
      providerSessionHandle: normalizeProviderSessionHandle(loadedMetadata?.providerSessionHandle),
      lastActivityAt: new Date(),
    };
    space.agentSessions.set(agentId, session);
    return session;
  }

  private async resolveCommittedSessionFields(
    space: ActiveSpace,
    session: AgentSessionState,
    userMessage: ModelMessage,
  ): Promise<Pick<TurnContext, "providerSessionHandle" | "sessionTitle">> {
    if (!normalizeOptionalString(session.displayTitle)) {
      session.displayTitle = this.buildSessionTitle(space, session.agentId, userMessage.content);
      await this.persistAgentSessionMetadata(space.config.id, session, {
        displayTitle: session.displayTitle,
      }).catch(() => {});
    }

    return {
      ...(session.providerSessionHandle ? { providerSessionHandle: session.providerSessionHandle } : {}),
      ...(session.displayTitle ? { sessionTitle: session.displayTitle } : {}),
    };
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

  private buildSessionTitle(space: ActiveSpace, agentId: string, input: string): string {
    const baseTitle = sanitizeSessionTitle(input);
    const fallback = sanitizeSessionTitle(`${space.config.name} · ${agentId}`) || `Space · ${agentId}`;
    if (!baseTitle) {
      return truncateSessionTitle(fallback);
    }
    if (space.config.agents.length <= 1) {
      return truncateSessionTitle(baseTitle);
    }
    return truncateSessionTitle(`${baseTitle} · ${agentId}`);
  }

  private async buildLaunchSnapshots(
    space: ActiveSpace,
    turnId: string,
    agents: SpaceAgentAssignment[],
    userMessage: ModelMessage,
    executionIdentity?: TurnExecutionIdentity,
  ): Promise<CliLaunchSnapshot[]> {
    const snapshots = await Promise.all(
      agents.map(async (assignment) => {
        const runtime = await this.getRuntime(space, assignment.agentId);
        const session = await this.getOrCreateAgentSession(space, assignment.agentId);
        const launchContext: TurnContext = {
          spaceId: space.config.id,
          turnId,
          messages: [...session.messages, userMessage],
          lineageId: space.orchestratorSessionId,
          hopCount: 0,
          maxHops: this.options.maxHops ?? 5,
          principalId: executionIdentity?.principalId,
          deviceId: executionIdentity?.deviceId,
          executionOrigin: executionIdentity?.executionOrigin,
          accessMode: executionIdentity?.accessMode,
          mode: executionIdentity?.mode,
          effort: executionIdentity?.effort,
        };

        try {
          const snapshot = await runtime.getLaunchSnapshot?.(launchContext);
          return snapshot ?? undefined;
        } catch {
          return undefined;
        }
      }),
    );

    return snapshots.filter((snapshot): snapshot is CliLaunchSnapshot => Boolean(snapshot));
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
    if (session.lastTurnId !== turnId) {
      session.messages.push(userMessage);
    }
    session.messages.push(assistantMessage);
    if (session.messages.length > MAX_AGENT_SESSION_MESSAGES) {
      session.messages = session.messages.slice(-MAX_AGENT_SESSION_MESSAGES);
    }
    session.lastTurnId = turnId;
    session.lastActivityAt = new Date();
    const providerSessionHandle = normalizeProviderSessionHandle(options?.providerSessionHandle);
    if (providerSessionHandle) {
      session.providerSessionHandle = providerSessionHandle;
      void this.persistAgentSessionMetadata(options!.spaceId, session, {
        providerSessionHandle,
      }).catch(() => {});
    }
  }

  private buildPersistedTurnId(turnId: string, agentId: string): string {
    const normalizedAgentId = agentId
      .trim()
      .replace(/[^a-zA-Z0-9_-]/g, "_");
    return `${turnId}:${normalizedAgentId}`;
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

function normalizeExecutionIdentity(
  input?: TurnExecutionIdentity,
): TurnExecutionIdentity | undefined {
  if (!input) return undefined;
  const principalId = normalizeOptionalString(input.principalId);
  const deviceId = normalizeOptionalString(input.deviceId);
  const executionOrigin = normalizeExecutionOrigin(input.executionOrigin);
  const accessMode = normalizeAccessMode(input.accessMode);
  const mode = normalizeExecutionMode(input.mode);
  const effort = normalizeReasoningEffort(input.effort);
  const targetAgentIds = normalizeAgentIdentifiers(input.targetAgentIds);
  const replyToTurnId = normalizeOptionalString(input.replyToTurnId);
  const conversationTopology = normalizeConversationTopology(input.conversationTopology);
  if (
    !principalId
    && !deviceId
    && !executionOrigin
    && !accessMode
    && !mode
    && !effort
    && targetAgentIds.length === 0
    && !replyToTurnId
    && !conversationTopology
  ) {
    return undefined;
  }
  return {
    principalId,
    deviceId,
    executionOrigin,
    accessMode,
    mode,
    effort,
    ...(targetAgentIds.length > 0 ? { targetAgentIds } : {}),
    ...(replyToTurnId ? { replyToTurnId } : {}),
    ...(conversationTopology ? { conversationTopology } : {}),
  };
}

function normalizeOptionalString(value?: string): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function normalizeProviderSessionHandle(value?: ProviderSessionHandle): ProviderSessionHandle | undefined {
  if (!value || value.type === "none") {
    return undefined;
  }
  if (value.type === "openai_response" && normalizeOptionalString(value.previousResponseId)) {
    return value;
  }
  if (value.type === "codex_app_server_thread" && normalizeOptionalString(value.threadId)) {
    return value;
  }
  return undefined;
}

function sanitizeSessionTitle(input: string): string {
  const normalized = input
    .replace(/```[a-zA-Z0-9_-]*\s*/g, " ")
    .replace(/```/g, " ")
    .replace(/^\s*(user|assistant|system|tool)\s*:\s*/gim, "")
    .replace(/\s+/g, " ")
    .trim();
  const lower = normalized.toLowerCase();
  if (
    normalized.length < 3
    || lower === "hi"
    || lower === "hello"
    || lower === "hey"
    || lower === "help"
    || lower === "test"
  ) {
    return "";
  }
  return truncateSessionTitle(normalized);
}

function truncateSessionTitle(input: string): string {
  const normalized = input.replace(/\s+/g, " ").trim();
  if (normalized.length <= 80) {
    return normalized;
  }
  return `${normalized.slice(0, 77).trimEnd()}...`;
}

function normalizeAgentIdentifier(value?: string): string | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized ? normalized : undefined;
}

function normalizeAgentIdentifiers(values?: string[]): string[] {
  if (!Array.isArray(values)) return [];
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const agentId = normalizeAgentIdentifier(value);
    if (!agentId || seen.has(agentId)) continue;
    seen.add(agentId);
    normalized.push(agentId);
  }
  return normalized;
}

function normalizeConversationTopology(value?: ConversationTopology): ConversationTopology | undefined {
  if (value === "direct" || value === "shared_team_chat" || value === "broadcast_team") {
    return value;
  }
  return undefined;
}

function normalizeExecutionOrigin(value?: CapabilityExecutionOrigin): CapabilityExecutionOrigin | undefined {
  if (!value) return undefined;
  if (
    value === "owner"
    || value === "guest"
    || value === "connector"
    || value === "system"
    || value === "unknown"
  ) {
    return value;
  }
  return undefined;
}

function normalizeAccessMode(value?: TurnAccessMode): TurnAccessMode | undefined {
  if (value === "default" || value === "full_access") {
    return value;
  }
  return undefined;
}

function normalizeExecutionMode(value?: TurnExecutionMode): TurnExecutionMode | undefined {
  if (value === "ask" || value === "plan" || value === "execute") {
    return value;
  }
  return undefined;
}

function normalizeReasoningEffort(value?: TurnReasoningEffort): TurnReasoningEffort | undefined {
  if (value === "low" || value === "medium" || value === "high" || value === "max") {
    return value;
  }
  return undefined;
}
