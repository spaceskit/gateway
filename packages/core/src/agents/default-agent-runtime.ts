/**
 * DefaultAgentRuntime — the turn execution loop for a single agent.
 *
 * This is the heart of agent execution in Spaceskit. It owns the
 * generate → tool-call → execute → repeat loop, with support for:
 * - Feedback checkpoints that pause execution mid-turn
 * - Middleware interception at turn, capability, and LLM layers
 * - Token usage accumulation
 * - AbortController-based cancellation
 *
 * Stolen patterns:
 * - CrewAI: LLM-driven tool loop with max_iter safety, feedback pauses
 * - Microsoft AF: typed event emission, structured error handling
 * - Spaceskit original: TurnEvent union, AgentState machine,
 *   RuntimeFeedbackCheckpoint, lineage tracking
 */

import type {
  CliExecutionObserver,
  ModelProvider,
  ModelMessage,
  ToolCall,
  ToolResult,
  TokenUsage,
} from "./model-provider.js";
import type {
  AgentRuntime,
  AgentConfig,
  AgentState,
  TurnContext,
  TurnEvent,
} from "./agent-runtime.js";
import type { CapabilityExecutionOrigin } from "../capabilities/registry.js";
import { resolveCliLaunchSnapshot, type CliLaunchSnapshot } from "./cli-launch-snapshot.js";
import type { ToolExecutor } from "./tool-executor.js";
import type { MiddlewarePipeline } from "../middleware/pipeline.js";
import { MiddlewarePipeline as Pipeline } from "../middleware/pipeline.js";
import type { EventBus } from "../events/event-bus.js";
import {
  type FeedbackAction,
  type FeedbackResponse,
} from "./agent-runtime-feedback.js";
import { AsyncEventQueue } from "./agent-runtime-async.js";
import { buildTurnResult } from "./agent-runtime-turn-result.js";
import { runAgentTurnCoreLoop } from "./agent-turn-loop.js";

export interface DefaultAgentRuntimeOptions {
  config: AgentConfig;
  modelProvider: ModelProvider;
  toolExecutor: ToolExecutor;
  middleware?: MiddlewarePipeline;
  eventBus: EventBus;
  resolveApprovalBypass?: (
    spaceId: string,
    agentId: string,
    accessMode: string,
    executionOrigin?: CapabilityExecutionOrigin,
  ) => Promise<boolean>;
  createCliExecutionObserver?: (input: {
    spaceId: string;
    turnId: string;
    agentId: string;
    stepIndex: number;
    providerId: string;
    modelId: string;
  }) => Promise<CliExecutionObserver | undefined> | CliExecutionObserver | undefined;
}

export class DefaultAgentRuntime implements AgentRuntime {
  readonly agentId: string;
  private _state: AgentState = "idle";
  private config: AgentConfig;
  private modelProvider: ModelProvider;
  private toolExecutor: ToolExecutor;
  private middleware: MiddlewarePipeline;
  private eventBus: EventBus;
  private resolveApprovalBypass?: (
    spaceId: string,
    agentId: string,
    accessMode: string,
    executionOrigin?: CapabilityExecutionOrigin,
  ) => Promise<boolean>;
  private createCliExecutionObserver?: (input: {
    spaceId: string;
    turnId: string;
    agentId: string;
    stepIndex: number;
    providerId: string;
    modelId: string;
  }) => Promise<CliExecutionObserver | undefined> | CliExecutionObserver | undefined;
  private abortController: AbortController | null = null;

  /**
   * Feedback pause/resume mechanism — keyed by turnId to prevent
   * cross-turn contamination when multiple turns are queued.
   */
  private pendingFeedback: Map<
    string,
    (response: FeedbackResponse) => void
  > = new Map();

  /** Track the currently executing turnId so cancel() can clean up. */
  private activeTurnId: string | null = null;

  constructor(options: DefaultAgentRuntimeOptions) {
    this.agentId = options.config.id;
    this.config = options.config;
    this.modelProvider = options.modelProvider;
    this.toolExecutor = options.toolExecutor;
    this.middleware = options.middleware ?? new Pipeline();
    this.eventBus = options.eventBus;
    this.resolveApprovalBypass = options.resolveApprovalBypass;
    this.createCliExecutionObserver = options.createCliExecutionObserver;
  }

  get state(): AgentState {
    return this._state;
  }

  async getLaunchSnapshot(context: TurnContext): Promise<CliLaunchSnapshot | undefined> {
    return resolveCliLaunchSnapshot({
      agentId: this.agentId,
      providerId: this.config.modelProvider,
      modelId: this.config.modelId,
      systemPrompt: this.config.systemPrompt,
      messages: context.messages,
    });
  }

