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

import { randomUUID } from "node:crypto";
import type {
  ModelProvider,
  ModelMessage,
  ToolCall,
  ToolDefinition,
  ToolResult,
  GenerateOptions,
  GenerateResult,
  TokenUsage,
  FinishReason,
  TokenUsageDetails,
} from "./model-provider.js";
import type {
  AgentRuntime,
  AgentConfig,
  AgentState,
  TurnContext,
  TurnResult,
  TurnEvent,
  RuntimeFeedbackCheckpoint,
} from "./agent-runtime.js";
import type { ToolExecutor, ToolPermission, ToolExecutionContext } from "./tool-executor.js";
import type { MiddlewarePipeline } from "../middleware/pipeline.js";
import { MiddlewarePipeline as Pipeline } from "../middleware/pipeline.js";
import type { EventBus } from "../events/event-bus.js";
import { computeRetryDecision, DEFAULT_PROVIDER_RETRY_CONFIG } from "./provider-retry.js";
import { ProviderRateLimitError } from "../errors/runtime-errors.js";

export interface DefaultAgentRuntimeOptions {
  config: AgentConfig;
  modelProvider: ModelProvider;
  toolExecutor: ToolExecutor;
  middleware?: MiddlewarePipeline;
  eventBus: EventBus;
}

type FeedbackAction = "approve" | "reject" | "revise" | "defer";
type FeedbackResponse = { action: FeedbackAction; revision?: string };
type LlmCallResult = { result: GenerateResult; streamedTextDeltaCount: number };
const TOOL_GUIDANCE_MARKER = "[[SPACESKIT_TOOL_GUIDANCE_V1]]";
const TOOL_DISCOVERY_RETRY_ATTEMPTS = 4;
const TOOL_DISCOVERY_RETRY_DELAY_MS = 250;

