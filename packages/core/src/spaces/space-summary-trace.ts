import { randomUUID } from "node:crypto";
import type { TurnEvent } from "../agents/agent-runtime.js";
import type {
  SpaceAgentAssignment,
  TurnModelStrategy,
} from "./types.js";

export interface SummaryParticipantTrace {
  agentId: string;
  turnOrder: number;
  isPrimary: boolean;
  status: "pending" | "completed" | "failed";
  promptTokens: number;
  completionTokens: number;
  finalMessage?: string;
  error?: string;
}

interface SummaryHighlight {
  agentId: string;
  eventType: "text_delta" | "turn_completed" | "error" | "feedback_requested";
  text: string;
  timestamp: string;
}

export interface OrchestratorSummaryTrace {
  summaryId: string;
  spaceId: string;
  turnId: string;
  turnModel: TurnModelStrategy;
  input: string;
  createdAt: Date;
  participants: Map<string, SummaryParticipantTrace>;
  highlights: SummaryHighlight[];
  peerReview: {
    enabled: boolean;
    topology: "ring";
    assignments: number;
    completed: number;
    failed: number;
    status: "not_run" | "skipped" | "completed" | "degraded";
    failureReason?: string;
  };
}

export const SUMMARY_ELIGIBLE_TURN_MODELS = new Set<TurnModelStrategy>([
  "sequential_all",
  "primary_only",
  "first_success",
  "parallel_race",
  "debate_synthesis",
  "adaptive_auto",
]);

export function createOrchestratorSummaryTrace(input: {
  spaceId: string;
  turnId: string;
  userInput: string;
  strategy: TurnModelStrategy;
  agents: SpaceAgentAssignment[];
  peerReview: Pick<OrchestratorSummaryTrace["peerReview"], "enabled" | "topology">;
}): OrchestratorSummaryTrace | null {
  if (!SUMMARY_ELIGIBLE_TURN_MODELS.has(input.strategy)) return null;
  if (input.agents.length < 2) return null;

  const orderedAgents = [...input.agents].sort((lhs, rhs) => {
    if (lhs.turnOrder !== rhs.turnOrder) return lhs.turnOrder - rhs.turnOrder;
    return lhs.agentId.localeCompare(rhs.agentId);
  });

  const participants = new Map<string, SummaryParticipantTrace>();
  for (const assignment of orderedAgents) {
    participants.set(assignment.agentId, {
      agentId: assignment.agentId,
      turnOrder: assignment.turnOrder,
      isPrimary: assignment.isPrimary,
      status: "pending",
      promptTokens: 0,
      completionTokens: 0,
    });
  }

  return {
    summaryId: randomUUID(),
    spaceId: input.spaceId,
    turnId: input.turnId,
    turnModel: input.strategy,
    input: input.userInput,
    createdAt: new Date(),
    participants,
    highlights: [],
    peerReview: {
      enabled: input.peerReview.enabled,
      topology: input.peerReview.topology,
      assignments: 0,
      completed: 0,
      failed: 0,
      status: "not_run",
    },
  };
}

export function recordOrchestratorSummaryEvent(
  trace: OrchestratorSummaryTrace | null | undefined,
  agentId: string,
  event: TurnEvent,
): void {
  if (!trace) return;
  const participant = trace.participants.get(agentId);
  if (!participant) return;

  const nowIso = new Date().toISOString();
  switch (event.type) {
    case "text_delta": {
      const text = event.text.trim();
      if (!text) return;
      if (trace.highlights.length >= 12) return;
      trace.highlights.push({
        agentId,
        eventType: "text_delta",
        text: truncateHighlightText(text),
        timestamp: nowIso,
      });
      return;
    }
    case "feedback_requested": {
      if (trace.highlights.length >= 12) return;
      trace.highlights.push({
        agentId,
        eventType: "feedback_requested",
        text: event.request.description,
        timestamp: nowIso,
      });
      return;
    }
    case "turn_completed": {
      participant.status = "completed";
      participant.promptTokens += event.result.usage.promptTokens;
      participant.completionTokens += event.result.usage.completionTokens;
      const message = event.result.finalMessage.content.trim();
      if (message) {
        participant.finalMessage = message;
        if (trace.highlights.length < 12) {
          trace.highlights.push({
            agentId,
            eventType: "turn_completed",
            text: truncateHighlightText(message),
            timestamp: nowIso,
          });
        }
      }
      return;
    }
    case "error": {
      participant.status = "failed";
      participant.error = event.error.message;
      if (trace.highlights.length < 12) {
        trace.highlights.push({
          agentId,
          eventType: "error",
          text: event.error.message,
          timestamp: nowIso,
        });
      }
    }
  }
}

export function buildOrchestratorSummaryText(
  participants: SummaryParticipantTrace[],
  status: "completed" | "degraded",
  peerReview: OrchestratorSummaryTrace["peerReview"],
): string {
  const failed = participants.filter((participant) => participant.status === "failed");
  const primaryParticipant = participants.find((participant) => participant.isPrimary);
  const guestCount = Math.max(
    participants.length - (primaryParticipant ? 1 : 0),
    0,
  );
  const summaryParts = [
    `Master coordinated ${guestCount} ${guestCount === 1 ? "guest" : "guests"}`,
    status,
    "Full log available",
  ];
  if (failed.length > 0) {
    summaryParts.push(
      `failed: ${failed.map((participant) => participant.agentId).join(", ")}`,
    );
  }
  if (peerReview.status !== "not_run" && peerReview.status !== "skipped") {
    summaryParts.push(`peer-review: ${peerReview.completed}/${peerReview.assignments} completed`);
    if (peerReview.failed > 0) {
      summaryParts.push(`peer-review failed: ${peerReview.failed}`);
    }
  }
  return summaryParts.join(" · ");
}

function truncateHighlightText(text: string): string {
  return text.length > 220 ? `${text.slice(0, 220)}...` : text;
}