  /**
   * Execute a single turn: send context to the model, handle tool calls
   * in a loop, and yield events as they happen.
   */
  async *executeTurn(context: TurnContext): AsyncIterable<TurnEvent> {
    // Guard against concurrent turns on the same runtime
    if (this.abortController) {
      yield {
        type: "error",
        error: new Error(
          `Agent ${this.agentId} is already executing a turn. Cancel or wait before starting a new one.`,
        ),
      };
      return;
    }

    this.abortController = new AbortController();
    this.activeTurnId = context.turnId;
    const { signal } = this.abortController;
    const turnStartedAt = new Date();

    // Accumulated usage across all LLM calls in this turn
    const totalUsage: TokenUsage = {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    };

    const allToolCalls: ToolCall[] = [];
    const allToolResults: ToolResult[] = [];
    const messages: ModelMessage[] = [
      { role: "system", content: this.config.systemPrompt },
      ...context.messages,
    ];

    // -- Turn-layer middleware context --
    const turnCtx = Pipeline.createContext("turn", context, {
      spaceId: context.spaceId,
      agentId: this.agentId,
      turnId: context.turnId,
      metadata: {
        spaceId: context.spaceId,
        agentId: this.agentId,
        turnId: context.turnId,
      },
    });

    try {
      // Run turn-layer middleware (pre-hook wraps everything)
      yield* this.executeWithTurnMiddleware(
        turnCtx,
        context,
        messages,
        totalUsage,
        allToolCalls,
        allToolResults,
        signal,
        turnStartedAt,
      );
    } catch (err) {
      this.setState("errored");
      yield { type: "state_changed", state: "errored" };
      yield {
        type: "error",
        error: err instanceof Error ? err : new Error(String(err)),
      };
    } finally {
      // Clean up turn state
      this.abortController = null;
      this.activeTurnId = null;
      this.pendingFeedback.delete(context.turnId);

      // Clean up tool executor per-turn counts
      if ("clearTurnCounts" in this.toolExecutor) {
        (this.toolExecutor as { clearTurnCounts: (turnId: string) => void }).clearTurnCounts(context.turnId);
      }
    }
  }

  private async *executeWithTurnMiddleware(
    turnCtx: import("../middleware/types.js").MiddlewareContext,
    context: TurnContext,
    messages: ModelMessage[],
    totalUsage: TokenUsage,
    allToolCalls: ToolCall[],
    allToolResults: ToolResult[],
    signal: AbortSignal,
    turnStartedAt: Date,
  ): AsyncIterable<TurnEvent> {
    const eventQueue = new AsyncEventQueue<TurnEvent>();
    let coreError: Error | null = null;
    let emittedCoreEvent = false;

    const turnRunPromise = this.middleware.execute("turn", turnCtx, async () => {
      try {
        for await (const event of this.coreLoop(
          context,
          messages,
          totalUsage,
          allToolCalls,
          allToolResults,
          signal,
          turnStartedAt,
        )) {
          emittedCoreEvent = true;
          eventQueue.push(event);
        }
      } catch (err) {
        coreError = err instanceof Error ? err : new Error(String(err));
      }
    }).finally(() => {
      if (turnCtx.terminate && !emittedCoreEvent) {
        eventQueue.push({
          type: "turn_completed",
          result: buildTurnResult({
            agentId: this.agentId,
            providerId: this.config.modelProvider,
            modelId: this.config.modelId,
            resolvedSafetyProfileId: this.config.resolvedSafetyProfileId,
            state: this._state,
            turnId: context.turnId,
            messages,
            toolCalls: allToolCalls,
            toolResults: allToolResults,
            usage: totalUsage,
            finalMessage: messages[messages.length - 1],
            startedAt: turnStartedAt,
            completedAt: new Date(),
          }),
        });
      }
      eventQueue.close();
    });

    for await (const event of eventQueue) {
      yield event;
    }

    await turnRunPromise;
    if (coreError) throw coreError;
  }

  /**
   * The core generate → tool-call → execute loop.
   */
  private async *coreLoop(
    context: TurnContext,
    messages: ModelMessage[],
    totalUsage: TokenUsage,
    allToolCalls: ToolCall[],
    allToolResults: ToolResult[],
    signal: AbortSignal,
    turnStartedAt: Date,
  ): AsyncIterable<TurnEvent> {
    yield* runAgentTurnCoreLoop(
      {
        agentId: this.agentId,
        config: this.config,
        modelProvider: this.modelProvider,
        toolExecutor: this.toolExecutor,
        middleware: this.middleware,
        setState: (state) => this.setState(state),
        waitForFeedback: (turnId) => this.waitForFeedback(turnId),
        resolveApprovalBypass: this.resolveApprovalBypass,
        createCliExecutionObserver: this.createCliExecutionObserver,
      },
      context,
      messages,
      totalUsage,
      allToolCalls,
      allToolResults,
      signal,
      turnStartedAt,
    );
  }

  /**
   * Resume a paused turn after feedback is provided.
   */
  async *resumeWithFeedback(
    turnId: string,
    response: FeedbackAction,
    revision?: string,
  ): AsyncIterable<TurnEvent> {
    const resolver = this.pendingFeedback.get(turnId);
    if (resolver) {
      resolver({ action: response, revision });
      this.pendingFeedback.delete(turnId);
    }
    // Events from the resumed loop will continue through the original executeTurn generator
    yield { type: "state_changed", state: this._state };
  }

  /** Cancel the current turn. */
  async cancel(): Promise<void> {
    this.abortController?.abort();
    this.setState("interrupted");

    // Resolve any pending feedback with reject so the awaiting promise settles
    if (this.activeTurnId) {
      const resolver = this.pendingFeedback.get(this.activeTurnId);
      if (resolver) {
        resolver({ action: "reject" });
        this.pendingFeedback.delete(this.activeTurnId);
      }
    }
  }

  // ---- Internal helpers ----

  private setState(state: AgentState): void {
    this._state = state;
    this.eventBus.emit({
      type: "agent.state_changed",
      agentId: this.agentId,
      state,
      timestamp: new Date(),
    });
  }

  private waitForFeedback(turnId: string): Promise<FeedbackResponse> {
    return new Promise((resolve) => {
      this.pendingFeedback.set(turnId, resolve);
    });
  }
}
