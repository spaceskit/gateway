import type {
  AccountInfo as ClaudeAgentSdkAccountInfo,
  ModelInfo as ClaudeAgentSdkNativeModelInfo,
  Options as ClaudeAgentSdkOptions,
  SDKAssistantMessage,
  SDKRateLimitEvent,
  SDKResultMessage,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type {
  GenerateResult,
  GenerateOptions,
  ModelMessage,
  StreamChunk,
  TokenUsage,
  ToolCall,
} from "@spaceskit/core";
import type {
  ClaudeAgentSdkAuthAccount,
  ClaudeAgentSdkAuthMode,
  ClaudeAgentSdkAuthStatus,
  ClaudeAgentSdkDiscoveredModel,
} from "./claude-agent-sdk-provider.js";

const MCP_BRIDGE_SERVER_NAME = "spaceskit-gateway";

export function renderPrompt(messages: ModelMessage[]): string {
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

export function buildMcpServers(
  bridgeConfig?: GenerateOptions["gatewayToolBridgeConfig"],
): ClaudeAgentSdkOptions["mcpServers"] | undefined {
  if (!bridgeConfig) {
    return undefined;
  }
  return {
    [MCP_BRIDGE_SERVER_NAME]: {
      command: "bun",
      args: ["run", bridgeConfig.bridgeScriptPath],
      env: {
        GATEWAY_TOOLS_JSON: bridgeConfig.toolDefsJson,
        GATEWAY_SOCKET_PATH: bridgeConfig.socketPath,
      },
    },
  };
}

export function mapThinkingConfig(
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

export function extractToolCall(contentBlock: unknown): Partial<ToolCall> | null {
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

export function extractAssistantText(message: SDKAssistantMessage): string {
  return message.message.content
    .flatMap((block) =>
      block.type === "text"
        ? [block.text]
        : [],
    )
    .join("");
}

export function extractToolResult(message: SDKUserMessage) {
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

export function extractResultText(result: SDKResultMessage | null): string {
  if (!result || result.type !== "result" || result.is_error) {
    return "";
  }
  const successResult = result as SDKResultMessage & { result?: string };
  return typeof successResult.result === "string" ? successResult.result : "";
}

export function extractResultError(result: SDKResultMessage): string {
  if (!result.is_error) {
    return "Claude Agent SDK execution failed";
  }
  const errorResult = result as SDKResultMessage & { errors?: string[]; subtype?: string };
  return errorResult.errors?.join("; ") || errorResult.subtype || "Claude Agent SDK execution failed";
}

export function mapRateLimitEvent(message: SDKRateLimitEvent): StreamChunk | null {
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

export function tryParseJsonObject(value: string): Record<string, unknown> | null {
  try {
    return asRecord(JSON.parse(value));
  } catch {
    return null;
  }
}

export function cloneToolCall(toolCall: Partial<ToolCall>): Partial<ToolCall> {
  return {
    ...toolCall,
    arguments: asRecord(toolCall.arguments) ?? {},
  };
}

export function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : 0;
}

export function parseClaudeAgentSdkUsage(usage: Record<string, unknown>): TokenUsage {
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

export function mapClaudeAgentStopReason(reason: string | null): GenerateResult["finishReason"] {
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

export function normalizeAccountInfo(
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

export function normalizeDiscoveredModels(
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

export function inferProbeAuthStatus(
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

export function inferProbeErrorStatus(
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

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
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
