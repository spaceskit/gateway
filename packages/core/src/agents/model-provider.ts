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

export interface GenerateOptions {
  messages: ModelMessage[];
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
  nativeCliToolsEnabled?: boolean;
  signal?: AbortSignal;
}

export interface GenerateResult {
  message: ModelMessage;
  usage?: TokenUsage;
  finishReason: FinishReason;
}

export interface StreamChunk {
  type: "text_delta" | "tool_call_start" | "tool_call_delta" | "tool_call_end" | "finish";
  text?: string;
  toolCall?: Partial<ToolCall>;
  usage?: TokenUsage;
  finishReason?: FinishReason;
}

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
  /** @deprecated Use inputSchema instead. */
  parameters?: Record<string, unknown>;
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
  usageSource?: "ledger" | "local_scanner" | "legacy_turns";
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
