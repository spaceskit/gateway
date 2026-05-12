import type {
  AgentActivityState,
  TurnEventPayload,
  TurnMetadata,
  TurnStreamPayload,
  TypedTurnEventPayload,
} from "./protocol.js";

type LaunchSnapshot = NonNullable<
  Extract<TypedTurnEventPayload, { kind: "turn.started" }>["launchSnapshots"]
>[number];

export interface BuildTurnStreamPayloadInput {
  eventRecord: Record<string, unknown>;
  turnEvent?: Record<string, unknown>;
  spaceId: string;
  spaceUid: string;
}

export interface BuildTypedTurnPayloadInput {
  eventSubtype: string;
  normalizedType: string;
  eventRecord: Record<string, unknown>;
  agentId: string;
  turnId: string;
  rootTurnId?: string;
  conversationTopology?: string;
  transcriptVisibility?: string;
}

export function normalizeGatewayEventPayload(value: unknown): unknown {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value instanceof Error) {
    const code = (value as { code?: unknown }).code;
    return {
      name: value.name,
      message: value.message,
      ...(value.stack ? { stack: value.stack } : {}),
      ...(typeof code === "string" || typeof code === "number" ? { code } : {}),
    };
  }

  if (Array.isArray(value)) {
    return value.map((entry) => normalizeGatewayEventPayload(entry));
  }

  if (value && typeof value === "object") {
    const normalized: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      normalized[key] = normalizeGatewayEventPayload(entry);
    }
    return normalized;
  }

  return value;
}

export function buildTurnStreamPayload(input: BuildTurnStreamPayloadInput): TurnStreamPayload {
  const { eventRecord, turnEvent, spaceId, spaceUid } = input;
  const turnId = typeof eventRecord.turnId === "string" ? eventRecord.turnId : "";
  const rootTurnId = typeof eventRecord.rootTurnId === "string" ? eventRecord.rootTurnId : undefined;
  const conversationTopology = typeof eventRecord.conversationTopology === "string"
    ? eventRecord.conversationTopology
    : undefined;
  const transcriptVisibility = normalizeTranscriptVisibility(
    typeof turnEvent?.transcriptVisibility === "string"
      ? turnEvent.transcriptVisibility
      : typeof eventRecord.transcriptVisibility === "string"
        ? eventRecord.transcriptVisibility
        : undefined,
  );
  const summaryTurnId = typeof eventRecord.summaryTurnId === "string" ? eventRecord.summaryTurnId : undefined;
  const streamKind = normalizeStreamKind(
    typeof turnEvent?.streamKind === "string" ? turnEvent.streamKind : undefined,
  );

  return {
    spaceId,
    spaceUid,
    turnId,
    rootTurnId,
    agentId: resolveTurnAgentId(eventRecord, turnEvent),
    ...(conversationTopology ? { conversationTopology } : {}),
    ...(transcriptVisibility ? { transcriptVisibility } : {}),
    ...(summaryTurnId ? { summaryTurnId } : {}),
    ...(streamKind ? { streamKind } : {}),
    delta: typeof turnEvent?.text === "string" ? turnEvent.text : "",
    seq: coerceInteger(turnEvent?.seq ?? eventRecord.seq, 0),
    done: coerceBoolean(turnEvent?.done, false),
  };
}

export function mapTurnLifecycleEventType(
  eventSubtypeRaw: string,
  normalizedType: string,
): TurnEventPayload["eventType"] {
  const eventSubtype = eventSubtypeRaw.trim().toLowerCase();
  switch (eventSubtype) {
    case "text_delta":
      return "streaming";
    case "tool_call":
    case "tool_call_start":
    case "tool_result":
      return "tool_call";
    case "feedback_requested":
      return "feedback_requested";
    case "feedback_resolved":
      return "state_changed";
    case "rate_limited":
      return "rate_limited";
    case "state_changed":
      return "state_changed";
    case "turn_completed":
      return "completed";
    case "turn_cancelled":
      return "cancelled";
    case "error":
      return "failed";
    default:
      if (normalizedType === "space.turn_started") {
        return "started";
      }
      return "streaming";
  }
}

