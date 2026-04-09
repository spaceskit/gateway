import {
  type AccountInfo as ClaudeAgentSdkAccountInfo,
  type ModelInfo as ClaudeAgentSdkNativeModelInfo,
  query as claudeAgentSdkQuery,
  type Options as ClaudeAgentSdkOptions,
  type SDKControlInitializeResponse,
  type SDKAssistantMessage,
  type SDKMessage,
  type SDKPartialAssistantMessage,
  type SDKRateLimitEvent,
  type SDKResultMessage,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type {
  GenerateOptions,
  GenerateResult,
  ModelInfo,
  ModelMessage,
  ModelProvider,
  StreamChunk,
  TokenUsage,
  ToolCall,
} from "@spaceskit/core";

const DEFAULT_READ_ONLY_TOOLS = ["Read", "Glob", "Grep", "WebSearch", "WebFetch"] as const;
const MCP_BRIDGE_SERVER_NAME = "spaceskit-gateway";

export type ClaudeAgentSdkAuthMode = "api_key" | "host_login";
export type ClaudeAgentSdkAuthStatus = "authenticated" | "needs_key" | "needs_auth" | "error" | "unsupported";

export interface ClaudeAgentSdkAuthAccount {
  email?: string;
  organization?: string;
  subscriptionType?: string;
  apiProvider?: string;
  tokenSource?: string;
}

export interface ClaudeAgentSdkDiscoveredModel {
  id: string;
  displayName: string;
  contextWindow?: number;
}

export interface ClaudeAgentSdkProbeResult {
  authMode: ClaudeAgentSdkAuthMode;
  authStatus: ClaudeAgentSdkAuthStatus;
  authAccount?: ClaudeAgentSdkAuthAccount;
  models: ClaudeAgentSdkDiscoveredModel[];
  detectionError?: string;
}

type ClaudeAgentSdkQueryHandle = ReturnType<typeof claudeAgentSdkQuery>;
type ClaudeAgentSdkQuery = typeof claudeAgentSdkQuery;

interface StreamState {
  readonly partialToolCalls: Map<number, Partial<ToolCall>>;
  readonly partialToolArguments: Map<number, string>;
  sawPartialText: boolean;
}

export interface ClaudeAgentSdkProviderConfig {
  id: string;
  name: string;
  model: string;
  apiKey?: string;
  authMode?: ClaudeAgentSdkAuthMode;
  isLocal?: boolean;
  env?: Record<string, string | undefined>;
  queryImpl?: ClaudeAgentSdkQuery;
}

export class ClaudeAgentSdkModelProvider implements ModelProvider {
  readonly id: string;
  readonly name: string;
  readonly isLocal: boolean;

  private readonly config: ClaudeAgentSdkProviderConfig;
  private readonly queryImpl: ClaudeAgentSdkQuery;

  constructor(config: ClaudeAgentSdkProviderConfig) {
    this.id = config.id;
    this.name = config.name;
    this.isLocal = config.isLocal ?? false;
    this.config = config;
    this.queryImpl = config.queryImpl ?? claudeAgentSdkQuery;
  }

  async checkHealth(): Promise<{ available: boolean; latencyMs?: number }> {
    const startedAt = Date.now();
    const metadata = await this.probeMetadata();
    return {
      available: metadata.authStatus === "authenticated",
      latencyMs: Date.now() - startedAt,
    };
  }

  async listModels(): Promise<ModelInfo[]> {
    const metadata = await this.probeMetadata();
    if (metadata.models.length > 0) {
      return metadata.models.map((model) => ({
        id: model.id,
        name: model.displayName,
        provider: this.id,
        contextWindow: model.contextWindow,
        supportsTools: true,
        isLocal: false,
      }));
    }

    const modelId = this.resolveModelId(this.config.model);
    return [{
      id: `${this.id}/${modelId}`,
      name: modelId,
      provider: this.id,
      supportsTools: true,
      isLocal: false,
    }];
  }

  async probeMetadata(): Promise<ClaudeAgentSdkProbeResult> {
    const authMode = this.resolveAuthMode();
    if (authMode === "api_key" && !this.resolveApiKey()) {
      return {
        authMode,
        authStatus: "needs_key",
        models: [],
      };
    }

    let query: ClaudeAgentSdkQueryHandle | null = null;
    try {
      query = this.queryImpl({
        prompt: "Initialize the session and report the available models.",
        options: this.buildSdkOptions(this.config.model, {
          messages: [],
          accessMode: "default",
        }),
      });

      const initialization = typeof query.initializationResult === "function"
        ? await query.initializationResult()
        : undefined;
      const sdkModels = initialization?.models
        ?? (typeof query.supportedModels === "function" ? await query.supportedModels() : []);
      const account = initialization?.account
        ?? (typeof query.accountInfo === "function" ? await query.accountInfo() : undefined);

      return {
        authMode,
        authStatus: inferProbeAuthStatus(authMode, Boolean(this.resolveApiKey()), account),
        authAccount: normalizeAccountInfo(account),
        models: normalizeDiscoveredModels(this.id, sdkModels),
      };
    } catch (error) {
      const detectionError = error instanceof Error ? error.message : String(error);
      return {
        authMode,
        authStatus: inferProbeErrorStatus(authMode, detectionError),
        models: [],
        ...(detectionError ? { detectionError } : {}),
      };
    } finally {
      query?.close?.();
    }
  }

  async generate(model: string, options: GenerateOptions): Promise<GenerateResult> {
    const resolvedModel = this.resolveModelId(model || this.config.model);
    const { finalResult, lastAssistantText, streamedText } = await this.collectQueryResult(
      renderPrompt(options.messages),
      this.buildSdkOptions(resolvedModel, options),
    );

    const content = streamedText || lastAssistantText || extractResultText(finalResult) || "";
    return {
      message: {
        role: "assistant",
        content,
      },
      ...(finalResult?.usage ? { usage: this.parseUsage(finalResult.usage) } : {}),
      finishReason: this.mapStopReason(finalResult?.stop_reason ?? null),
    };
  }

  async *stream(model: string, options: GenerateOptions): AsyncIterable<StreamChunk> {
    const resolvedModel = this.resolveModelId(model || this.config.model);
    const prompt = renderPrompt(options.messages);
    const query = this.queryImpl({
      prompt,
      options: this.buildSdkOptions(resolvedModel, options),
    });
    const state: StreamState = {
      partialToolCalls: new Map(),
      partialToolArguments: new Map(),
      sawPartialText: false,
    };

    for await (const message of query) {
      if (message.type === "stream_event") {
        yield* this.mapPartialAssistantMessage(message, state);
        continue;
      }

      if (message.type === "assistant") {
        if (!state.sawPartialText) {
          const text = extractAssistantText(message);
          if (text) {
            yield { type: "text_delta", text };
          }
        }
        continue;
      }

      if (message.type === "user") {
        const toolResult = extractToolResult(message);
        if (toolResult) {
          yield { type: "tool_result", toolResult };
        }
        continue;
      }

      if (message.type === "rate_limit_event") {
        const rateLimited = mapRateLimitEvent(message);
        if (rateLimited) {
          yield rateLimited;
        }
        continue;
      }

      if (message.type === "result") {
        if (message.is_error) {
          throw new Error(extractResultError(message));
        }
        yield {
          type: "finish",
          ...(message.usage ? { usage: this.parseUsage(message.usage) } : {}),
          finishReason: this.mapStopReason(message.stop_reason),
        };
      }
    }
  }

  private async collectQueryResult(
    prompt: string,
    sdkOptions: ClaudeAgentSdkOptions,
  ): Promise<{
    finalResult: SDKResultMessage | null;
    lastAssistantText: string;
    streamedText: string;
  }> {
    const query = this.queryImpl({
      prompt,
      options: sdkOptions,
    });

    let finalResult: SDKResultMessage | null = null;
    let lastAssistantText = "";
    const streamedTextParts: string[] = [];

    for await (const message of query) {
      if (message.type === "stream_event") {
        if (message.event.type === "content_block_delta" && message.event.delta.type === "text_delta") {
          streamedTextParts.push(message.event.delta.text);
        }
        continue;
      }

      if (message.type === "assistant") {
        const text = extractAssistantText(message);
        if (text) {
          lastAssistantText = text;
        }
        continue;
      }

      if (message.type === "result") {
        finalResult = message;
      }
    }

    if (!finalResult) {
      throw new Error("Claude Agent SDK query completed without a result message");
    }
    if (finalResult.is_error) {
      throw new Error(extractResultError(finalResult));
    }

    return {
      finalResult,
      lastAssistantText,
      streamedText: streamedTextParts.join(""),
    };
  }

  private *mapPartialAssistantMessage(
    message: SDKPartialAssistantMessage,
    state: StreamState,
  ): Iterable<StreamChunk> {
    const event = message.event;
    if (event.type === "content_block_start") {
      const toolCall = extractToolCall(event.content_block);
      if (toolCall) {
        state.partialToolCalls.set(event.index, toolCall);
        yield {
          type: "tool_call_start",
          toolCall: cloneToolCall(toolCall),
        };
      }
      return;
    }

    if (event.type === "content_block_delta") {
      if (event.delta.type === "text_delta") {
        state.sawPartialText = true;
        yield {
          type: "text_delta",
          text: event.delta.text,
        };
        return;
      }

      if (event.delta.type === "thinking_delta") {
        yield {
          type: "reasoning_delta",
          text: event.delta.thinking,
        };
        return;
      }

      if (event.delta.type === "input_json_delta") {
        const toolCall = state.partialToolCalls.get(event.index);
        if (!toolCall) {
          return;
        }
        const current = state.partialToolArguments.get(event.index) ?? "";
        state.partialToolArguments.set(event.index, current + event.delta.partial_json);
        yield {
          type: "tool_call_delta",
          toolCall: cloneToolCall(toolCall),
          text: event.delta.partial_json,
        };
      }
      return;
    }

    if (event.type === "content_block_stop") {
      const toolCall = state.partialToolCalls.get(event.index);
      if (!toolCall) {
        return;
      }

      const partialArguments = state.partialToolArguments.get(event.index);
      if (partialArguments) {
        const parsedArguments = tryParseJsonObject(partialArguments);
        if (parsedArguments) {
          toolCall.arguments = parsedArguments;
        }
      }

      state.partialToolCalls.delete(event.index);
      state.partialToolArguments.delete(event.index);
      yield {
        type: "tool_call_end",
        toolCall: cloneToolCall(toolCall),
      };
    }
  }

  private buildSdkOptions(model: string, options: GenerateOptions): ClaudeAgentSdkOptions {
    const accessMode = options.accessMode ?? "default";
    const permissionMode = accessMode === "full_access"
      ? (options.approvalBypassEnabled ? "bypassPermissions" : "acceptEdits")
      : "default";
    const mcpServers = buildMcpServers(options.mcpBridgeConfig);
    const thinking = mapThinkingConfig(options.thinkingConfig);
    const settings = this.buildSessionSettings();
    const settingSources = this.buildSettingSources();

    return {
      model: this.resolveModelId(model),
      ...(options.workingDirectory ? { cwd: options.workingDirectory } : {}),
      env: this.buildEnv(),
      includePartialMessages: true,
      persistSession: false,
      permissionMode,
      ...(accessMode === "full_access"
        ? {
          tools: {
            type: "preset" as const,
            preset: "claude_code" as const,
          },
        }
        : { tools: [...DEFAULT_READ_ONLY_TOOLS] }),
      ...(options.approvalBypassEnabled && accessMode === "full_access"
        ? { allowDangerouslySkipPermissions: true }
        : {}),
      ...(options.effort ? { effort: options.effort } : {}),
      ...(thinking ? { thinking } : {}),
      ...(settings ? { settings } : {}),
      ...(settingSources ? { settingSources } : {}),
      ...(mcpServers ? { mcpServers } : {}),
    };
  }

  private buildEnv(): Record<string, string | undefined> {
    const env = {
      ...process.env,
      ...(this.config.env ?? {}),
    };
    if (this.resolveAuthMode() === "api_key") {
      const apiKey = this.resolveApiKey();
      if (apiKey) {
        env.ANTHROPIC_API_KEY = apiKey;
      } else {
        delete env.ANTHROPIC_API_KEY;
      }
    } else {
      delete env.ANTHROPIC_API_KEY;
    }
    return env;
  }

  private buildSessionSettings(): ClaudeAgentSdkOptions["settings"] | undefined {
    if (this.resolveAuthMode() !== "host_login") {
      return undefined;
    }
    return {
      forceLoginMethod: "claudeai",
    };
  }

  private buildSettingSources(): ClaudeAgentSdkOptions["settingSources"] | undefined {
    if (this.resolveAuthMode() !== "host_login") {
      return undefined;
    }
    return ["user", "project", "local"];
  }

  private resolveAuthMode(): ClaudeAgentSdkAuthMode {
    return this.config.authMode ?? "api_key";
  }

  private resolveApiKey(): string | undefined {
    const configured = this.config.apiKey?.trim();
    if (configured) {
      return configured;
    }
    return process.env.ANTHROPIC_API_KEY?.trim() || undefined;
  }

  private resolveModelId(modelIdRaw: string): string {
    const modelId = modelIdRaw.trim();
    const providerPrefix = `${this.id}/`;
    if (modelId.toLowerCase().startsWith(providerPrefix)) {
      return modelId.slice(providerPrefix.length);
    }
    return modelId;
  }

  private parseUsage(usage: Record<string, unknown>): TokenUsage {
    const promptTokens = asNumber(usage.input_tokens);
    const completionTokens = asNumber(usage.output_tokens);
    const cacheReadInputTokens = asNumber(usage.cache_read_input_tokens);
    const cacheCreationInputTokens = asNumber(usage.cache_creation_input_tokens);

    return {
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
      tokenAccuracy: "reported",
      usageSource: "ledger",
      usageDetails: {
        inputNoCacheTokens: promptTokens - cacheReadInputTokens - cacheCreationInputTokens,
        inputCacheReadTokens: cacheReadInputTokens,
        inputCacheWriteTokens: cacheCreationInputTokens,
        outputTextTokens: completionTokens,
      },
    };
  }

  private mapStopReason(reason: string | null): GenerateResult["finishReason"] {
    switch (reason) {
      case null:
      case "end_turn":
      case "stop_sequence":
        return "stop";
      case "max_tokens":
        return "length";
      case "tool_use":
      case "mcp_tool_use":
        return "tool_calls";
      default:
        return "other";
    }
  }
}

function renderPrompt(messages: ModelMessage[]): string {
  return messages
    .map((message) => {
      const role = message.role.toUpperCase();
      const suffix = message.role === "tool" && message.toolName
        ? ` (${message.toolName})`
        : "";
      return `${role}${suffix}:\n${message.content}`.trim();
    })
    .join("\n\n");
}

function buildMcpServers(
  mcpBridgeConfig?: GenerateOptions["mcpBridgeConfig"],
): ClaudeAgentSdkOptions["mcpServers"] | undefined {
  if (!mcpBridgeConfig) {
    return undefined;
  }
  return {
    [MCP_BRIDGE_SERVER_NAME]: {
      command: "bun",
      args: ["run", mcpBridgeConfig.bridgeScriptPath],
      env: {
        GATEWAY_TOOLS_JSON: mcpBridgeConfig.toolDefsJson,
        GATEWAY_SOCKET_PATH: mcpBridgeConfig.socketPath,
      },
    },
  };
}

function mapThinkingConfig(
  thinkingConfig: GenerateOptions["thinkingConfig"],
): ClaudeAgentSdkOptions["thinking"] | undefined {
  if (!thinkingConfig) {
    return undefined;
  }

  if (thinkingConfig.enabled === false) {
    return { type: "disabled" };
  }

  if (thinkingConfig.enabled === "adaptive") {
    return {
      type: "adaptive",
      ...(thinkingConfig.display ? { display: thinkingConfig.display } : {}),
    };
  }

  if (thinkingConfig.budgetTokens !== undefined) {
    return {
      type: "enabled",
      budgetTokens: thinkingConfig.budgetTokens,
      ...(thinkingConfig.display ? { display: thinkingConfig.display } : {}),
    };
  }

  return {
    type: "adaptive",
    ...(thinkingConfig.display ? { display: thinkingConfig.display } : {}),
  };
}

function extractToolCall(contentBlock: unknown): Partial<ToolCall> | null {
  const block = asRecord(contentBlock);
  if (!block) {
    return null;
  }
  const type = asString(block.type);
  if (type !== "tool_use" && type !== "mcp_tool_use") {
    return null;
  }

  const id = asString(block.id);
  const name = asString(block.name);
  if (!id || !name) {
    return null;
  }

  return {
    id,
    name,
    arguments: asRecord(block.input) ?? {},
  };
}

function extractAssistantText(message: SDKAssistantMessage): string {
  return message.message.content
    .flatMap((block) =>
      block.type === "text"
        ? [block.text]
        : [],
    )
    .join("");
}

function extractToolResult(message: SDKUserMessage) {
  const toolCallId = message.parent_tool_use_id?.trim();
  if (!toolCallId || message.tool_use_result === undefined) {
    return null;
  }
  const resultRecord = asRecord(message.tool_use_result);
  const isError = resultRecord && typeof resultRecord.is_error === "boolean"
    ? resultRecord.is_error
    : resultRecord && typeof resultRecord.isError === "boolean"
      ? resultRecord.isError
      : undefined;
  return {
    toolCallId,
    result: message.tool_use_result,
    ...(typeof isError === "boolean" ? { isError } : {}),
  };
}

function extractResultText(result: SDKResultMessage | null): string {
  if (!result || result.type !== "result" || result.is_error) {
    return "";
  }
  const successResult = result as SDKResultMessage & { result?: string };
  return typeof successResult.result === "string" ? successResult.result : "";
}

function extractResultError(result: SDKResultMessage): string {
  if (!result.is_error) {
    return "Claude Agent SDK execution failed";
  }
  const errorResult = result as SDKResultMessage & { errors?: string[]; subtype?: string };
  return errorResult.errors?.join("; ") || errorResult.subtype || "Claude Agent SDK execution failed";
}

function mapRateLimitEvent(message: SDKRateLimitEvent): StreamChunk | null {
  const resetsAt = message.rate_limit_info.resetsAt;
  if (!resetsAt || !Number.isFinite(resetsAt)) {
    return null;
  }

  const retryAfterMs = Math.max(1, Math.trunc(resetsAt - Date.now()));
  return {
    type: "rate_limited",
    retryAfterMs,
    retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1_000)),
    providerId: "claude-agent-sdk",
    retryAt: new Date(resetsAt).toISOString(),
  };
}

