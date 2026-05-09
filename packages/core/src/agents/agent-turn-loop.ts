import { randomUUID } from "node:crypto";
import type {
  CliExecutionObserver,
  ModelProvider,
  ModelMessage,
  ToolCall,
  ToolResult,
  ToolDefinition,
  GenerateOptions,
  GenerateResult,
  TokenUsage,
  FinishReason,
} from "./model-provider.js";
import type { ThinkingConfig, TurnReasoningEffort, ProviderSessionHandle } from "./model-provider.js";
import type { ModelCapabilities } from "./model-capability-registry.js";
import type {
  AgentConfig,
  AgentState,
  TurnContext,
  TurnEvent,
  RuntimeFeedbackCheckpoint,
} from "./agent-runtime.js";
import type { ToolExecutor, ToolPermission, ToolExecutionContext } from "./tool-executor.js";
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
import { GatewayToolProxy } from "./gateway-tool-proxy.js";
import { resolveMcpBridgeScriptPath } from "./gateway-mcp-bridge-config.js";
import {
  normalizeApprovalContext,
  resolveToolDefinitionsForTurn,
  buildToolUsageGuidance,
  buildMediatedToolPrompt,
  shouldSuppressInjectedToolsForPrompt,
  writeMcpDiscoveryConfig,
  cleanupMcpDiscoveryConfig,
} from "./agent-runtime-tools.js";
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
  appendToolResultMessage,
  buildTurnResult,
} from "./agent-runtime-turn-result.js";
import type { ProviderFeedbackRequest, ProviderFeedbackResponse } from "./model-provider.js";

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
    deps.config.nativeCliToolsEnabled,
  );
  const suppressInjectedTools = shouldSuppressInjectedToolsForPrompt(context.messages);
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

  let toolDefs: ToolDefinition[] = [];
  let mediatedToolDefs: ToolDefinition[] = [];
  let mediatedFallbackEnabled = false;
  let toolProxy: GatewayToolProxy | null = null;
  let gatewayToolBridgeConfig: import("./model-provider.js").GatewayToolBridgeConfig | undefined;
  let mcpDiscoveryFilePath: string | undefined;

  // Providers that can consume the gateway tool bridge directly.
  const gatewayToolBridgeProviders = new Set(["claude", "codex", "claude-agent-sdk", "codex-app-server"]);
  // Providers that also support MCP file discovery (.mcp.json in workspace).
  const mcpDiscoveryProviders = new Set(["claude", "codex"]);

  if (isMediated) {
    mediatedToolDefs = await resolveToolDefinitionsForTurn(
      deps.toolExecutor, context.spaceId, deps.agentId, signal,
      context.messages, suppressInjectedTools,
    );
    if (mediatedToolDefs.length > 0) {
      const bridgeScriptPath = resolveMcpBridgeScriptPath();
      const providerSupportsGatewayToolBridge = gatewayToolBridgeProviders.has(deps.config.modelProvider);
      const providerSupportsMcpDiscovery = mcpDiscoveryProviders.has(deps.config.modelProvider);
      if (bridgeScriptPath && providerSupportsGatewayToolBridge) {
        // Full MCP bridge — gateway tools become callable MCP tools
        const executionCtx = {
          spaceId: context.spaceId,
          agentId: deps.agentId,
          turnId: context.turnId,
          lineageId: context.lineageId,
          principalId: context.principalId,
          deviceId: context.deviceId,
          executionOrigin: context.executionOrigin,
          accessMode: context.accessMode,
          suppressInjectedTools,
        };
        toolProxy = await GatewayToolProxy.create(deps.toolExecutor, executionCtx, signal);
        const toolDefsJson = JSON.stringify(mediatedToolDefs);

        // Write .mcp.json to workspace for CLI auto-discovery (fallback)
        if (providerSupportsMcpDiscovery && deps.config.workingDirectory) {
          try {
            mcpDiscoveryFilePath = await writeMcpDiscoveryConfig(
              deps.config.workingDirectory,
              { bridgeScriptPath, toolDefsJson, socketPath: toolProxy.socketPath },
            );
          } catch {
            // Non-fatal — CLI flag path is primary for both Claude and Codex
          }
        }

        gatewayToolBridgeConfig = {
          bridgeScriptPath,
          toolDefsJson,
          socketPath: toolProxy.socketPath,
        };
      } else {
        // Text-only fallback for Gemini/Apple or missing bridge script
        mediatedFallbackEnabled = true;
        messages.splice(1, 0, {
          role: "system",
          content: buildMediatedToolPrompt(mediatedToolDefs),
        });
      }
    }
    // toolDefs stays [] — these providers reject structured tools
  } else {
    // Native tool-call providers (Anthropic API, OpenAI, etc.)
    toolDefs = await resolveToolDefinitionsForTurn(
      deps.toolExecutor, context.spaceId, deps.agentId, signal,
      context.messages, suppressInjectedTools,
    );
    if (toolDefs.length > 0) {
      messages.splice(1, 0, {
        role: "system",
        content: buildToolUsageGuidance(toolDefs),
      });
    }
  }

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
      nativeCliToolsEnabled: nativeCliToolsMode,
      gatewayToolBridgeConfig,
      mcpBridgeConfig: gatewayToolBridgeConfig,
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
            nativeCliToolsEnabled: deps.config.nativeCliToolsEnabled,
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
      deps.setState("acting");
      yield { type: "state_changed", state: "acting" };

      const toolCalls = llmResult.message.toolCalls;
      const executionCtx: ToolExecutionContext = {
        spaceId: context.spaceId,
        agentId: deps.agentId,
        turnId: context.turnId,
        lineageId: context.lineageId,
        principalId: context.principalId,
        deviceId: context.deviceId,
        executionOrigin: context.executionOrigin,
        accessMode: context.accessMode,
        suppressInjectedTools,
      };

      const permissionChecks = await Promise.all(
        toolCalls.map((tc) => deps.toolExecutor.checkPermission(tc, executionCtx)),
      );

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

      for (const { toolCall, permission } of denied) {
        yield { type: "tool_call_start", toolCall };
        const errorResult: ToolResult = {
          toolCallId: toolCall.id,
          result: `Permission denied: ${permission.reason}`,
          isError: true,
        };
        allToolResults.push(errorResult);
        appendToolResultMessage({
          messages,
          context,
          toolCall,
          rawResult: errorResult.result,
          agentId: deps.agentId,
          providerId: deps.config.modelProvider,
          modelId: deps.config.modelId,
          onPromptBridgeWarning: deps.onPromptBridgeWarning,
        });
        yield { type: "tool_result", result: errorResult };
      }

      if (autoApproved.length > 0 && !signal.aborted) {
        for (const toolCall of autoApproved) {
          yield { type: "tool_call_start", toolCall };
        }

        const parallelResults = await Promise.all(
          autoApproved.map((toolCall) =>
            deps.toolExecutor.execute(toolCall, executionCtx),
          ),
        );

        for (let i = 0; i < autoApproved.length; i++) {
          const toolCall = autoApproved[i];
          const toolResult = parallelResults[i];
          allToolResults.push(toolResult);
          appendToolResultMessage({
            messages,
            context,
            toolCall,
            rawResult: toolResult.result,
            agentId: deps.agentId,
            providerId: deps.config.modelProvider,
            modelId: deps.config.modelId,
            onPromptBridgeWarning: deps.onPromptBridgeWarning,
          });
          yield { type: "tool_result", result: toolResult };
        }
      }

      for (const { toolCall, permission } of needsApproval) {
        if (signal.aborted) break;

        yield { type: "tool_call_start", toolCall };

        const approvalContext = normalizeApprovalContext(permission.approvalContext, toolCall.name);
        const checkpoint: RuntimeFeedbackCheckpoint = {
          id: randomUUID(),
          agentId: deps.agentId,
          triggerClass: approvalContext ? "policy_escalation" : "permission_gate",
          description: permission.reason ?? `Tool "${toolCall.name}" requires approval`,
          options: ["approve", "reject"],
          ...(approvalContext ? { context: approvalContext } : {}),
        };

        deps.setState("needs_feedback");
        yield { type: "state_changed", state: "needs_feedback" };
        yield { type: "feedback_requested", request: checkpoint };

        const feedbackResult = await deps.waitForFeedback(context.turnId);
        if (feedbackResult.action === "reject" || feedbackResult.action === "defer") {
          const deniedResult: ToolResult = {
            toolCallId: toolCall.id,
            result: "Tool execution denied by human reviewer",
            isError: true,
          };
          allToolResults.push(deniedResult);
          appendToolResultMessage({
            messages,
            context,
            toolCall,
            rawResult: deniedResult.result,
            agentId: deps.agentId,
            providerId: deps.config.modelProvider,
            modelId: deps.config.modelId,
            onPromptBridgeWarning: deps.onPromptBridgeWarning,
          });
          yield { type: "tool_result", result: deniedResult };
          continue;
        }

        deps.setState("acting");
        yield { type: "state_changed", state: "acting" };

        const toolResult = await deps.toolExecutor.execute(toolCall, executionCtx);
        allToolResults.push(toolResult);
        appendToolResultMessage({
          messages,
          context,
          toolCall,
          rawResult: toolResult.result,
          agentId: deps.agentId,
          providerId: deps.config.modelProvider,
          modelId: deps.config.modelId,
          onPromptBridgeWarning: deps.onPromptBridgeWarning,
        });
        yield { type: "tool_result", result: toolResult };
      }

      deps.setState("thinking");
      yield { type: "state_changed", state: "thinking" };
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

  // Clean up MCP bridge proxy socket and .mcp.json discovery file
  toolProxy?.close();
  if (mcpDiscoveryFilePath) {
    await cleanupMcpDiscoveryConfig(mcpDiscoveryFilePath);
  }

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

