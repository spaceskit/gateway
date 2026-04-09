import type { EventBus } from "../events/event-bus.js";
import type {
  AgentRuntime,
  AgentState,
  TurnContext,
  TurnEvent,
  TurnResult,
  TurnResultMetadata,
} from "./agent-runtime.js";
import type { CliLaunchSnapshot } from "./cli-launch-snapshot.js";
import type { FinishReason, ModelMessage, ToolCall, ToolResult, TokenUsage, TokenUsageDetails } from "./model-provider.js";

export interface ExternalMcpAgentRuntimeOptions {
  agentId: string;
  remoteAgentId: string;
  executeRemoteTurn: (input: {
    spaceId: string;
    agentId: string;
    remoteAgentId: string;
    turnId: string;
    messages: ModelMessage[];
    lineageId: string;
    hopCount: number;
    maxHops: number;
    principalId?: string;
    deviceId?: string;
  }) => Promise<unknown>;
  eventBus?: EventBus;
}

export class ExternalMcpAgentRuntime implements AgentRuntime {
  readonly agentId: string;
  private readonly remoteAgentId: string;
  private readonly executeRemoteTurnFn: ExternalMcpAgentRuntimeOptions["executeRemoteTurn"];
  private readonly eventBus?: EventBus;
  private _state: AgentState = "idle";
  private activeTurnId: string | null = null;
  private cancelled = false;

  constructor(options: ExternalMcpAgentRuntimeOptions) {
    this.agentId = options.agentId;
    this.remoteAgentId = options.remoteAgentId;
    this.executeRemoteTurnFn = options.executeRemoteTurn;
    this.eventBus = options.eventBus;
  }

  get state(): AgentState {
    return this._state;
  }

  async getLaunchSnapshot(_context: TurnContext): Promise<CliLaunchSnapshot | undefined> {
    return undefined;
  }

  async *executeTurn(context: TurnContext): AsyncIterable<TurnEvent> {
    if (this.activeTurnId) {
      yield {
        type: "error",
        error: new Error(`Agent ${this.agentId} is already executing a turn.`),
      };
      return;
    }

    this.activeTurnId = context.turnId;
    this.cancelled = false;
    const startedAt = new Date();

    try {
      this.setState("thinking");
      yield { type: "state_changed", state: "thinking" };

      const remoteResult = await this.executeRemoteTurnFn({
        spaceId: context.spaceId,
        agentId: this.agentId,
        remoteAgentId: this.remoteAgentId,
        turnId: context.turnId,
        messages: context.messages,
        lineageId: context.lineageId,
        hopCount: context.hopCount,
        maxHops: context.maxHops,
        principalId: context.principalId,
        deviceId: context.deviceId,
      });

      if (this.cancelled) {
        this.setState("idle");
        yield { type: "state_changed", state: "idle" };
        return;
      }

      const normalized = normalizeRemoteTurn(remoteResult, context.messages);
      const completedAt = new Date();
      const metadata = buildMetadataFromRemoteResult(
        normalized.metadata,
        normalized.usage,
        startedAt,
        completedAt,
      );
      this.setState("idle");
      yield { type: "state_changed", state: "idle" };

      if (normalized.finalMessage.content.trim().length > 0) {
        yield { type: "text_delta", text: normalized.finalMessage.content };
      }

      const turnResult: TurnResult = {
        agentId: this.agentId,
        turnId: context.turnId,
        messages: normalized.messages,
        toolCalls: normalized.toolCalls,
        toolResults: normalized.toolResults,
        finalMessage: normalized.finalMessage,
        usage: normalized.usage,
        metadata,
        state: "idle",
      };
      yield { type: "turn_completed", result: turnResult };
    } catch (err) {
      this.setState("errored");
      yield { type: "state_changed", state: "errored" };
      yield {
        type: "error",
        error: err instanceof Error ? err : new Error(String(err)),
      };
    } finally {
      this.activeTurnId = null;
      if (this._state !== "errored") {
        this.setState("idle");
      }
    }
  }