export function buildTypedTurnPayload(input: BuildTypedTurnPayloadInput): TypedTurnEventPayload | undefined {
  const {
    eventSubtype,
    normalizedType,
    eventRecord,
    agentId,
    turnId,
    rootTurnId,
    conversationTopology,
    transcriptVisibility,
  } = input;
  const subtype = eventSubtype.trim().toLowerCase();

  switch (subtype) {
    case "reasoning_delta": {
      const text = typeof eventRecord.text === "string" ? eventRecord.text : "";
      return { kind: "reasoning.delta", text };
    }

    case "tool_call_start": {
      const toolCallId = typeof eventRecord.toolCallId === "string"
        ? eventRecord.toolCallId
        : typeof eventRecord.id === "string" ? eventRecord.id : "";
      const toolName = typeof eventRecord.toolName === "string"
        ? eventRecord.toolName
        : typeof eventRecord.name === "string" ? eventRecord.name : "unknown";
      const args = eventRecord.arguments && typeof eventRecord.arguments === "object"
        ? eventRecord.arguments as Record<string, unknown>
        : undefined;
      return { kind: "tool.started", toolCallId, toolName, arguments: args, agentId };
    }

    case "tool_result": {
      const toolCallId = typeof eventRecord.toolCallId === "string"
        ? eventRecord.toolCallId
        : typeof eventRecord.id === "string" ? eventRecord.id : "";
      const toolName = typeof eventRecord.toolName === "string"
        ? eventRecord.toolName
        : typeof eventRecord.name === "string" ? eventRecord.name : undefined;
      const isError = coerceBoolean(eventRecord.isError ?? eventRecord.is_error, false);
      return { kind: "tool.completed", toolCallId, toolName, result: eventRecord.result ?? null, isError, agentId };
    }

    case "state_changed": {
      const state = typeof eventRecord.state === "string" ? eventRecord.state : "idle";
      const validStates = new Set<AgentActivityState>(["idle", "thinking", "acting", "needs_feedback", "errored"]);
      return { kind: "state.changed", state: validStates.has(state as AgentActivityState) ? state as AgentActivityState : "idle" };
    }

    case "feedback_requested": {
      const requestId = typeof eventRecord.requestId === "string" ? eventRecord.requestId : "";
      const description = typeof eventRecord.description === "string" ? eventRecord.description : "";
      const options = Array.isArray(eventRecord.options)
        ? eventRecord.options.filter((option): option is string => typeof option === "string")
        : ["approve", "reject"];
      const context = eventRecord.context && typeof eventRecord.context === "object"
        ? eventRecord.context as Record<string, unknown>
        : undefined;
      return { kind: "approval.requested", requestId, agentId, description, options, context };
    }

    case "feedback_resolved": {
      const requestId = typeof eventRecord.requestId === "string"
        ? eventRecord.requestId
        : turnId;
      const response = typeof eventRecord.response === "string"
        ? eventRecord.response
        : "approved";
      return { kind: "approval.resolved", requestId, response, agentId };
    }

    case "rate_limited": {
      const retryAfterMs = coerceInteger(eventRecord.retryAfterMs, 0);
      const attempt = coerceInteger(eventRecord.attempt, 0);
      const maxAttempts = coerceInteger(eventRecord.maxAttempts, 0);
      const providerId = typeof eventRecord.providerId === "string" ? eventRecord.providerId : "";
      const retryAt = typeof eventRecord.retryAt === "string"
        ? eventRecord.retryAt
        : new Date(Date.now() + retryAfterMs).toISOString();
      return { kind: "rate_limited", retryAfterMs, attempt, maxAttempts, providerId, retryAt };
    }

    case "turn_completed": {
      const result = eventRecord.result && typeof eventRecord.result === "object"
        ? eventRecord.result as Record<string, unknown>
        : eventRecord;
      const usage = result.usage && typeof result.usage === "object"
        ? result.usage as Record<string, unknown>
        : undefined;
      const turnUsage = usage ? {
        promptTokens: coerceInteger(usage.promptTokens ?? usage.prompt_tokens, 0),
        completionTokens: coerceInteger(usage.completionTokens ?? usage.completion_tokens, 0),
        totalTokens: coerceInteger(usage.totalTokens ?? usage.total_tokens, 0),
      } : undefined;
      const metadata: TurnMetadata = {};
      for (const key of ["modelId", "providerId", "durationMs", "finishReason", "startedAt", "completedAt", "tokensPerSecond"] as const) {
        if (result[key] !== undefined) {
          metadata[key] = result[key] as never;
        }
      }
      const finalMessage = typeof result.output === "string"
        ? result.output
        : typeof result.finalMessage === "string" ? result.finalMessage : undefined;
      const effectiveSafetyProfileId = typeof result.effectiveSafetyProfileId === "string"
        ? result.effectiveSafetyProfileId
        : undefined;
      return {
        kind: "turn.completed",
        agentId,
        usage: turnUsage,
        metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
        finalMessage,
        effectiveSafetyProfileId,
      };
    }

    case "error": {
      const errorMessage = typeof eventRecord.message === "string"
        ? eventRecord.message
        : typeof eventRecord.error === "string" ? eventRecord.error : "Unknown error";
      const errorCode = typeof eventRecord.code === "string" ? eventRecord.code : undefined;
      return { kind: "turn.failed", errorMessage, errorCode };
    }

    case "turn_cancelled":
      return { kind: "turn.cancelled", agentId };

    default: {
      if (normalizedType === "space.turn_started") {
        const launchSnapshots = normalizeLaunchSnapshots(
          eventRecord.launchSnapshots
          ?? (typeof eventRecord.data === "object"
            && eventRecord.data !== null
            && !Array.isArray(eventRecord.data)
            ? (eventRecord.data as Record<string, unknown>).launchSnapshots
            : undefined),
        );
        return {
          kind: "turn.started",
          agentId,
          turnId,
          rootTurnId,
          conversationTopology,
          transcriptVisibility,
          ...(launchSnapshots.length > 0 ? { launchSnapshots } : {}),
        };
      }
      return undefined;
    }
  }
}