export class DefaultAgentRuntime implements AgentRuntime {
  readonly agentId: string;
  private _state: AgentState = "idle";
  private config: AgentConfig;
  private modelProvider: ModelProvider;
  private toolExecutor: ToolExecutor;
  private middleware: MiddlewarePipeline;
  private eventBus: EventBus;
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
  }

  get state(): AgentState {
    return this._state;
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
          result: this.buildResult(
            context.turnId,
            messages,
            allToolCalls,
            allToolResults,
            totalUsage,
            messages[messages.length - 1],
            turnStartedAt,
            new Date(),
          ),
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
    this.setState("thinking");
    yield { type: "state_changed", state: "thinking" };

    const nativeCliToolsMode = isNativeCliToolsMode(
      this.config.modelProvider,
      this.config.nativeCliToolsEnabled,
    );

    // Get available tools for this agent in this space
    const toolDefs = nativeCliToolsMode
      ? []
      : await this.resolveToolDefinitionsForTurn(
        context.spaceId,
        signal,
        context.messages,
      );
    if (toolDefs.length > 0) {
      messages.splice(1, 0, {
        role: "system",
        content: buildToolUsageGuidance(toolDefs),
      });
    }

    let finalMessage: ModelMessage | null = null;
    let finalFinishReason: FinishReason | undefined;
    let finalResponseStreamed = false;

    for (let step = 0; step < this.config.maxSteps; step++) {
      if (signal.aborted) {
        this.setState("idle");
        yield { type: "state_changed", state: "idle" };
        break;
      }

      // --- LLM call (with LLM-layer middleware) ---
      const generateOpts: GenerateOptions = {
        messages,
        modelId: this.config.modelId,
        tools: toolDefs.length > 0 ? toolDefs : undefined,
        temperature: this.config.temperature,
        workingDirectory: this.config.workingDirectory,
        nativeCliToolsEnabled: nativeCliToolsMode,
        signal,
      };

      let result: GenerateResult | null = null;
      let streamedTextDeltaCount = 0;

      for (let retryAttempt = 0; ; retryAttempt++) {
        const llmCtx = Pipeline.createContext("llm", generateOpts, {
          spaceId: context.spaceId,
          agentId: this.agentId,
          turnId: context.turnId,
          metadata: {
            step,
            retryAttempt,
            modelId: this.config.modelId,
            spaceId: context.spaceId,
            agentId: this.agentId,
            turnId: context.turnId,
          },
        });

        let rawResult: LlmCallResult | null = null;
        let llmError: Error | null = null;
        const llmEventQueue = new AsyncEventQueue<TurnEvent>();

        try {
          const llmRunPromise = this.middleware.execute("llm", llmCtx, async () => {
            rawResult = await this.runLlmCall(
              generateOpts,
              (event) => llmEventQueue.push(event),
            );
            llmCtx.output = rawResult.result;
          }).catch((err) => {
            llmError = err instanceof Error ? err : new Error(String(err));
          }).finally(() => {
            llmEventQueue.close();
          });

          for await (const event of llmEventQueue) {
            yield event;
          }
          await llmRunPromise;
          if (llmError) {
            throw llmError;
          }
        } catch (err) {
          const rateLimitInfo = extractRateLimitErrorInfo(err);
          if (!rateLimitInfo) {
            throw err;
          }

          const decision = computeRetryDecision(
            retryAttempt,
            DEFAULT_PROVIDER_RETRY_CONFIG,
            rateLimitInfo.retryAfterMs,
          );
          if (!decision.shouldRetry) {
            const exhausted = new ProviderRateLimitError({
              retryAfterMs: rateLimitInfo.retryAfterMs ?? 0,
              provider: this.modelProvider.id,
              attempt: decision.maxAttempts,
              maxAttempts: decision.maxAttempts,
            });
            (exhausted as Error & { cause?: unknown }).cause = err;
            throw exhausted;
          }

          const retryAt = new Date(Date.now() + decision.delayMs).toISOString();
          yield {
            type: "rate_limited",
            retryAfterMs: decision.delayMs,
            retryAfterSeconds: Math.max(1, Math.ceil(decision.delayMs / 1000)),
            attempt: retryAttempt + 1,
            maxAttempts: decision.maxAttempts,
            providerId: this.modelProvider.id,
            retryAt,
          };

          const didWait = await sleepWithAbort(decision.delayMs, signal);
          if (!didWait) {
            break;
          }
          continue;
        }

        // If middleware terminated (e.g., budget exceeded), break
        if (llmCtx.terminate || !rawResult) {
          if (llmCtx.output && typeof llmCtx.output === "object" && "feedbackRequest" in llmCtx.output) {
            const feedback = (llmCtx.output as { feedbackRequest: RuntimeFeedbackCheckpoint }).feedbackRequest;
            this.setState("needs_feedback");
            yield { type: "state_changed", state: "needs_feedback" };
            yield { type: "feedback_requested", request: feedback };
            return;
          }
          break;
        }

        const resolvedResult = rawResult as LlmCallResult;
        streamedTextDeltaCount = resolvedResult.streamedTextDeltaCount;
        result = resolvedResult.result;
        break;
      }

      if (signal.aborted) {
        this.setState("idle");
        yield { type: "state_changed", state: "idle" };
        break;
      }

      if (!result) {
        break;
      }
      const llmResult: GenerateResult = result;

      // Accumulate usage
      if (llmResult.usage) {
        totalUsage.promptTokens += llmResult.usage.promptTokens;
        totalUsage.completionTokens += llmResult.usage.completionTokens;
        totalUsage.totalTokens += llmResult.usage.totalTokens;
        totalUsage.tokenAccuracy = mergeTokenAccuracy(
          totalUsage.tokenAccuracy,
          llmResult.usage.tokenAccuracy ?? "reported",
        );
        totalUsage.usageSource = mergeUsageSource(
          totalUsage.usageSource,
          llmResult.usage.usageSource ?? "ledger",
        );
        totalUsage.usageDetails = mergeUsageDetails(
          totalUsage.usageDetails,
          llmResult.usage.usageDetails,
        );
      }

      // Append assistant message
      messages.push(llmResult.message);

      // --- Handle finish reason ---
      if (llmResult.finishReason === "stop" || llmResult.finishReason === "length") {
        finalMessage = llmResult.message;
        finalFinishReason = llmResult.finishReason;
        finalResponseStreamed = streamedTextDeltaCount > 0;
        break;
      }

      if (llmResult.finishReason === "tool_calls" && llmResult.message.toolCalls) {
        this.setState("acting");
        yield { type: "state_changed", state: "acting" };

        const toolCalls = llmResult.message.toolCalls;
        const executionCtx: ToolExecutionContext = {
          spaceId: context.spaceId,
          agentId: this.agentId,
          turnId: context.turnId,
          lineageId: context.lineageId,
          principalId: context.principalId,
          deviceId: context.deviceId,
          executionOrigin: context.executionOrigin,
        };

        // Phase 1: Check permissions for all tool calls upfront
        const permissionChecks = await Promise.all(
          toolCalls.map((tc) => this.toolExecutor.checkPermission(tc, executionCtx)),
        );

        // Classify tool calls by permission result
        const denied: { toolCall: ToolCall; permission: ToolPermission }[] = [];
        const needsApproval: { toolCall: ToolCall; permission: ToolPermission }[] = [];
        const autoApproved: ToolCall[] = [];

        for (let i = 0; i < toolCalls.length; i++) {
          const toolCall = toolCalls[i];
          const permission = permissionChecks[i];
          allToolCalls.push(toolCall);

          if (!permission.allowed) {
            denied.push({ toolCall, permission });
          } else if (permission.requiresApproval) {
            needsApproval.push({ toolCall, permission });
          } else {
            autoApproved.push(toolCall);
          }
        }

        // Phase 2: Handle denied tools immediately
        for (const { toolCall, permission } of denied) {
          yield { type: "tool_call_start", toolCall };
          const errorResult: ToolResult = {
            toolCallId: toolCall.id,
            result: `Permission denied: ${permission.reason}`,
            isError: true,
          };
          allToolResults.push(errorResult);
          this.appendToolResultMessage(messages, context, toolCall, errorResult.result);
          yield { type: "tool_result", result: errorResult };
        }

        // Phase 3: Execute auto-approved tools in parallel
        if (autoApproved.length > 0 && !signal.aborted) {
          // Emit all tool_call_start events
          for (const toolCall of autoApproved) {
            yield { type: "tool_call_start", toolCall };
          }

          // Execute all in parallel
          const parallelResults = await Promise.all(
            autoApproved.map((toolCall) =>
              this.toolExecutor.execute(toolCall, executionCtx),
            ),
          );

          // Yield results in order
          for (let i = 0; i < autoApproved.length; i++) {
            const toolCall = autoApproved[i];
            const toolResult = parallelResults[i];
            allToolResults.push(toolResult);
            this.appendToolResultMessage(messages, context, toolCall, toolResult.result);
            yield { type: "tool_result", result: toolResult };
          }
        }

        // Phase 4: Process approval-required tools serially
        for (const { toolCall } of needsApproval) {
          if (signal.aborted) break;

          yield { type: "tool_call_start", toolCall };

          const checkpoint: RuntimeFeedbackCheckpoint = {
            id: randomUUID(),
            agentId: this.agentId,
            triggerClass: "permission_gate",
            description: `Tool "${toolCall.name}" requires approval`,
            options: ["approve", "reject"],
          };

          this.setState("needs_feedback");
          yield { type: "state_changed", state: "needs_feedback" };
          yield { type: "feedback_requested", request: checkpoint };

          const feedbackResult = await this.waitForFeedback(context.turnId);
          if (feedbackResult.action === "reject" || feedbackResult.action === "defer") {
            const deniedResult: ToolResult = {
              toolCallId: toolCall.id,
              result: "Tool execution denied by human reviewer",
              isError: true,
            };
            allToolResults.push(deniedResult);
            this.appendToolResultMessage(messages, context, toolCall, deniedResult.result);
            yield { type: "tool_result", result: deniedResult };
            continue;
          }

          // Approved — execute
          this.setState("acting");
          yield { type: "state_changed", state: "acting" };

          const toolResult = await this.toolExecutor.execute(toolCall, executionCtx);
          allToolResults.push(toolResult);
          this.appendToolResultMessage(messages, context, toolCall, toolResult.result);
          yield { type: "tool_result", result: toolResult };
        }

        // Continue loop — send tool results back to the model
        this.setState("thinking");
        yield { type: "state_changed", state: "thinking" };
        continue;
      }

      // Unknown finish reason
      finalMessage = llmResult.message;
      finalFinishReason = llmResult.finishReason;
      break;
    }

    // Turn complete
    finalMessage = finalMessage ?? messages[messages.length - 1];
    this.setState("idle");
    yield { type: "state_changed", state: "idle" };

    // Emit the final response as a text_delta so WebSocket clients receive turn_stream events
    if (finalMessage && finalMessage.content && !finalResponseStreamed) {
      yield { type: "text_delta", text: finalMessage.content };
    }

    // Fallback: estimate tokens from message content when provider reports no usage.
    // This covers providers like Apple on-device that don't return token counts.
    if (totalUsage.totalTokens === 0 && messages.length > 0) {
      const estimatedInput = Math.ceil(
        messages
          .filter((m) => m.role !== "assistant")
          .reduce((acc, m) => acc + (typeof m.content === "string" ? m.content.length : 0), 0) / 4,
      );
      const estimatedOutput = Math.ceil(
        messages
          .filter((m) => m.role === "assistant")
          .reduce((acc, m) => acc + (typeof m.content === "string" ? m.content.length : 0), 0) / 4,
      );
      totalUsage.promptTokens = estimatedInput;
      totalUsage.completionTokens = estimatedOutput;
      totalUsage.totalTokens = estimatedInput + estimatedOutput;
      totalUsage.tokenAccuracy = "estimated";
      totalUsage.usageSource = "ledger";
    }

    yield {
      type: "turn_completed",
      result: this.buildResult(
        context.turnId,
        messages,
        allToolCalls,
        allToolResults,
        totalUsage,
        finalMessage,
        turnStartedAt,
        new Date(),
        finalFinishReason,
      ),
    };
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
    this.setState("idle");

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

  private async resolveToolDefinitionsForTurn(
    spaceId: string,
    signal: AbortSignal,
    contextMessages: ModelMessage[],
  ): Promise<ToolDefinition[]> {
    let toolDefs = await this.toolExecutor.getAvailableTools(spaceId, this.agentId);
    if (toolDefs.length > 0 || signal.aborted) {
      return toolDefs;
    }
    if (!shouldRetryToolDiscovery(contextMessages)) {
      return toolDefs;
    }

    for (let attempt = 0; attempt < TOOL_DISCOVERY_RETRY_ATTEMPTS; attempt += 1) {
      const delayCompleted = await sleepWithAbort(TOOL_DISCOVERY_RETRY_DELAY_MS, signal);
      if (!delayCompleted || signal.aborted) {
        break;
      }
      toolDefs = await this.toolExecutor.getAvailableTools(spaceId, this.agentId);
      if (toolDefs.length > 0) {
        return toolDefs;
      }
    }

    return toolDefs;
  }

  private async runLlmCall(
    generateOpts: GenerateOptions,
    emitEvent: (event: TurnEvent) => void,
  ): Promise<LlmCallResult> {
    if (isNativeCliToolsMode(this.config.modelProvider, generateOpts.nativeCliToolsEnabled)) {
      const result = await this.modelProvider.generate(this.config.modelId, generateOpts);
      return {
        result: decorateNativeCliToolsResult(
          result,
          this.modelProvider.id,
          this.config.modelId,
        ),
        streamedTextDeltaCount: 0,
      };
    }

    // Preserve deterministic tool-call behavior by using generate() when tools are enabled.
    if (generateOpts.tools && generateOpts.tools.length > 0) {
      try {
        const result = await this.modelProvider.generate(this.config.modelId, generateOpts);
        return { result, streamedTextDeltaCount: 0 };
      } catch (err) {
        if (!shouldRetryWithoutTools(err, this.modelProvider.id, this.config.modelId)) {
          throw toActionableLmStudioBadRequestError(err, this.modelProvider.id, this.config.modelId) ?? err;
        }
      }

      try {
        const fallbackResult = await this.modelProvider.generate(this.config.modelId, {
          ...generateOpts,
          tools: undefined,
        });
        const fallbackNotice = buildToolUnsupportedFallbackNotice(
          this.modelProvider.id,
          this.config.modelId,
        );
        const fallbackContent = fallbackResult.message.content.trim();
        fallbackResult.message = {
          ...fallbackResult.message,
          content: fallbackContent.length > 0
            ? `${fallbackNotice}\n\n${fallbackContent}`
            : fallbackNotice,
        };
        return { result: fallbackResult, streamedTextDeltaCount: 0 };
      } catch (err) {
        throw toActionableLmStudioBadRequestError(err, this.modelProvider.id, this.config.modelId) ?? err;
      }
    }

    const streamedResult = await this.tryStreamLlmCall(generateOpts, emitEvent);
    if (streamedResult) {
      return streamedResult;
    }

    try {
      const generatedResult = await this.modelProvider.generate(this.config.modelId, generateOpts);
      return { result: generatedResult, streamedTextDeltaCount: 0 };
    } catch (err) {
      throw toActionableLmStudioBadRequestError(err, this.modelProvider.id, this.config.modelId) ?? err;
    }
  }

  private async tryStreamLlmCall(
    generateOpts: GenerateOptions,
    emitEvent: (event: TurnEvent) => void,
  ): Promise<LlmCallResult | null> {
    const chunks: string[] = [];
    let finishReason: FinishReason = "stop";
    let usage: TokenUsage | undefined;
    let streamedTextDeltaCount = 0;
    let sawFinish = false;

    try {
      for await (const chunk of this.modelProvider.stream(this.config.modelId, generateOpts)) {
        if (chunk.type === "text_delta") {
          const text = typeof chunk.text === "string" ? chunk.text : "";
          if (!text) continue;
          chunks.push(text);
          streamedTextDeltaCount += 1;
          emitEvent({ type: "text_delta", text });
          continue;
        }

        if (chunk.type === "finish") {
          sawFinish = true;
          finishReason = chunk.finishReason ?? finishReason;
          usage = chunk.usage ?? usage;
        }
      }
    } catch (err) {
      if (streamedTextDeltaCount === 0) {
        return null;
      }
      throw err;
    }

    if (!sawFinish && streamedTextDeltaCount === 0) {
      return null;
    }

    return {
      result: {
        message: {
          role: "assistant",
          content: chunks.join(""),
        },
        finishReason,
        ...(usage ? { usage } : {}),
      },
      streamedTextDeltaCount,
    };
  }

  private appendToolResultMessage(
    messages: ModelMessage[],
    context: TurnContext,
    toolCall: ToolCall,
    rawResult: unknown,
  ): void {
    const toolCallId = typeof toolCall.id === "string" ? toolCall.id.trim() : "";
    const content = this.stringifyToolMessageContent(rawResult);
    if (!toolCallId) {
      this.emitPromptBridgeWarning("prompt_bridge_tool_missing_tool_call_id", context, {
        toolName: toolCall.name,
      });
      messages.push({
        role: "assistant",
        content: `[tool-result-unlinked] ${toolCall.name}: ${content}`,
      });
      return;
    }

    messages.push({
      role: "tool",
      content,
      toolCallId,
      toolName: toolCall.name,
    });
  }

  private stringifyToolMessageContent(value: unknown): string {
    if (typeof value === "string") {
      return value;
    }
    try {
      const serialized = JSON.stringify(value);
      if (typeof serialized === "string") {
        return serialized;
      }
      return String(value);
    } catch {
      return String(value);
    }
  }

  private emitPromptBridgeWarning(
    code: string,
    context: TurnContext,
    details?: Record<string, unknown>,
  ): void {
    const payload = {
      code,
      spaceId: context.spaceId,
      agentId: this.agentId,
      turnId: context.turnId,
      providerId: this.config.modelProvider,
      modelId: this.config.modelId,
      ...(details ?? {}),
    };
    console.warn("[spaceskit][default-agent-runtime] prompt bridge warning", payload);
  }

  private buildResult(
    turnId: string,
    messages: ModelMessage[],
    toolCalls: ToolCall[],
    toolResults: ToolResult[],
    usage: TokenUsage,
    finalMessage: ModelMessage,
    startedAt: Date,
    completedAt: Date,
    finishReason?: FinishReason,
  ): TurnResult {
    const durationMs = Math.max(0, completedAt.getTime() - startedAt.getTime());
    return {
      agentId: this.agentId,
      turnId,
      messages,
      toolCalls,
      toolResults,
      finalMessage,
      usage: {
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        totalTokens: usage.totalTokens,
        ...(usage.tokenAccuracy ? { tokenAccuracy: usage.tokenAccuracy } : {}),
        ...(usage.usageSource ? { usageSource: usage.usageSource } : {}),
        ...(usage.usageDetails ? { usageDetails: usage.usageDetails } : {}),
      },
      metadata: {
        providerId: this.config.modelProvider,
        modelId: this.config.modelId,
        ...(finishReason ? { finishReason } : {}),
        startedAt: startedAt.toISOString(),
        completedAt: completedAt.toISOString(),
        durationMs,
        usage: {
          promptTokens: usage.promptTokens,
          completionTokens: usage.completionTokens,
          totalTokens: usage.totalTokens,
          ...(usage.tokenAccuracy ? { tokenAccuracy: usage.tokenAccuracy } : {}),
          ...(usage.usageSource ? { usageSource: usage.usageSource } : {}),
          ...(usage.usageDetails ? { usageDetails: usage.usageDetails } : {}),
        },
      },
      state: this._state,
    };
  }
}

