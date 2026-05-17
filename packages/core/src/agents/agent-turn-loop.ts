import { randomUUID } from "node:crypto";
import type {
  CliExecutionObserver,
  ModelProvider,
  ModelMessage,
  ToolCall,
  ToolResult,
  GenerateOptions,
  GenerateResult,
  TokenUsage,
  FinishReason,
} from "./model-provider.js";
import type { ProviderSessionHandle } from "./model-provider.js";
import type {
  AgentConfig,
  AgentState,
  TurnContext,
  TurnEvent,
  RuntimeFeedbackCheckpoint,
} from "./agent-runtime.js";
import type { ToolExecutor } from "./tool-executor.js";
import type { MiddlewarePipeline } from "../middleware/pipeline.js";
import type { CapabilityExecutionOrigin } from "../capabilities/registry.js";
import { MiddlewarePipeline as Pipeline } from "../middleware/pipeline.js";
import { computeRetryDecision, DEFAULT_PROVIDER_RETRY_CONFIG } from "./provider-retry.js";
import { ProviderRateLimitError } from "../errors/runtime-errors.js";
import {
  type FeedbackResponse,
} from "./agent-runtime-feedback.js";
import { AsyncEventQueue, sleepWithAbort } from "./agent-runtime-async.js";
import {
  resolveTurnAccessMode,
  isNativeCliToolsMode,
  buildCliExecutorAccessModeGuidance,
} from "./agent-runtime-access-mode.js";
import {
  extractRateLimitErrorInfo,
} from "./agent-runtime-errors.js";
import { resolveModelCapabilities } from "./model-capability-registry.js";
import {
  parseFencedToolCalls,
  stripFencedToolCallBlocks,
} from "./mediated-tool-calls.js";
import {
  type LlmCallResult,
  mergeUsageDetails,
  runLlmCall,
  mergeTokenAccuracy,
  mergeUsageSource,
} from "./agent-runtime-streaming.js";
import {
  buildTurnResult,
} from "./agent-runtime-turn-result.js";
import type { ProviderFeedbackRequest, ProviderFeedbackResponse } from "./model-provider.js";
import {
  cleanupTurnTools,
  configureTurnTools,
} from "./agent-turn-loop-tool-setup.js";
import { executeTurnToolCalls } from "./agent-turn-loop-tool-execution.js";
import {
  estimateMissingUsage,
  maybeBuildToolInventoryResponse,
  resolveThinkingConfig,
} from "./agent-turn-loop-helpers.js";

export interface AgentTurnLoopDeps {
  agentId: string;
  config: AgentConfig;
  modelProvider: ModelProvider;
  toolExecutor: ToolExecutor;
  middleware: MiddlewarePipeline;
  setState: (state: AgentState) => void;
  waitForFeedback: (turnId: string) => Promise<FeedbackResponse>;
  /**
   * Resolve whether the approval_bypass dangerous capability is enabled for
   * this agent in this space. When true AND accessMode is full_access, CLI
   * executors receive bypass-class permission flags (e.g. --permission-mode
   * bypassPermissions). Falls back to false when not provided.
   */
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
  /**
   * Forwards informational prompt-bridge warnings (such as malformed
   * tool-call ids that are coerced into assistant fallback notes) to the
   * caller. Default is silent.
   */
  onPromptBridgeWarning?: (payload: Record<string, unknown>) => void;
}

