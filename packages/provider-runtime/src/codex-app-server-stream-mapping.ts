import type {
  StreamChunk,
  TokenUsage,
  WorkItem,
  WorkItemBody,
  WorkItemEvent,
  WorkItemKind,
  WorkItemPlan,
  WorkItemPlanStep,
  WorkItemStatus,
} from "@spaceskit/core";

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
  if (!item || !itemType) {
    return;
  }

  const workItemEvent = mapItemToWorkItemEvent(item, "completed");
  if (workItemEvent) {
    yield { type: "work_item_event", workItemEvent };
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

export function mapTurnPlanUpdatedToChunk(params: unknown): StreamChunk | undefined {
  const record = asRecord(params);
  const turnId = asString(record?.turnId);
  const plan = normalizePlan(record);
  if (!plan) {
    return undefined;
  }
  return {
    type: "work_item_event",
    workItemEvent: {
      event: "updated",
      workItem: {
        id: turnId ? `plan:${turnId}` : "plan",
        kind: "plan",
        status: "inProgress",
        title: "Plan",
        plan,
      },
    },
  };
}

export function mapStartedItemToWorkItemChunk(params: unknown): StreamChunk | undefined {
  const record = asRecord(params);
  const item = asRecord(record?.item);
  if (!item) {
    return undefined;
  }
  const event = mapItemToWorkItemEvent(item, "started");
  return event ? { type: "work_item_event", workItemEvent: event } : undefined;
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

function mapItemToWorkItemEvent(
  item: JsonRecord,
  event: WorkItemEvent["event"],
): WorkItemEvent | undefined {
  const itemType = asString(item.type);
  const kind = itemType ? workItemKindForAppServerItem(itemType) : undefined;
  if (!kind) {
    return undefined;
  }
  const id = asString(item.id) ?? `${kind}:unknown`;
  const status = normalizeWorkItemStatus(item.status) ?? statusForEvent(event);
  const title = inferWorkItemTitle(kind, item);
  const body = inferWorkItemBody(kind, item);
  const plan = kind === "plan" ? normalizePlan(item) : undefined;
  const artifact = kind === "artifact" ? normalizeArtifact(item) : undefined;
  const payload = inferWorkItemPayload(kind, item);
  const summary = asString(item.summary);
  const workItem: WorkItem = {
    id,
    kind,
  };

  if (status) workItem.status = status;
  if (title) workItem.title = title;
  if (summary) workItem.summary = summary;
  if (body) workItem.body = body;
  if (plan) workItem.plan = plan;
  if (artifact) workItem.artifact = artifact;
  if (payload) workItem.payload = payload;

  return { event, workItem };
}

function workItemKindForAppServerItem(itemType: string): WorkItemKind | undefined {
  switch (itemType) {
    case "plan":
      return "plan";
    case "commandExecution":
      return "command";
    case "fileChange":
      return "fileChange";
    case "mcpToolCall":
    case "dynamicToolCall":
      return "toolCall";
    case "collabAgentToolCall":
      return "collabAgent";
    case "webSearch":
      return "webSearch";
    case "imageView":
    case "imageGeneration":
      return "image";
    case "reasoning":
      return "reasoning";
    case "agentMessage":
    case "userMessage":
    case "hookPrompt":
      return "message";
    case "artifact":
      return "artifact";
    default:
      return undefined;
  }
}

function statusForEvent(event: WorkItemEvent["event"]): WorkItemStatus {
  switch (event) {
    case "started":
    case "updated":
    case "delta":
      return "inProgress";
    case "failed":
      return "failed";
    case "completed":
      return "completed";
  }
}

function normalizeWorkItemStatus(value: unknown): WorkItemStatus | undefined {
  if (value === "pending" || value === "completed" || value === "failed") {
    return value;
  }
  if (value === "inProgress" || value === "in_progress" || value === "running") {
    return "inProgress";
  }
  if (value === "cancelled" || value === "canceled" || value === "interrupted") {
    return "cancelled";
  }
  return undefined;
}

function normalizePlan(record: JsonRecord | null): WorkItemPlan | undefined {
  if (!record) {
    return undefined;
  }
  const planItems = asArray(record.plan ?? record.steps)
    .flatMap((entry): WorkItemPlanStep[] => {
      const step = asRecord(entry);
      const text = asString(step?.step) ?? asString(step?.text) ?? asString(entry);
      if (!text) {
        return [];
      }
      return [{
        step: text,
        status: normalizePlanStepStatus(step?.status),
      }];
    });
  if (planItems.length === 0) {
    return undefined;
  }
  const explanation = asString(record.explanation);
  return explanation
    ? { explanation, steps: planItems }
    : { steps: planItems };
}

function normalizePlanStepStatus(value: unknown): WorkItemPlanStep["status"] {
  if (value === "completed") {
    return "completed";
  }
  if (value === "inProgress" || value === "in_progress" || value === "running") {
    return "inProgress";
  }
  return "pending";
}

function inferWorkItemTitle(kind: WorkItemKind, item: JsonRecord): string | undefined {
  switch (kind) {
    case "plan":
      return "Plan";
    case "command":
      return asString(item.command) ?? "Command";
    case "fileChange":
      return asString(item.summary) ?? "File change";
    case "toolCall":
      return asString(item.toolName) ?? asString(item.name) ?? "Tool call";
    case "collabAgent":
      return asString(item.agentId) ?? asString(item.agentName) ?? "Collab agent";
    case "webSearch":
      return asString(item.query) ?? "Web search";
    case "image":
      return asString(item.prompt) ?? "Image";
    case "reasoning":
      return "Reasoning";
    case "message":
      return "Message";
    case "artifact":
      return asString(item.title) ?? asString(item.path) ?? "Artifact";
    case "status":
      return asString(item.status) ?? "Status";
  }
}

function inferWorkItemBody(kind: WorkItemKind, item: JsonRecord): WorkItemBody | undefined {
  const text = (() => {
    switch (kind) {
      case "command":
        return asString(item.aggregatedOutput) ?? asString(item.output);
      case "fileChange":
        return asString(item.summary) ?? asString(item.output);
      case "reasoning": {
        const parts = [
          ...asArray(item.summary).flatMap((entry) => asString(entry) ?? []),
          ...asArray(item.content).flatMap((entry) => asString(entry) ?? []),
        ];
        return parts.length > 0 ? parts.join("\n") : undefined;
      }
      case "message":
        return asString(item.text) ?? asString(item.content);
      case "artifact":
        return asString(item.previewText) ?? asString(item.text) ?? asString(item.content);
      default:
        return undefined;
    }
  })();
  return text ? { mimeType: "text/plain", text } : undefined;
}

function inferWorkItemPayload(kind: WorkItemKind, item: JsonRecord): Record<string, unknown> | undefined {
  const payload = (() => {
    switch (kind) {
      case "command":
        return compactObject({
          command: item.command,
          exitCode: item.exitCode,
          durationMs: item.durationMs,
        });
      case "fileChange":
        return compactObject({
          changes: item.changes,
          path: item.path,
        });
      case "toolCall":
        return compactObject({
          toolName: item.toolName ?? item.name,
          serverName: item.serverName,
          arguments: item.arguments,
          result: item.result,
        });
      case "collabAgent":
        return compactObject({
          agentId: item.agentId,
          agentName: item.agentName,
          task: item.task,
          result: item.result,
        });
      case "webSearch":
        return compactObject({
          query: item.query,
          results: item.results,
        });
      case "image":
        return compactObject({
          prompt: item.prompt,
          images: item.images ?? item.outputImages,
        });
      default:
        return {};
    }
  })();
  return Object.keys(payload).length > 0 ? payload : undefined;
}

function normalizeArtifact(item: JsonRecord): WorkItem["artifact"] | undefined {
  const artifact = compactObject({
    id: item.artifactId ?? item.id,
    title: item.title,
    path: item.path,
    uri: item.uri,
    mimeType: item.mimeType,
    previewText: item.previewText,
    body: inferWorkItemBody("artifact", item),
  });
  return Object.keys(artifact).length > 0 ? artifact as WorkItem["artifact"] : undefined;
}

function compactObject(input: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null) {
      continue;
    }
    if (typeof value === "string" && value.trim().length === 0) {
      continue;
    }
    output[key] = value;
  }
  return output;
}