class AsyncEventQueue<T> implements AsyncIterable<T> {
  private queue: T[] = [];
  private resolvers: Array<(result: IteratorResult<T>) => void> = [];
  private closed = false;

  push(value: T): void {
    if (this.closed) return;
    if (this.resolvers.length > 0) {
      const resolver = this.resolvers.shift();
      resolver?.({ value, done: false });
      return;
    }
    this.queue.push(value);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    while (this.resolvers.length > 0) {
      const resolver = this.resolvers.shift();
      resolver?.({ value: undefined as T, done: true });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        if (this.queue.length > 0) {
          const value = this.queue.shift() as T;
          return Promise.resolve({ value, done: false });
        }
        if (this.closed) {
          return Promise.resolve({ value: undefined as T, done: true });
        }
        return new Promise<IteratorResult<T>>((resolve) => {
          this.resolvers.push(resolve);
        });
      },
      return: () => {
        this.close();
        return Promise.resolve({ value: undefined as T, done: true });
      },
    };
  }
}

function mergeUsageDetails(
  base: TokenUsageDetails | undefined,
  incoming: TokenUsageDetails | undefined,
): TokenUsageDetails | undefined {
  if (!base && !incoming) return undefined;
  const merged: TokenUsageDetails = { ...(base ?? {}) };
  if (incoming?.inputNoCacheTokens !== undefined) merged.inputNoCacheTokens = incoming.inputNoCacheTokens;
  if (incoming?.inputCacheReadTokens !== undefined) merged.inputCacheReadTokens = incoming.inputCacheReadTokens;
  if (incoming?.inputCacheWriteTokens !== undefined) merged.inputCacheWriteTokens = incoming.inputCacheWriteTokens;
  if (incoming?.outputTextTokens !== undefined) merged.outputTextTokens = incoming.outputTextTokens;
  if (incoming?.outputReasoningTokens !== undefined) merged.outputReasoningTokens = incoming.outputReasoningTokens;
  if (incoming?.raw) {
    merged.raw = {
      ...((merged.raw ?? {}) as Record<string, unknown>),
      ...(incoming.raw as Record<string, unknown>),
    };
  }
  return merged;
}