  async *resumeWithFeedback(): AsyncIterable<TurnEvent> {
    yield { type: "state_changed", state: this._state };
  }

  async cancel(): Promise<void> {
    this.cancelled = true;
    this.activeTurnId = null;
    this.setState("idle");
  }

  private setState(state: AgentState): void {
    this._state = state;
    this.eventBus?.emit({
      type: "agent.state_changed",
      agentId: this.agentId,
      state,
      timestamp: new Date(),
    });
  }
}

function normalizeRemoteTurn(
  raw: unknown,
  inputMessages: ModelMessage[],
): {
  messages: ModelMessage[];
  finalMessage: ModelMessage;
  toolCalls: ToolCall[];
  toolResults: ToolResult[];
  usage: TokenUsage;
  metadata?: TurnResultMetadata;
} {
  if (typeof raw === "string") {
    const finalMessage: ModelMessage = { role: "assistant", content: raw };
    return {
      messages: [...inputMessages, finalMessage],
      finalMessage,
      toolCalls: [],
      toolResults: [],
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    };
  }

  const record = isRecord(raw) ? raw : {};
  const output = stringFromUnknown(record.outputText)
    ?? stringFromUnknown(record.output)
    ?? stringFromUnknown(record.text)
    ?? "";
  const finalMessageRaw = isRecord(record.finalMessage) ? record.finalMessage : {};
  const finalContent = stringFromUnknown(finalMessageRaw.content) ?? output;
  const finalMessage: ModelMessage = {
    role: "assistant",
    content: finalContent,
  };

  const usageRaw = isRecord(record.usage) ? record.usage : {};
  const usageDetailsRaw = isRecord(usageRaw.usageDetails) ? usageRaw.usageDetails : {};
  const promptTokens = toNonNegativeInt(usageRaw.promptTokens);
  const completionTokens = toNonNegativeInt(usageRaw.completionTokens);
  const totalTokens = Math.max(
    toNonNegativeInt(usageRaw.totalTokens),
    promptTokens + completionTokens,
  );
  const usageDetails = parseUsageDetails(usageDetailsRaw, usageRaw.raw);
  const usage = {
    promptTokens,
    completionTokens,
    totalTokens,
    ...(usageDetails ? { usageDetails } : {}),
  };

  const metadataRaw = isRecord(record.metadata) ? record.metadata : {};
  const finishReason = normalizeFinishReason(metadataRaw.finishReason ?? record.finishReason);
  const metadata: TurnResultMetadata = {
    ...(finishReason ? { finishReason } : {}),
    ...(toIsoDateString(metadataRaw.startedAt ?? record.startedAt)
      ? { startedAt: toIsoDateString(metadataRaw.startedAt ?? record.startedAt) as string }
      : {}),
    ...(toIsoDateString(metadataRaw.completedAt ?? record.completedAt)
      ? { completedAt: toIsoDateString(metadataRaw.completedAt ?? record.completedAt) as string }
      : {}),
    ...(toNonNegativeIntOrUndefined(metadataRaw.durationMs ?? record.durationMs) !== undefined
      ? { durationMs: toNonNegativeIntOrUndefined(metadataRaw.durationMs ?? record.durationMs) }
      : {}),
    usage,
  };

  const providedMessages = Array.isArray(record.messages)
    ? record.messages
      .filter((entry): entry is Record<string, unknown> => isRecord(entry))
      .map((entry) => ({
        role: normalizeRole(stringFromUnknown(entry.role)),
        content: stringFromUnknown(entry.content) ?? "",
      } satisfies ModelMessage))
    : [];

  const toolCalls = Array.isArray(record.toolCalls)
    ? (record.toolCalls.filter((entry): entry is ToolCall => isToolCall(entry)))
    : [];
  const toolResults = Array.isArray(record.toolResults)
    ? (record.toolResults.filter((entry): entry is ToolResult => isToolResult(entry)))
    : [];

  const messages = providedMessages.length > 0
    ? providedMessages
    : [...inputMessages, finalMessage];

  return {
    messages,
    finalMessage,
    toolCalls,
    toolResults,
    usage,
    metadata,
  };
}

