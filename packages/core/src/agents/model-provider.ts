/**
 * ModelProvider — the abstraction that keeps us independent of any SDK.
 *
 * Native HTTP runtimes, local daemons, CLI executors, or any
 * other LLM backend can be wrapped behind this interface. The gateway
 * runtime only speaks this contract.
 */

export interface ModelMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCallId?: string;
  toolName?: string;
  toolCalls?: ToolCall[];
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResult {
  toolCallId: string;
  result: unknown;
  isError?: boolean;
}

export type TurnAccessMode = "default" | "full_access";
export type TurnExecutionMode = "ask" | "plan" | "execute";
export type TurnReasoningEffort = "low" | "medium" | "high" | "max";

/**
 * Provider-native thinking/reasoning configuration.
 *
 * Maps to real API parameters:
 * - Anthropic: `thinking: { type, budget_tokens, display }`
 * - OpenAI o-series: `reasoning_effort: "low"|"medium"|"high"`
 * - Gemini: `thinking_config: { thinking_level }` or `thinking_budget`
 */
export interface ThinkingConfig {
  enabled: boolean | "adaptive";
  budgetTokens?: number;
  display?: "summarized" | "omitted";
}

export interface ProviderFeedbackRequest {
  triggerClass:
    | "permission_gate"
    | "policy_escalation"
    | "high_impact"
    | "ambiguity"
    | "conflict"
    | "security";
  description: string;
  options?: ("approve" | "reject" | "revise" | "defer")[];
  context?: Record<string, unknown>;
}

export interface ProviderFeedbackResponse {
  action: "approve" | "reject" | "revise" | "defer";
  revision?: string;
}

export type TranscriptVisibility = "visible" | "activity_only" | "summary";
export type StreamKind = "assistant_output" | "provider_client";

/**
 * Opaque handle for provider-side session state that persists across turns.
 *
 * - OpenAI Responses API: `previous_response_id` for server-side history chaining
 * - Other providers: currently unused (prompt caching is transparent)
 */
export type ProviderSessionHandle =
  | { type: "openai_response"; previousResponseId: string }
  | { type: "codex_app_server_thread"; threadId: string }
  | { type: "none" };

export interface GatewayToolBridgeConfig {
  /** Absolute path to the gateway MCP bridge stdio script. */
  bridgeScriptPath: string;
  /** JSON-serialized array of ToolDefinition for the bridge to expose. */
  toolDefsJson: string;
  /** Path to the Unix domain socket for proxying tool execution back to the gateway. */
  socketPath: string;
}

export interface GenerateOptions {
  messages: ModelMessage[];
  mode?: TurnExecutionMode;
  effort?: TurnReasoningEffort;
  /**
   * Fully qualified model ID for middleware/model-aware policy decisions.
   * Example: "lmstudio/google/gemma-3-4b-it".
   */
  modelId?: string;
  tools?: ToolDefinition[];
  temperature?: number;
  maxTokens?: number;
  stopSequences?: string[];
  workingDirectory?: string;
  accessMode?: TurnAccessMode;
  /** Whether the approval_bypass dangerous capability is active for this turn. */
  approvalBypassEnabled?: boolean;
  /**
   * Gateway tool bridge configuration for mediated executors. When set, the
   * runtime can expose gateway tools through an MCP bridge or dynamic tool
   * proxy, depending on provider capabilities.
   */
  gatewayToolBridgeConfig?: GatewayToolBridgeConfig;
  /** Provider-native thinking/reasoning configuration resolved from effort + capabilities. */
  thinkingConfig?: ThinkingConfig;
  /** Opaque session handle from a prior turn for providers that support server-side history. */
  providerSessionHandle?: ProviderSessionHandle;
  /** User-facing title for provider-native sessions/threads that support naming. */
  sessionTitle?: string;
  /** Internal runtime callback for provider-native approval gates. */
  feedbackHandler?: (request: ProviderFeedbackRequest) => Promise<ProviderFeedbackResponse>;
  /**
   * Optional observer for native CLI executions.
   *
   * Used by the gateway to persist raw CLI transcript artifacts and replayable
   * execution metadata without exposing raw stdout/stderr to normal clients.
   */
  cliExecutionObserver?: CliExecutionObserver;
  signal?: AbortSignal;
}