export function resolveTurnAgentId(
  eventRecord: Record<string, unknown>,
  turnEvent?: Record<string, unknown>,
): string {
  const fromEvent = typeof turnEvent?.agentId === "string" ? turnEvent.agentId.trim() : "";
  if (fromEvent) return fromEvent;
  const fromLaunchSnapshot = normalizeLaunchSnapshots(
    turnEvent && typeof turnEvent.data === "object" && turnEvent.data !== null && !Array.isArray(turnEvent.data)
      ? (turnEvent.data as Record<string, unknown>).launchSnapshots
      : undefined,
  )[0]?.agentId;
  if (fromLaunchSnapshot) return fromLaunchSnapshot;
  const fromAgents = Array.isArray(eventRecord.agents)
    ? eventRecord.agents.find((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)?.trim()
    : undefined;
  if (fromAgents) return fromAgents;
  const resultRecord = turnEvent?.result;
  if (resultRecord && typeof resultRecord === "object" && !Array.isArray(resultRecord)) {
    const nested = (resultRecord as Record<string, unknown>).agentId;
    if (typeof nested === "string" && nested.trim().length > 0) {
      return nested.trim();
    }
  }
  const fromRecord = typeof eventRecord.agentId === "string" ? eventRecord.agentId.trim() : "";
  if (fromRecord) return fromRecord;
  return "unknown-agent";
}

export function normalizeLaunchSnapshots(value: unknown): LaunchSnapshot[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      return [];
    }
    const record = entry as Record<string, unknown>;
    const agentId = typeof record.agentId === "string" ? record.agentId.trim() : "";
    const providerId = typeof record.providerId === "string" ? record.providerId.trim() : "";
    const modelId = typeof record.modelId === "string" ? record.modelId.trim() : "";
    const contextWindowTokens = coerceInteger(record.contextWindowTokens, 0);
    const estimatedPromptTokens = coerceInteger(record.estimatedPromptTokens, 0);
    const estimatedRemainingTokens = coerceInteger(record.estimatedRemainingTokens, 0);
    const source = record.source === "preflight" || record.source === "reported"
      ? record.source
      : "registry";
    if (!agentId || !providerId || !modelId || contextWindowTokens <= 0) {
      return [];
    }
    return [{
      agentId,
      providerId,
      modelId,
      contextWindowTokens,
      estimatedPromptTokens,
      estimatedRemainingTokens,
      source,
    }];
  });
}

export function coerceInteger(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
}

export function coerceBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1" || normalized === "yes") {
      return true;
    }
    if (normalized === "false" || normalized === "0" || normalized === "no") {
      return false;
    }
  }
  return fallback;
}

export function sanitizeTurnLifecycleValue(value: unknown, keyPath: string[] = []): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeTurnLifecycleValue(entry, keyPath));
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const sanitized: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(record)) {
      if (shouldRedactTurnLifecycleKey(key, keyPath)) {
        const normalized = normalizeTurnLifecycleKey(key);
        sanitized[key] = normalized === "messages"
          ? "[REDACTED_MESSAGES]"
          : "[REDACTED]";
      } else {
        sanitized[key] = sanitizeTurnLifecycleValue(nested, [...keyPath, key]);
      }
    }
    return sanitized;
  }

  return value;
}

function normalizeTranscriptVisibility(
  value: string | undefined,
): TurnStreamPayload["transcriptVisibility"] {
  switch (value?.trim().toLowerCase()) {
    case "visible":
      return "visible";
    case "activity_only":
      return "activity_only";
    case "summary":
      return "summary";
    default:
      return undefined;
  }
}

function normalizeStreamKind(
  value: string | undefined,
): TurnStreamPayload["streamKind"] {
  switch (value?.trim().toLowerCase()) {
    case "assistant_output":
      return "assistant_output";
    case "provider_client":
      return "provider_client";
    default:
      return undefined;
  }
}

function shouldRedactTurnLifecycleKey(key: string, _keyPath: string[]): boolean {
  const normalized = normalizeTurnLifecycleKey(key);
  return normalized === "messages"
    || normalized.includes("instruction")
    || normalized.includes("prompt")
    || normalized.includes("planner")
    || normalized.includes("guest")
    || normalized.includes("peerreview")
    || normalized.includes("synthesis")
    || normalized.includes("tooltrace")
    || normalized.includes("rawtrace");
}

function normalizeTurnLifecycleKey(key: string): string {
  return key.toLowerCase().replace(/[_-]/g, "");
}
