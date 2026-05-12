import type {
  SchedulerEvalCheckpointPayload,
  SchedulerEvalConfigPayload,
  SchedulerEvalRecommendationPayload,
  SchedulerEvalRunPayload,
  SchedulerEvalSelfImproveStatePayload,
} from "@spaceskit/server";
import { normalizeOptionalString } from "./scheduler-normalizers.js";

export function buildEvalSelfImproveState(
  evalConfig: SchedulerEvalConfigPayload | null,
): SchedulerEvalSelfImproveStatePayload | null {
  if (!evalConfig) return null;
  return {
    enabled: evalConfig.selfImproveEnabled === true,
    appliedRevisionIds: [],
  };
}

export function mergeEvalSelfImproveState(
  current: SchedulerEvalSelfImproveStatePayload | null,
  evalConfig: SchedulerEvalConfigPayload | null,
): SchedulerEvalSelfImproveStatePayload | null {
  if (!evalConfig) return null;
  return {
    enabled: evalConfig.selfImproveEnabled === true,
    appliedRevisionIds: current?.appliedRevisionIds ?? [],
    lastAppliedRunId: current?.lastAppliedRunId,
  };
}

export function resolveTemplateId(flowVariantId: string | undefined): string {
  switch (flowVariantId) {
    case "analysis":
      return "archetype/analysis";
    case "discussion":
      return "archetype/discussion";
    case "debate":
      return "archetype/debate";
    case "coding":
      return "archetype/coding";
    case "research":
    default:
      return "archetype/research";
  }
}

export function eventToEvalCheckpoint(
  event: Record<string, unknown>,
  index: number,
): SchedulerEvalCheckpointPayload | null {
  const observedType = normalizeOptionalString(event.observedType);
  if (!observedType) return null;
  if (observedType === "context.summarizing" || observedType === "context.summarized") {
    return {
      checkpointId: `${observedType}:${index}`,
      kind: observedType,
      status: "observed",
      createdAt: serializeEventTimestamp(event.timestamp),
      detail: sanitizeEventDetail(event),
    };
  }
  if (observedType === "space.orchestrator_event") {
    const eventType = normalizeOptionalString(event.eventType);
    if (!eventType) return null;
    return {
      checkpointId: `${eventType}:${index}`,
      kind: eventType,
      status: eventType === "summary.failed" ? "failed" : "completed",
      createdAt: normalizeOptionalString(event.createdAt) ?? serializeEventTimestamp(event.timestamp),
      detail: sanitizeEventDetail(event.event),
    };
  }
  return null;
}

function sanitizeEventDetail(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(record).filter(([, entry]) =>
      typeof entry === "string"
      || typeof entry === "number"
      || typeof entry === "boolean"
      || (entry && typeof entry === "object" && !Array.isArray(entry)),
    ),
  );
}

function serializeEventTimestamp(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Date) return value.toISOString();
  return new Date().toISOString();
}

export function generateEvalRecommendations(
  evalConfig: SchedulerEvalConfigPayload,
  checkpoints: SchedulerEvalCheckpointPayload[],
  runId: string,
): SchedulerEvalRecommendationPayload[] {
  const recommendations: SchedulerEvalRecommendationPayload[] = [];
  if (!evalConfig.promptPackId && checkpoints.some((checkpoint) => checkpoint.kind.startsWith("peer_review."))) {
    recommendations.push({
      recommendationId: `${runId}:prompt-pack`,
      status: "suggested",
      kind: "prompt_pack",
      title: "Pin a prompt pack for consistent collaboration replay",
      summary: "Peer-review checkpoints were present without an explicit prompt pack.",
      originatingRunId: runId,
      promptPackId: defaultPromptPackId(evalConfig.flowVariantId),
      flowVariantId: evalConfig.flowVariantId,
      createdAt: new Date().toISOString(),
    });
  }
  if (
    evalConfig.flowVariantId !== "research"
    && checkpoints.some((checkpoint) => checkpoint.kind === "context.summarized")
  ) {
    recommendations.push({
      recommendationId: `${runId}:flow-variant`,
      status: "suggested",
      kind: "flow_variant",
      title: "Switch to the research flow for better context compression resilience",
      summary: "The run compacted context; the research flow is the safest default for long overnight evals.",
      originatingRunId: runId,
      flowVariantId: "research",
      createdAt: new Date().toISOString(),
    });
  }
  if (
    evalConfig.summaryMode !== "checkpoints"
    && checkpoints.some((checkpoint) => checkpoint.kind.startsWith("summary."))
  ) {
    recommendations.push({
      recommendationId: `${runId}:summary-mode`,
      status: "suggested",
      kind: "summary_mode",
      title: "Use checkpoint summaries for overnight eval visibility",
      summary: "Terminal summaries were produced; checkpoint summaries make long unattended runs easier to audit.",
      originatingRunId: runId,
      createdAt: new Date().toISOString(),
      detail: { summaryMode: "checkpoints" },
    });
  }
  return recommendations;
}

export function applyRecommendations(
  recommendations: SchedulerEvalRecommendationPayload[],
  selfImproveState: SchedulerEvalSelfImproveStatePayload | null,
  runId: string,
): SchedulerEvalRecommendationPayload[] {
  if (!selfImproveState?.enabled) {
    return recommendations;
  }
  return recommendations.map((recommendation, index) => ({
    ...recommendation,
    status: "applied",
    appliedRevisionId: `eval-rev-${runId}-${index + 1}`,
  }));
}

export function applyRecommendationConfig(
  evalConfig: SchedulerEvalConfigPayload | null,
  recommendations: SchedulerEvalRecommendationPayload[],
): SchedulerEvalConfigPayload | null {
  if (!evalConfig) return null;
  const next = { ...evalConfig };
  for (const recommendation of recommendations) {
    if (recommendation.status !== "applied") continue;
    if (recommendation.kind === "flow_variant" && recommendation.flowVariantId) {
      next.flowVariantId = recommendation.flowVariantId;
    }
    if (recommendation.kind === "prompt_pack" && recommendation.promptPackId) {
      next.promptPackId = recommendation.promptPackId;
      delete next.promptVariantId;
    }
    if (recommendation.kind === "summary_mode") {
      next.summaryMode = "checkpoints";
    }
  }
  return next;
}

export function nextEvalSelfImproveState(
  current: SchedulerEvalSelfImproveStatePayload | null,
  evalConfig: SchedulerEvalConfigPayload | null,
  evalRun: SchedulerEvalRunPayload,
): SchedulerEvalSelfImproveStatePayload | null {
  if (!evalConfig) return null;
  const appliedRevisionIds = [
    ...(current?.appliedRevisionIds ?? []),
    ...evalRun.recommendations
      .map((recommendation) => recommendation.appliedRevisionId)
      .filter((revisionId): revisionId is string => Boolean(revisionId)),
  ];
  return {
    enabled: evalConfig.selfImproveEnabled === true,
    appliedRevisionIds,
    lastAppliedRunId: evalRun.recommendations.some((recommendation) => recommendation.status === "applied")
      ? evalRun.evalRunId
      : current?.lastAppliedRunId,
  };
}

function defaultPromptPackId(flowVariantId: string | undefined): string {
  switch (flowVariantId) {
    case "discussion":
      return "shared-team-chat-v1";
    case "analysis":
    case "debate":
    case "coding":
    case "research":
    default:
      return "broadcast-team-v1";
  }
}