function isCliExecutorProvider(providerId: string): boolean {
  return providerId === "claude" || providerId === "codex" || providerId === "gemini";
}

function isNativeCliToolsMode(providerId: string, enabled?: boolean): boolean {
  return enabled === true && isCliExecutorProvider(providerId);
}

function decorateNativeCliToolsResult(
  result: GenerateResult,
  providerId: string,
  modelId: string,
): GenerateResult {
  const notice = buildNativeCliToolsNotice(providerId, modelId);
  const content = result.message.content.trim();
  return {
    ...result,
    message: {
      ...result.message,
      content: content.length > 0 ? `${notice}\n\n${content}` : notice,
    },
  };
}

function buildNativeCliToolsNotice(providerId: string, modelId: string): string {
  const provider = providerId.trim() || "selected executor";
  const model = modelId.trim() || "selected model";
  return `Native executor tools are enabled for ${provider} (${model}). Spaces gateway connectors were not available on this run; the executor may have used its own tools inside the selected workspace.`;
}

function mergeTokenAccuracy(
  base: TokenUsage["tokenAccuracy"],
  incoming: TokenUsage["tokenAccuracy"],
): NonNullable<TokenUsage["tokenAccuracy"]> | undefined {
  if (!base) return incoming;
  if (!incoming) return base;
  if (base === incoming) return base;
  return "mixed";
}