function tryParseJsonObject(value: string): Record<string, unknown> | null {
  try {
    return asRecord(JSON.parse(value));
  } catch {
    return null;
  }
}

function cloneToolCall(toolCall: Partial<ToolCall>): Partial<ToolCall> {
  return {
    ...toolCall,
    arguments: asRecord(toolCall.arguments) ?? {},
  };
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : undefined;
}

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : 0;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function normalizeAccountInfo(
  account?: ClaudeAgentSdkAccountInfo,
): ClaudeAgentSdkAuthAccount | undefined {
  if (!account) {
    return undefined;
  }
  const normalized: ClaudeAgentSdkAuthAccount = {
    email: account.email?.trim() || undefined,
    organization: account.organization?.trim() || undefined,
    subscriptionType: account.subscriptionType?.trim() || undefined,
    apiProvider: account.apiProvider?.trim() || undefined,
    tokenSource: account.tokenSource?.trim() || undefined,
  };
  return Object.values(normalized).some(Boolean) ? normalized : undefined;
}

function normalizeDiscoveredModels(
  providerId: string,
  models: ClaudeAgentSdkNativeModelInfo[] = [],
): ClaudeAgentSdkDiscoveredModel[] {
  const seen = new Set<string>();
  const normalized: ClaudeAgentSdkDiscoveredModel[] = [];

  for (const model of models) {
    const rawId = model.value?.trim();
    if (!rawId) {
      continue;
    }
    const id = rawId.toLowerCase().startsWith(`${providerId}/`)
      ? rawId
      : `${providerId}/${rawId}`;
    const key = id.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    normalized.push({
      id,
      displayName: model.displayName?.trim() || rawId,
    });
  }

  return normalized;
}

