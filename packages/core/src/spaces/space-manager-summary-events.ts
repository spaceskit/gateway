import type { EventBus } from "../events/event-bus.js";
import type { TurnEvent } from "../agents/agent-runtime.js";
import type { ReflectionService } from "../reflection/reflection-service.js";
import type {
  SpaceAgentAssignment,
  TurnModelStrategy,
} from "./types.js";
import {
  buildOrchestratorSummaryText,
  createOrchestratorSummaryTrace,
  recordOrchestratorSummaryEvent,
  type OrchestratorSummaryTrace,
} from "./space-summary-trace.js";

export function createSpaceManagerSummaryTrace(input: {
  spaceId: string;
  turnId: string;
  userInput: string;
  strategy: TurnModelStrategy;
  agents: SpaceAgentAssignment[];
  peerReview: Pick<OrchestratorSummaryTrace["peerReview"], "enabled" | "topology">;
}): OrchestratorSummaryTrace | null {
  return createOrchestratorSummaryTrace(input);
}

export function recordSpaceManagerSummaryEvent(
  trace: OrchestratorSummaryTrace | null | undefined,
  agentId: string,
  event: TurnEvent,
): void {
  recordOrchestratorSummaryEvent(trace, agentId, event);
}

export function emitSpaceManagerSummaryEvent(input: {
  eventBus: EventBus;
  reflectionService?: Pick<ReflectionService, "runSummaryJob">;
  spaceId: string;
  turnId: string;
  trace: OrchestratorSummaryTrace | null | undefined;
  executionError?: unknown;
}): void {
  const {
    eventBus,
    reflectionService,
    spaceId,
    turnId,
    trace,
    executionError,
  } = input;
  if (!trace) return;

  const participants = [...trace.participants.values()].sort((lhs, rhs) => {
    if (lhs.turnOrder !== rhs.turnOrder) return lhs.turnOrder - rhs.turnOrder;
    return lhs.agentId.localeCompare(rhs.agentId);
  });

  if (participants.length < 2) return;

  const executionFailureReason = executionError instanceof Error
    ? executionError.message
    : executionError
      ? String(executionError)
      : undefined;
  const hasParticipantFailure = participants.some((participant) => participant.status === "failed");
  const hasPeerReviewFailure = trace.peerReview.status === "degraded" || trace.peerReview.failed > 0;
  const summaryStatus = executionFailureReason || hasParticipantFailure || hasPeerReviewFailure
    ? "degraded"
    : "completed";
  const eventType = executionFailureReason ? "summary.failed" : "summary.completed";

  const summaryTextPromise = reflectionService?.runSummaryJob({
    kind: "orchestrator",
    conversationTopology: trace.turnModel === "primary_only" ? "broadcast_team" : "shared_team_chat",
    turnModel: trace.turnModel,
    userInput: trace.input,
    participants: participants.map((participant) => ({
      agentId: participant.agentId,
      isPrimary: participant.isPrimary,
      status: participant.status,
      finalMessage: participant.finalMessage,
      error: participant.error,
    })),
    peerReview: trace.peerReview,
    highlights: trace.highlights.map((highlight) => ({
      agentId: highlight.agentId,
      text: highlight.text,
    })),
  });

  const summary = {
    summaryId: trace.summaryId,
    version: "v1",
    spaceId: trace.spaceId,
    turnId: trace.turnId,
    turnModel: trace.turnModel,
    generatedAt: new Date().toISOString(),
    status: summaryStatus,
    failureReason: executionFailureReason
      ?? (hasParticipantFailure ? "One or more participant turns failed." : undefined)
      ?? (hasPeerReviewFailure ? "One or more peer-review turns failed." : undefined),
    participants: participants.map((participant) => ({
      agentId: participant.agentId,
      turnOrder: participant.turnOrder,
      isPrimary: participant.isPrimary,
      status: participant.status,
      promptTokens: participant.promptTokens,
      completionTokens: participant.completionTokens,
      finalMessage: participant.finalMessage,
      error: participant.error,
    })),
    peerReview: trace.peerReview,
    highlights: trace.highlights.slice(0, 8),
    finalSummaryText: undefined as string | undefined,
  };

  const emitSummary = (finalSummaryText: string) => eventBus.emit({
    type: "space.orchestrator_event",
    spaceId,
    turnId,
    commandId: `summary-${turnId}`,
    correlationId: turnId,
    status: eventType === "summary.failed" ? "failed" : "completed",
    createdAt: new Date().toISOString(),
    eventType,
    event: {
      type: eventType,
      summary: {
        ...summary,
        finalSummaryText,
      },
    },
    timestamp: new Date(),
  });
  const fallbackSummaryText = () => buildOrchestratorSummaryText(
    participants,
    summaryStatus,
    trace.peerReview,
  );

  if (summaryTextPromise) {
    void summaryTextPromise
      .then((result) => emitSummary(result.summaryText))
      .catch(() => emitSummary(fallbackSummaryText()));
    return;
  }

  emitSummary(fallbackSummaryText());
}