export interface GenerateResult {
  message: ModelMessage;
  usage?: TokenUsage;
  finishReason: FinishReason;
  /** Opaque session handle for providers that support server-side history chaining. */
  providerSessionHandle?: ProviderSessionHandle;
  /** Provider-native feedback checkpoint that paused turn execution. */
  feedbackRequest?: ProviderFeedbackRequest;
}

export interface StreamChunk {
  type:
    | "text_delta"
    | "reasoning_delta"
    | "state_changed"
    | "tool_call_start"
    | "tool_call_delta"
    | "tool_call_end"
    | "tool_result"
    | "rate_limited"
    | "feedback_request"
    | "finish";
  text?: string;
  transcriptVisibility?: TranscriptVisibility;
  streamKind?: StreamKind;
  toolCall?: Partial<ToolCall>;
  toolResult?: ToolResult;
  state?: string;
  retryAfterMs?: number;
  retryAfterSeconds?: number;
  attempt?: number;
  maxAttempts?: number;
  providerId?: string;
  retryAt?: string;
  providerSessionHandle?: ProviderSessionHandle;
  feedbackRequest?: ProviderFeedbackRequest;
  usage?: TokenUsage;
  finishReason?: FinishReason;
}

export type CliExecutionMode = "generate" | "stream";

export type CliExecutionObserverEvent =
  | {
    type: "started";
    mode: CliExecutionMode;
    startedAt: string;
    providerId: string;
    modelId: string;
    commandPreview: string;
    workingDirectory?: string;
  }
  | { type: "stdout"; chunk: string }
  | { type: "stderr"; chunk: string }
  | { type: "parsed"; chunk: StreamChunk }
  | {
    type: "completed";
    completedAt: string;
    durationMs: number;
    exitCode: number;
  }
  | {
    type: "failed";
    completedAt: string;
    durationMs: number;
    errorMessage: string;
  };

export type CliExecutionObserver = (event: CliExecutionObserverEvent) => void | Promise<void>;

export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON Schema for the tool's input parameters. */
  inputSchema: Record<string, unknown>;
  /** JSON Schema for the tool's output (optional). */
  outputSchema?: Record<string, unknown>;
  /**
   * If true, the tool requires human approval before execution.
   * Maps to Spaceskit's approval/feedback contract.
   */
  requiresApproval?: boolean;
}

export type FinishReason =
  | "stop"
  | "tool_calls"
  | "length"
  | "error"
  | "content_filter"
  | "other";

export interface TokenUsageDetails {
  inputNoCacheTokens?: number;
  inputCacheReadTokens?: number;
  inputCacheWriteTokens?: number;
  outputTextTokens?: number;
  outputReasoningTokens?: number;
  raw?: Record<string, unknown>;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  tokenAccuracy?: "reported" | "estimated" | "mixed";
  usageSource?: "ledger" | "local_scanner";
  usageDetails?: TokenUsageDetails;
}

/**
 * Core interface for any LLM provider.
 *
 * Implementations:
 * - OpenAICompatibleModelProvider: direct HTTP for cloud APIs and local runtimes
 * - CliExecutorModelProvider: native CLI execution
 * - UnsupportedModelProvider: explicit unsupported-path placeholder
 */
export interface ModelProvider {
  readonly id: string;
  readonly name: string;
  readonly isLocal: boolean;

  /** Check if the provider is currently available and responsive. */
  checkHealth(): Promise<{ available: boolean; latencyMs?: number }>;

  /** List available models from this provider. */
  listModels(): Promise<ModelInfo[]>;

  /** Generate a complete response (non-streaming). */
  generate(model: string, options: GenerateOptions): Promise<GenerateResult>;

  /** Generate a streaming response. Returns an async iterable of chunks. */
  stream(model: string, options: GenerateOptions): AsyncIterable<StreamChunk>;
}

export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  contextWindow?: number;
  supportsTools?: boolean;
  supportsVision?: boolean;
  isLocal: boolean;
}