function mergeUsageSource(
  base: TokenUsage["usageSource"],
  incoming: TokenUsage["usageSource"],
): NonNullable<TokenUsage["usageSource"]> | undefined {
  if (!base) return incoming;
  if (!incoming) return base;
  if (base === incoming) return base;
  return "ledger";
}

async function sleepWithAbort(delayMs: number, signal: AbortSignal): Promise<boolean> {
  if (delayMs <= 0) return !signal.aborted;
  if (signal.aborted) return false;

  return await new Promise<boolean>((resolve) => {
    const timeout = setTimeout(() => {
      cleanup();
      resolve(true);
    }, delayMs);

    const onAbort = () => {
      cleanup();
      resolve(false);
    };

    const cleanup = () => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", onAbort);
    };

    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function extractRateLimitErrorInfo(error: unknown): { retryAfterMs?: number } | null {
  const queue: unknown[] = [error];
  const visited = new Set<object>();
  let fallbackRetryAfterMs: number | undefined;

  while (queue.length > 0) {
    const candidate = queue.shift();
    const record = asRecord(candidate);
    if (!record) continue;
    if (visited.has(record)) continue;
    visited.add(record);

    const retryAfterMs = extractRetryAfterMs(record);
    if (retryAfterMs !== undefined && fallbackRetryAfterMs === undefined) {
      fallbackRetryAfterMs = retryAfterMs;
    }

    const statusCode = normalizeStatusCode(record.status) ?? normalizeStatusCode(record.statusCode);
    const normalizedCode = typeof record.code === "string" ? record.code.trim().toUpperCase() : "";
    if (
      statusCode === 429
      || normalizedCode === "429"
      || normalizedCode === "RATE_LIMITED"
      || normalizedCode === "TOO_MANY_REQUESTS"
    ) {
      return { retryAfterMs };
    }

    const nestedResponse = asRecord(record.response);
    if (nestedResponse) queue.push(nestedResponse);
    const nestedCause = asRecord(record.cause);
    if (nestedCause) queue.push(nestedCause);
    const nestedError = asRecord(record.error);
    if (nestedError) queue.push(nestedError);
  }

  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    if (
      message.includes("rate limit")
      || message.includes("too many requests")
      || /\b429\b/.test(message)
    ) {
      return { retryAfterMs: fallbackRetryAfterMs };
    }
  }

  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function normalizeStatusCode(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    const parsed = Number.parseInt(trimmed, 10);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function extractRetryAfterMs(record: Record<string, unknown>): number | undefined {
  const explicitMs = normalizePositiveMs(record.retryAfterMs ?? record.retry_after_ms);
  if (explicitMs !== undefined) return explicitMs;

  const explicitSeconds = normalizePositiveSeconds(record.retryAfterSeconds ?? record.retry_after_seconds);
  if (explicitSeconds !== undefined) return Math.round(explicitSeconds * 1000);

  const retryAfterValue = parseRetryAfterHeaderMs(record.retryAfter ?? record.retry_after);
  if (retryAfterValue !== undefined) return retryAfterValue;

  const headers = record.headers;
  const retryAfterHeaderMs = parseRetryAfterHeaderMs(readHeader(headers, "retry-after"));
  if (retryAfterHeaderMs !== undefined) return retryAfterHeaderMs;

  const retryAfterMsHeader = normalizePositiveMs(readHeader(headers, "retry-after-ms"));
  if (retryAfterMsHeader !== undefined) return retryAfterMsHeader;

  return undefined;
}

function readHeader(headers: unknown, targetHeader: string): unknown {
  if (!headers) return undefined;
  const normalizedTarget = targetHeader.toLowerCase();

  if (typeof headers === "object" && "get" in headers && typeof headers.get === "function") {
    const value = headers.get(targetHeader) ?? headers.get(normalizedTarget);
    if (value !== undefined && value !== null) {
      return value;
    }
  }

  const record = asRecord(headers);
  if (!record) return undefined;

  for (const [key, value] of Object.entries(record)) {
    if (key.toLowerCase() === normalizedTarget) {
      return value;
    }
  }
  return undefined;
}

function parseRetryAfterHeaderMs(value: unknown): number | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    const asSeconds = Number.parseFloat(trimmed);
    if (Number.isFinite(asSeconds) && asSeconds > 0) {
      return Math.round(asSeconds * 1000);
    }
    const asDateMs = Date.parse(trimmed);
    if (Number.isFinite(asDateMs)) {
      const deltaMs = asDateMs - Date.now();
      return deltaMs > 0 ? deltaMs : undefined;
    }
    return undefined;
  }

  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.round(value * 1000);
  }

  return undefined;
}