function buildMetadataFromRemoteResult(
  remoteMetadata: TurnResultMetadata | undefined,
  usage: TokenUsage,
  startedAt: Date,
  completedAt: Date,
): TurnResultMetadata {
  const startedAtIso = remoteMetadata?.startedAt ?? startedAt.toISOString();
  const completedAtIso = remoteMetadata?.completedAt ?? completedAt.toISOString();
  const parsedStarted = Date.parse(startedAtIso);
  const parsedCompleted = Date.parse(completedAtIso);
  const fallbackDuration = Number.isFinite(parsedStarted) && Number.isFinite(parsedCompleted)
    ? Math.max(0, parsedCompleted - parsedStarted)
    : Math.max(0, completedAt.getTime() - startedAt.getTime());

  return {
    ...remoteMetadata,
    startedAt: startedAtIso,
    completedAt: completedAtIso,
    durationMs: remoteMetadata?.durationMs ?? fallbackDuration,
    usage: remoteMetadata?.usage ?? usage,
  };
}

function parseUsageDetails(
  usageDetailsRaw: Record<string, unknown>,
  rawUsageFromRecord: unknown,
): TokenUsageDetails | undefined {
  const details: TokenUsageDetails = {};
  const noCache = toNonNegativeIntOrUndefined(usageDetailsRaw.inputNoCacheTokens);
  const cacheRead = toNonNegativeIntOrUndefined(usageDetailsRaw.inputCacheReadTokens);
  const cacheWrite = toNonNegativeIntOrUndefined(usageDetailsRaw.inputCacheWriteTokens);
  const textTokens = toNonNegativeIntOrUndefined(usageDetailsRaw.outputTextTokens);
  const reasoningTokens = toNonNegativeIntOrUndefined(usageDetailsRaw.outputReasoningTokens);
  if (noCache !== undefined) details.inputNoCacheTokens = noCache;
  if (cacheRead !== undefined) details.inputCacheReadTokens = cacheRead;
  if (cacheWrite !== undefined) details.inputCacheWriteTokens = cacheWrite;
  if (textTokens !== undefined) details.outputTextTokens = textTokens;
  if (reasoningTokens !== undefined) details.outputReasoningTokens = reasoningTokens;
  if (isRecord(rawUsageFromRecord)) {
    details.raw = rawUsageFromRecord as Record<string, unknown>;
  } else if (isRecord(usageDetailsRaw.raw)) {
    details.raw = usageDetailsRaw.raw as Record<string, unknown>;
  }
  return Object.keys(details).length > 0 ? details : undefined;
}

function normalizeFinishReason(value: unknown): FinishReason | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  switch (normalized) {
    case "stop":
      return "stop";
    case "length":
      return "length";
    case "error":
      return "error";
    case "tool_calls":
    case "tool-calls":
      return "tool_calls";
    case "content_filter":
    case "content-filter":
      return "content_filter";
    case "other":
      return "other";
    default:
      return "other";
  }
}

function toIsoDateString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return Number.isNaN(Date.parse(trimmed)) ? undefined : trimmed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringFromUnknown(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return value;
}

function toNonNegativeInt(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.trunc(value));
  }
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) {
      return Math.max(0, parsed);
    }
  }
  return 0;
}

function toNonNegativeIntOrUndefined(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.trunc(value));
  }
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) {
      return Math.max(0, parsed);
    }
  }
  return undefined;
}

function normalizeRole(value?: string): ModelMessage["role"] {
  if (value === "system" || value === "user" || value === "assistant" || value === "tool") {
    return value;
  }
  return "assistant";
}

function isToolCall(value: unknown): value is ToolCall {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string"
    && typeof value.name === "string"
    && isRecord(value.arguments)
  );
}

function isToolResult(value: unknown): value is ToolResult {
  if (!isRecord(value)) return false;
  return (
    typeof value.toolCallId === "string"
    && typeof value.isError === "boolean"
    && "result" in value
  );
}