function maybeBuildToolInventoryResponse(
  messages: ModelMessage[],
  toolDefs: ToolDefinition[],
): string | null {
  const latestUserMessage = [...messages].reverse().find((message) => message.role === "user");
  const prompt = latestUserMessage?.content.trim().toLowerCase();
  if (!prompt) {
    return null;
  }

  const inventoryPatterns = [
    "which tools are available",
    "what tools are available",
    "what tools do you have",
    "what tools can you use",
    "list your tools",
    "list available tools",
    "show available tools",
  ];
  if (!inventoryPatterns.some((pattern) => prompt.includes(pattern))) {
    return null;
  }

  if (toolDefs.length === 0) {
    return "No tools are currently available in this space for this turn.";
  }

  const groups = new Map<string, string[]>();
  for (const tool of toolDefs) {
    const name = tool.name.trim();
    if (!name) continue;
    const prefix = name.split(".")[0] ?? "other";
    const existing = groups.get(prefix) ?? [];
    existing.push(name);
    groups.set(prefix, existing);
  }

  const lines = ["Available tools in this space:"];
  for (const prefix of Array.from(groups.keys()).sort((lhs, rhs) => lhs.localeCompare(rhs))) {
    const names = (groups.get(prefix) ?? []).sort((lhs, rhs) => lhs.localeCompare(rhs));
    const listed = names.slice(0, 8);
    const remaining = Math.max(0, names.length - listed.length);
    lines.push(`- ${prefix}: ${listed.join(", ")}${remaining > 0 ? `, +${remaining} more` : ""}`);
  }
  if (toolDefs.length > 40) {
    lines.push(`- Total tools: ${toolDefs.length}`);
  }
  return lines.join("\n");
}

/**
 * Resolve provider-native thinking configuration from the per-turn effort
 * level and the provider's declared capabilities.
 *
 * Returns undefined when the provider does not support any thinking/reasoning
 * parameters, so the adapter can safely ignore it.
 */
function resolveThinkingConfig(
  effort: TurnReasoningEffort | undefined,
  capabilities: ModelCapabilities,
): ThinkingConfig | undefined {
  if (!effort) return undefined;

  // Anthropic-style extended thinking (budget_tokens)
  if (capabilities.supportsThinking) {
    const budgetMap: Record<TurnReasoningEffort, number> = {
      low: 1_024,
      medium: 4_096,
      high: 16_384,
      max: 32_768,
    };
    return {
      enabled: true,
      budgetTokens: budgetMap[effort],
      display: "summarized",
    };
  }

  // OpenAI o-series reasoning_effort — handled directly by the provider adapter
  // via options.effort, so no ThinkingConfig needed here.
  return undefined;
}
