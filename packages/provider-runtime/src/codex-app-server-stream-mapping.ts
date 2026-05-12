import type { StreamChunk, TokenUsage } from "@spaceskit/core";

type JsonRpcId = number | string;
type JsonRecord = Record<string, unknown>;

export type AppServerInboundMessage =
  | { kind: "request"; id: JsonRpcId; method: string; params: unknown }
  | { kind: "notification"; method: string; params: unknown };

export class CodexTurnStreamContext {
  private readonly queue: AppServerInboundMessage[] = [];
  private readonly waiters: Array<(value: AppServerInboundMessage | undefined) => void> = [];
  private readonly itemIdsWithDeltas = new Set<string>();
  private closed = false;
  latestCompletedAgentMessage?: string;
  sawVisibleAssistantOutput = false;

  push(message: AppServerInboundMessage): void {
    if (this.closed) {
      return;
    }
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter(message);
      return;
    }
    this.queue.push(message);
  }

  async next(): Promise<AppServerInboundMessage | undefined> {
    if (this.queue.length > 0) {
      return this.queue.shift();
    }
    if (this.closed) {
      return undefined;
    }
    return await new Promise<AppServerInboundMessage | undefined>((resolve) => {
      this.waiters.push(resolve);
    });
  }

  noteDelta(itemId: string): void {
    this.itemIdsWithDeltas.add(itemId);
  }

  sawDelta(itemId?: string): boolean {
    return Boolean(itemId && this.itemIdsWithDeltas.has(itemId));
  }

  noteCompletedAgentMessage(text: string): void {
    const normalized = text.trim();
    if (normalized) {
      this.latestCompletedAgentMessage = normalized;
    }
  }

  noteVisibleAssistantOutput(): void {
    this.sawVisibleAssistantOutput = true;
  }

  close(): void {
    this.closed = true;
    while (this.waiters.length > 0) {
      const waiter = this.waiters.shift();
      waiter?.(undefined);
    }
  }
}

export function* mapCompletedItemToChunks(
  params: unknown,
  streamContext: CodexTurnStreamContext,
): Iterable<StreamChunk> {
  const record = asRecord(params);
  const item = asRecord(record?.item);
  const itemId = asString(item?.id);
  const itemType = asString(item?.type);
  if (!itemType) {
    return;
  }

  if (itemType === "agentMessage") {
    const text = asString(item?.text);
    if (text) {
      streamContext.noteCompletedAgentMessage(text);
    }
    return;
  }

  if (itemId && streamContext.sawDelta(itemId)) {
    return;
  }

  if (itemType === "reasoning") {
    for (const entry of asArray(item?.summary)) {
      const text = asString(entry);
      if (text) {
        yield { type: "reasoning_delta", text };
      }
    }
    for (const entry of asArray(item?.content)) {
      const text = asString(entry);
      if (text) {
        yield { type: "reasoning_delta", text };
      }
    }
    return;
  }

  if (itemType === "commandExecution") {
    const aggregatedOutput = asString(item?.aggregatedOutput);
    if (aggregatedOutput) {
      yield { type: "reasoning_delta", text: aggregatedOutput };
    }
  }
}

export function normalizeTokenUsage(value: unknown): TokenUsage | undefined {
  const record = asRecord(value);
  const last = asRecord(record?.last);
  if (!last) {
    return undefined;
  }
  const promptTokens = asNumber(last.inputTokens);
  const completionTokens = asNumber(last.outputTokens);
  const cachedInputTokens = asNumber(last.cachedInputTokens);
  const reasoningOutputTokens = asNumber(last.reasoningOutputTokens);
  return {
    promptTokens,
    completionTokens,
    totalTokens: asNumber(last.totalTokens) || (promptTokens + completionTokens),
    tokenAccuracy: "reported",
    usageSource: "ledger",
    usageDetails: {
      inputNoCacheTokens: Math.max(0, promptTokens - cachedInputTokens),
      inputCacheReadTokens: cachedInputTokens,
      outputTextTokens: completionTokens,
      outputReasoningTokens: reasoningOutputTokens,
      raw: record ?? undefined,
    },
  };
}

export function isVisibleAssistantTextChunk(
  chunk: {
    transcriptVisibility?: "visible" | "activity_only" | "summary";
    streamKind?: "assistant_output" | "provider_client";
  },
): boolean {
  const transcriptVisibility = chunk.transcriptVisibility ?? "visible";
  const streamKind = chunk.streamKind ?? "assistant_output";
  return transcriptVisibility === "visible" && streamKind === "assistant_output";
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

function asRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as JsonRecord;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