function normalizePositiveMs(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.round(value);
  }
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.round(parsed);
    }
  }
  return undefined;
}

function normalizePositiveSeconds(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return undefined;
}

function shouldRetryWithoutTools(
  error: unknown,
  _providerId: string,
  _modelId: string,
): boolean {
  if (isGenericToolUnsupportedError(error)) {
    return true;
  }
  const inspection = inspectLmStudioBadRequest(error);
  return inspection.sawBadRequest && inspection.sawToolUnsupported;
}

function isGenericToolUnsupportedError(error: unknown): boolean {
  const queue: unknown[] = [error];
  const visited = new Set<object>();

  while (queue.length > 0) {
    const candidate = queue.shift();
    const record = asRecord(candidate);
    if (!record) continue;
    if (visited.has(record)) continue;
    visited.add(record);

    const code = typeof record.code === "string" ? record.code.trim().toUpperCase() : "";
    if (code === "TOOLS_UNSUPPORTED" || code === "ERR_TOOLS_UNSUPPORTED") {
      return true;
    }

    const message = typeof record.message === "string" ? record.message.toLowerCase() : "";
    if (
      message.includes("tools unsupported")
      || message.includes("tool calls unsupported")
      || message.includes("[spaceskit:tools-unsupported]")
    ) {
      return true;
    }

    const nestedCause = asRecord(record.cause);
    if (nestedCause) queue.push(nestedCause);
    const nestedError = asRecord(record.error);
    if (nestedError) queue.push(nestedError);
    const nestedResponse = asRecord(record.response);
    if (nestedResponse) queue.push(nestedResponse);
  }

  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    return (
      message.includes("tools unsupported")
      || message.includes("tool calls unsupported")
      || message.includes("[spaceskit:tools-unsupported]")
    );
  }

  return false;
}