function inferProbeAuthStatus(
  authMode: ClaudeAgentSdkAuthMode,
  hasApiKey: boolean,
  account?: ClaudeAgentSdkAccountInfo,
): ClaudeAgentSdkAuthStatus {
  if (authMode === "api_key") {
    return hasApiKey ? "authenticated" : "needs_key";
  }
  if (!account) {
    return "needs_auth";
  }
  return hasAuthenticatedAccount(account) ? "authenticated" : "needs_auth";
}

function inferProbeErrorStatus(
  authMode: ClaudeAgentSdkAuthMode,
  detectionError: string,
): ClaudeAgentSdkAuthStatus {
  if (authMode === "api_key") {
    return "error";
  }
  const normalized = detectionError.trim().toLowerCase();
  if (
    normalized.includes("sign in")
    || normalized.includes("login")
    || normalized.includes("oauth")
    || normalized.includes("authenticate")
    || normalized.includes("authentication")
  ) {
    return "needs_auth";
  }
  return "error";
}

function hasAuthenticatedAccount(account: ClaudeAgentSdkAccountInfo): boolean {
  return Boolean(
    account.email?.trim()
      || account.organization?.trim()
      || account.subscriptionType?.trim()
      || account.tokenSource?.trim()
      || account.apiProvider?.trim(),
  );
}
