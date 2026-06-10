import type {
  TurnEventPayload,
  TurnStreamPayload,
} from "@spaceskit/client";
import type { TurnObservation } from "./headless-harness-types.js";
import { isRecord, sleep } from "./headless-harness-utils.js";

type HarnessTurnEventPayload = TurnEventPayload & {
  eventType?: string;
  data?: unknown;
};

function getTurnEventType(event: HarnessTurnEventPayload): string {
  if (event.eventType) {
    return event.eventType;
  }
  switch (event.typedPayload.kind) {
    case "turn.completed":
      return "completed";
    case "turn.failed":
      return "failed";
    case "tool.started":
    case "tool.completed":
      return "tool_call";
    default:
      return event.typedPayload.kind;
  }
}

function summarizeTurnEvent(event: HarnessTurnEventPayload): Record<string, unknown> {
  return {
    kind: "event",
    turnId: event.turnId,
    eventType: getTurnEventType(event),
    agentId: event.agentId,
    typedKind: event.typedPayload?.kind,
    ts: event.ts,
  };
}

function summarizeTurnStream(event: TurnStreamPayload): Record<string, unknown> {
  return {
    kind: "stream",
    turnId: event.turnId,
    agentId: event.agentId,
    delta: event.delta,
    seq: event.seq,
    done: event.done,
  };
}

function extractTurnCompletionMessage(event: HarnessTurnEventPayload): string | undefined {
  if (event.typedPayload?.kind === "turn.completed") {
    return event.typedPayload.finalMessage;
  }

  const data = isRecord(event.data) ? event.data : {};
  const result = isRecord(data.result) ? data.result : data;
  if (typeof result.finalMessage === "string") {
    return result.finalMessage;
  }
  if (typeof result.output === "string") {
    return result.output;
  }
  const finalMessage = isRecord(result.finalMessage) ? result.finalMessage : null;
  return typeof finalMessage?.content === "string" ? finalMessage.content : undefined;
}

function extractTurnFailure(event: HarnessTurnEventPayload): string | undefined {
  if (event.typedPayload?.kind === "turn.failed") {
    return event.typedPayload.errorMessage;
  }
  const data = isRecord(event.data) ? event.data : {};
  if (typeof data.message === "string") {
    return data.message;
  }
  if (typeof data.error === "string") {
    return data.error;
  }
  return undefined;
}

export class TurnObservationCollector {
  private readonly spaceId?: string;
  private readonly pendingEvents: HarnessTurnEventPayload[] = [];
  private readonly pendingStreams: TurnStreamPayload[] = [];
  private readonly observation: TurnObservation = {
    turnId: null,
    status: "pending",
    streamText: "",
    events: [],
    toolCalls: [],
  };

  constructor(spaceId?: string) {
    this.spaceId = spaceId;
  }

  bindTurn(turnId: string): void {
    this.observation.turnId = turnId;
    for (const pendingEvent of this.pendingEvents.splice(0)) {
      this.ingestEvent(pendingEvent);
    }
    for (const pendingStream of this.pendingStreams.splice(0)) {
      this.ingestStream(pendingStream);
    }
  }

  ingestEvent(event: HarnessTurnEventPayload): void {
    if (!this.acceptsSpace(event.spaceId, event.spaceUid)) {
      return;
    }
    if (!this.observation.turnId) {
      this.pendingEvents.push(event);
      return;
    }
    if (event.turnId !== this.observation.turnId) {
      return;
    }

    this.observation.events.push(summarizeTurnEvent(event));

    const eventType = getTurnEventType(event);
    if (eventType === "tool_call") {
      this.observation.toolCalls.push({
        agentId: event.agentId,
        typedPayload: event.typedPayload ?? null,
        data: event.data ?? null,
      });
    }

    if (eventType === "completed") {
      this.observation.status = "completed";
      this.observation.finalMessage = extractTurnCompletionMessage(event) ?? this.observation.streamText;
      return;
    }

    if (eventType === "failed") {
      this.observation.status = "failed";
      this.observation.failure = extractTurnFailure(event) ?? "Turn failed";
    }
  }

  ingestStream(event: TurnStreamPayload): void {
    if (!this.acceptsSpace(event.spaceId, event.spaceUid)) {
      return;
    }
    if (!this.observation.turnId) {
      this.pendingStreams.push(event);
      return;
    }
    if (event.turnId !== this.observation.turnId) {
      return;
    }

    this.observation.events.push(summarizeTurnStream(event));
    this.observation.streamText += event.delta;
  }

  isTerminal(): boolean {
    return this.observation.status !== "pending";
  }

  snapshot(): TurnObservation {
    return {
      ...this.observation,
      events: [...this.observation.events],
      toolCalls: [...this.observation.toolCalls],
    };
  }

  private acceptsSpace(spaceId?: string, spaceUid?: string): boolean {
    if (!this.spaceId) {
      return true;
    }
    return spaceId === this.spaceId || spaceUid === this.spaceId;
  }
}

export async function waitForTurnTerminal(
  collector: TurnObservationCollector,
  timeoutMs: number,
): Promise<TurnObservation> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (collector.isTerminal()) {
      return collector.snapshot();
    }
    await sleep(25);
  }

  const snapshot = collector.snapshot();
  throw new Error(
    `Timed out waiting for terminal turn event after ${timeoutMs}ms. Observed events: ${JSON.stringify(snapshot.events)}`,
  );
}