function toActionableLmStudioBadRequestError(
  error: unknown,
  providerId: string,
  modelId: string,
): Error | null {
  const normalizedProviderId = providerId.trim().toLowerCase();
  const normalizedModelId = modelId.trim().toLowerCase();
  const isLmStudio = normalizedProviderId === "lmstudio" || normalizedModelId.startsWith("lmstudio/");
  if (!isLmStudio) {
    return null;
  }

  const inspection = inspectLmStudioBadRequest(error);
  if (!inspection.sawBadRequest || inspection.sawToolUnsupported) {
    return null;
  }

  const collapsedMessages = inspection.messages.join(" ").toLowerCase();
  const selectedModel = modelId.trim() || "the selected model";
  const modelMissing = (
    collapsedMessages.includes("model not found")
    || collapsedMessages.includes("unknown model")
    || collapsedMessages.includes("does not exist")
    || collapsedMessages.includes("not loaded")
    || (collapsedMessages.includes("model") && collapsedMessages.includes("not available"))
  );

  const guidance = modelMissing
    ? `LM Studio rejected model "${selectedModel}" with 400 Bad Request because it is not loaded. Load the model in LM Studio or choose an available model in Main Agent settings.`
    : `LM Studio returned 400 Bad Request for model "${selectedModel}". Verify that the model is loaded and compatible, then retry.`;
  const mapped = new Error(guidance);
  (mapped as Error & { cause?: unknown }).cause = error;
  return mapped;
}

interface LmStudioBadRequestInspection {
  sawBadRequest: boolean;
  sawToolUnsupported: boolean;
  messages: string[];
}