export async function* runAgentTurnCoreLoop(
  deps: AgentTurnLoopDeps,
  context: TurnContext,
  messages: ModelMessage[],
  totalUsage: TokenUsage,
  allToolCalls: ToolCall[],
  allToolResults: ToolResult[],
  signal: AbortSignal,
  turnStartedAt: Date,
): AsyncIterable<TurnEvent> {
  deps.setState("thinking");
  yield { type: "state_changed", state: "thinking" };

  const accessMode = resolveTurnAccessMode(
    context.accessMode,
    deps.config.accessMode,
    deps.config.modelProvider,
  );
  const nativeCliToolsMode = isNativeCliToolsMode(deps.config.modelProvider, accessMode);
  const capabilities = resolveModelCapabilities(deps.config.modelProvider, deps.config.modelId);
  const isMediated = capabilities.toolSupportMode === "mediated";
  const cliAccessModeGuidance = buildCliExecutorAccessModeGuidance(deps.config.modelProvider, accessMode, { isMediated });
  if (cliAccessModeGuidance) {
    messages.splice(1, 0, {
      role: "system",
      content: cliAccessModeGuidance,
    });
  }

  const toolSetup = await configureTurnTools({
    toolExecutor: deps.toolExecutor,
    context,
    agentId: deps.agentId,
    providerId: deps.config.modelProvider,
    workingDirectory: deps.config.workingDirectory,
    messages,
    isMediated,
    signal,
  });
  const {
    toolDefs,
    mediatedToolDefs,
    mediatedFallbackEnabled,
    suppressInjectedTools,
    gatewayToolBridgeConfig,
  } = toolSetup;

  const inventoryToolDefs = isMediated ? mediatedToolDefs : toolDefs;
  const toolInventoryResponse = maybeBuildToolInventoryResponse(context.messages, inventoryToolDefs);
  if (toolInventoryResponse) {
    const inventoryMessage: ModelMessage = {
      role: "assistant",
      content: toolInventoryResponse,
    };
    messages.push(inventoryMessage);
    deps.setState("idle");
    yield { type: "state_changed", state: "idle" };
    yield {
      type: "turn_completed",
      result: buildTurnResult({
        agentId: deps.agentId,
        providerId: deps.config.modelProvider,
        modelId: deps.config.modelId,
        resolvedSafetyProfileId: deps.config.resolvedSafetyProfileId,
        state: "idle",
        turnId: context.turnId,
        messages,
        toolCalls: allToolCalls,
        toolResults: allToolResults,
        usage: totalUsage,
        finalMessage: inventoryMessage,
        startedAt: turnStartedAt,
        completedAt: new Date(),
      }),
    };
    return;
  }

  let finalMessage: ModelMessage | null = null;
  let finalFinishReason: FinishReason | undefined;
  let finalResponseStreamed = false;
  let providerSessionHandle: ProviderSessionHandle | undefined = context.providerSessionHandle;

  for (let step = 0; step < deps.config.maxSteps; step++) {
    if (signal.aborted) {
      deps.setState("idle");
      yield { type: "state_changed", state: "idle" };
      break;
    }

    const approvalBypassEnabled = deps.resolveApprovalBypass
      ? await deps.resolveApprovalBypass(
        context.spaceId,
        deps.agentId,
        accessMode ?? "default",
        context.executionOrigin,
      )
      : false;

    const thinkingConfig = resolveThinkingConfig(context.effort, capabilities);
    const cliExecutionObserver = deps.createCliExecutionObserver
      ? await deps.createCliExecutionObserver({
        spaceId: context.spaceId,
        turnId: context.turnId,
        agentId: deps.agentId,
        stepIndex: step,
        providerId: deps.config.modelProvider,
        modelId: deps.config.modelId,
      })
      : undefined;

    const baseGenerateOpts: GenerateOptions = {
      messages,
      mode: context.mode,
      effort: context.effort,
      modelId: deps.config.modelId,
      tools: toolDefs.length > 0 ? toolDefs : undefined,
      temperature: deps.config.temperature,
      workingDirectory: deps.config.workingDirectory,
      accessMode,
      approvalBypassEnabled,
      gatewayToolBridgeConfig,
      thinkingConfig,
      providerSessionHandle,
      sessionTitle: context.sessionTitle,
      cliExecutionObserver,
      signal,
    };

    let result: GenerateResult | null = null;
    let streamedTextDeltaCount = 0;

    for (let retryAttempt = 0; ; retryAttempt++) {
      try {
        const llmEventQueue = new AsyncEventQueue<TurnEvent>();
        let rawResult: LlmCallResult | null = null;
        let llmError: Error | null = null;

        const generateOpts: GenerateOptions = {
          ...baseGenerateOpts,
          feedbackHandler: async (request: ProviderFeedbackRequest): Promise<ProviderFeedbackResponse> => {
            const checkpoint: RuntimeFeedbackCheckpoint = {
              id: randomUUID(),
              agentId: deps.agentId,
              triggerClass: request.triggerClass,
              description: request.description,
              options: request.options ?? ["approve", "reject"],
              ...(request.context ? { context: request.context } : {}),
            };
            deps.setState("needs_feedback");
            llmEventQueue.push({ type: "state_changed", state: "needs_feedback" });
            llmEventQueue.push({ type: "feedback_requested", request: checkpoint });
            const feedback = await deps.waitForFeedback(context.turnId);
            deps.setState("thinking");
            llmEventQueue.push({ type: "state_changed", state: "thinking" });
            return feedback;
          },
        };
        const llmCtx = Pipeline.createContext("llm", generateOpts, {
          spaceId: context.spaceId,
          agentId: deps.agentId,
          turnId: context.turnId,
          metadata: {
            step,
            retryAttempt,
            modelId: deps.config.modelId,
            spaceId: context.spaceId,
            agentId: deps.agentId,
            turnId: context.turnId,
          },
        });

        const llmRunPromise = deps.middleware.execute("llm", llmCtx, async () => {
          rawResult = await runLlmCall({
            modelProvider: deps.modelProvider,
            providerId: deps.config.modelProvider,
            modelId: deps.config.modelId,
            generateOpts,
            emitEvent: (event) => llmEventQueue.push(event),
          });
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

        if (llmCtx.terminate || !rawResult) {
          if (llmCtx.output && typeof llmCtx.output === "object" && "feedbackRequest" in llmCtx.output) {
            const feedback = (llmCtx.output as { feedbackRequest: RuntimeFeedbackCheckpoint }).feedbackRequest;
            deps.setState("needs_feedback");
            yield { type: "state_changed", state: "needs_feedback" };
            yield { type: "feedback_requested", request: feedback };
            return;
          }
          break;
        }

        const resolvedResult = rawResult as LlmCallResult;
        if (resolvedResult.result.feedbackRequest) {
          const feedback = resolvedResult.result.feedbackRequest;
          const checkpoint: RuntimeFeedbackCheckpoint = {
            id: randomUUID(),
            agentId: deps.agentId,
            triggerClass: feedback.triggerClass,
            description: feedback.description,
            options: feedback.options ?? ["approve", "reject"],
            ...(feedback.context ? { context: feedback.context } : {}),
          };
          deps.setState("needs_feedback");
          yield { type: "state_changed", state: "needs_feedback" };
          yield { type: "feedback_requested", request: checkpoint };
          return;
        }
        streamedTextDeltaCount = resolvedResult.streamedTextDeltaCount;
        result = resolvedResult.result;
        break;
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
            provider: deps.modelProvider.id,
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
          providerId: deps.modelProvider.id,
          retryAt,
        };

        const didWait = await sleepWithAbort(decision.delayMs, signal);
        if (!didWait) {
          break;
        }
      }
    }

    if (signal.aborted) {
      deps.setState("idle");
      yield { type: "state_changed", state: "idle" };
      break;
    }

    if (!result) {
      break;
    }
    let llmResult = result;

    if (mediatedFallbackEnabled && !llmResult.message.toolCalls && mediatedToolDefs.length > 0) {
      const parsedToolCalls = parseFencedToolCalls(llmResult.message.content, {
        allowedToolNames: mediatedToolDefs.map((tool) => tool.name),
      });
      if (parsedToolCalls.length > 0) {
        llmResult = {
          ...llmResult,
          message: {
            ...llmResult.message,
            content: stripFencedToolCallBlocks(llmResult.message.content),
            toolCalls: parsedToolCalls,
          },
          finishReason: "tool_calls",
        };
      }
    }

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

    // Capture provider session handle for subsequent steps/turns
    if (llmResult.providerSessionHandle) {
      providerSessionHandle = llmResult.providerSessionHandle;
    }

    messages.push(llmResult.message);

    if (llmResult.finishReason === "stop" || llmResult.finishReason === "length") {
      finalMessage = llmResult.message;
      finalFinishReason = llmResult.finishReason;
      finalResponseStreamed = streamedTextDeltaCount > 0;
      break;
    }

    if (llmResult.finishReason === "tool_calls" && llmResult.message.toolCalls) {
      yield* executeTurnToolCalls({
        deps,
        context,
        messages,
        toolCalls: llmResult.message.toolCalls,
        allToolCalls,
        allToolResults,
        suppressInjectedTools,
        signal,
      });
      continue;
    }

    finalMessage = llmResult.message;
    finalFinishReason = llmResult.finishReason;
    break;
  }

  finalMessage = finalMessage ?? messages[messages.length - 1];
  deps.setState("idle");
  yield { type: "state_changed", state: "idle" };

  if (finalMessage && finalMessage.content && !finalResponseStreamed) {
    yield { type: "text_delta", text: finalMessage.content };
  }

  estimateMissingUsage(messages, totalUsage);

  await cleanupTurnTools(toolSetup);

  yield {
    type: "turn_completed",
    result: buildTurnResult({
      agentId: deps.agentId,
      providerId: deps.config.modelProvider,
      modelId: deps.config.modelId,
      resolvedSafetyProfileId: deps.config.resolvedSafetyProfileId,
      state: "idle",
      turnId: context.turnId,
      messages,
      toolCalls: allToolCalls,
      toolResults: allToolResults,
      usage: totalUsage,
      finalMessage,
      startedAt: turnStartedAt,
      completedAt: new Date(),
      finishReason: finalFinishReason,
      providerSessionHandle,
    }),
  };
}
