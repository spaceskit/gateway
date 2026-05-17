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
import type {
  RuntimeApprovalSelection,
} from "../agents/agent-runtime.js";
import type { ModelMessage } from "../agents/model-provider.js";
import type {
  SpaceAgentAssignment,
  TurnModelStrategy,
} from "./types.js";
import type { OrchestratorSummaryTrace } from "./space-summary-trace.js";
import {
  normalizeAgentIdentifier,
  normalizeExecutionIdentity,
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
  type ActiveSpace,
} from "./space-manager-agent-sessions.js";
import {
  executeDebateSynthesisStrategy,
  executeParallelRaceStrategy,
  executeSequentialStrategy,
} from "./space-manager-turn-strategies.js";
import { executeMasterModeFlow } from "./space-manager-master-mode.js";
import {
  cancelActiveOrPausedTurn,
  resumePausedTurnFeedback,
} from "./space-manager-feedback.js";
import { SpaceManagerRuntimeBase } from "./space-manager-runtime-base.js";

export type { TurnExecutionIdentity } from "./space-manager-normalizers.js";
export type {
  AgentSessionRuntimeMetadata,
  SaveAgentSessionRuntimeMetadataInput,
} from "./space-manager-agent-sessions.js";
export type {
  SaveTurnInput,
  SpaceManagerOptions,
} from "./space-manager-types.js";

// ---------------------------------------------------------------------------
// SpaceManager
// ---------------------------------------------------------------------------

export class SpaceManager extends SpaceManagerRuntimeBase {
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
  protected handleTurnError(
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
    return resumePausedTurnFeedback({
      activeSpaces: this.activeSpaces,
      spaceId,
      turnId,
      response,
      revision,
      options,
      handleFeedbackResolution: this.options.handleFeedbackResolution,
      forwardEvent: this.forwardEvent.bind(this),
    });
  }

  /**
   * Cancel an active or paused turn.
   * Returns true if the turn was found and cancelled, false otherwise.
   */
  async cancelTurn(spaceId: string, turnId: string): Promise<boolean> {
    return cancelActiveOrPausedTurn({
      activeSpaces: this.activeSpaces,
      eventBus: this.eventBus,
      spaceId,
      turnId,
    });
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