function inspectLmStudioBadRequest(error: unknown): LmStudioBadRequestInspection {
  const queue: unknown[] = [error];
  const visited = new Set<object>();
  let sawBadRequest = false;
  let sawToolUnsupported = false;
  const messages: string[] = [];
  const seenMessages = new Set<string>();

  while (queue.length > 0) {
    const candidate = queue.shift();
    const record = asRecord(candidate);
    if (!record) continue;
    if (visited.has(record)) continue;
    visited.add(record);

    const statusCode = normalizeStatusCode(record.status) ?? normalizeStatusCode(record.statusCode);
    if (statusCode === 400) {
      sawBadRequest = true;
    }

    const code = typeof record.code === "string" ? record.code.trim().toLowerCase() : "";
    if (
      code === "bad_request"
      || code === "bad_request_error"
      || code === "invalid_argument"
    ) {
      sawBadRequest = true;
    }

    for (const messageCandidate of [
      record.message,
      record.error,
      readNestedMessage(record.details),
      readNestedMessage(record.body),
    ]) {
      if (typeof messageCandidate !== "string") continue;
      const normalized = messageCandidate.trim().toLowerCase();
      if (!normalized) continue;
      if (!seenMessages.has(normalized)) {
        seenMessages.add(normalized);
        messages.push(messageCandidate.trim());
      }
      if (normalized.includes("bad request")) {
        sawBadRequest = true;
      }
      if (isToolUnsupportedBadRequestMessage(normalized)) {
        sawToolUnsupported = true;
      }
    }

    for (const nested of [record.response, record.cause, record.error, record.details, record.body, record.data]) {
      const nestedRecord = asRecord(nested);
      if (nestedRecord) queue.push(nestedRecord);
    }
  }

  if (error instanceof Error) {
    const normalizedErrorMessage = error.message.toLowerCase();
    if (!seenMessages.has(normalizedErrorMessage) && normalizedErrorMessage.trim().length > 0) {
      messages.push(error.message.trim());
    }
    if (normalizedErrorMessage.includes("bad request")) {
      sawBadRequest = true;
    }
    if (isToolUnsupportedBadRequestMessage(normalizedErrorMessage)) {
      sawToolUnsupported = true;
    }
  }

  return { sawBadRequest, sawToolUnsupported, messages };
}

function readNestedMessage(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  const record = asRecord(value);
  if (!record) return undefined;
  const message = record.message;
  return typeof message === "string" ? message : undefined;
}

function isToolUnsupportedBadRequestMessage(message: string): boolean {
  return (
    message.includes("tool is not supported")
    || message.includes("tools are not supported")
    || message.includes("does not support tools")
    || message.includes("function calling is not supported")
    || message.includes("function calling not supported")
    || message.includes("unsupported tool")
    || message.includes("unsupported function")
    || (message.includes("role") && message.includes("tool"))
  );
}

function buildToolUnsupportedFallbackNotice(providerId: string, modelId: string): string {
  const providerTrimmed = providerId.trim();
  const modelTrimmed = modelId.trim();
  const provider = providerTrimmed.length > 0 ? providerTrimmed : "selected provider";
  const model = modelTrimmed.length > 0 ? modelTrimmed : "selected model";
  return `Tool calling is unavailable for ${provider} (${model}). This turn ran in text-only mode, so connectors/tools could not be executed. Switch to a tool-capable model/provider to enable tools.`;
}

function buildToolUsageGuidance(toolDefs: ToolDefinition[]): string {
  const toolList = toolDefs
    .map((tool) => tool.name.trim())
    .filter((toolName) => toolName.length > 0)
    .slice(0, 40);
  const listedTools = toolList.length > 0 ? toolList.join(", ") : "none";

  return `${TOOL_GUIDANCE_MARKER}
You can use tools in this conversation.
- Prefer tool calls when the user asks for live data, external state, reminders/calendars/lists, filesystem changes, or actions.
- Do not claim you lack access before attempting relevant tool calls.
- If tool calls fail, explain the failure and provide the next best action.
- For 'lists.*' tools: call 'lists.listLists' first when listId is unknown. Only set targetProvider when you know an exact provider id; never use placeholders like "none" or "default".
Available tools: ${listedTools}`;
}

function shouldRetryToolDiscovery(messages: ModelMessage[]): boolean {
  const latestUserMessage = [...messages].reverse().find((message) => message.role === "user");
  const prompt = latestUserMessage?.content.trim().toLowerCase();
  if (!prompt) return false;
  const hints = [
    "reminder",
    "todo",
    "task",
    "calendar",
    "schedule",
    "event",
    "list",
    "file",
    "folder",
    "workspace",
    "shell",
    "terminal",
    "run command",
    "open",
    "fetch",
    "check",
  ];
  return hints.some((hint) => prompt.includes(hint));
}
