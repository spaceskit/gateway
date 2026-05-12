import type {
  OrchestrationJournalRepository,
  SchedulerJobRow,
  SchedulerJobRunRow,
} from "@spaceskit/persistence";
import type {
  SchedulerEvalCheckpointPayload,
  SchedulerEvalConfigPayload,
  SchedulerEvalRunPayload,
  SchedulerEvalSelfImproveStatePayload,
} from "@spaceskit/server";
import {
  applyRecommendations,
  eventToEvalCheckpoint,
  generateEvalRecommendations,
} from "./scheduler-eval-results.js";
import {
  normalizeOptionalString,
  parseResultJson,
} from "./scheduler-normalizers.js";

export function buildSchedulerEvalRun(input: {
  job: SchedulerJobRow;
  run: SchedulerJobRunRow;
  evalConfig: SchedulerEvalConfigPayload;
  selfImproveState: SchedulerEvalSelfImproveStatePayload | null;
  executionSpace: { spaceId: string; spaceUid?: string; name?: string };
  rootTurnId?: string;
  observedEvents: Array<Record<string, unknown>>;
  orchestrationJournal: Pick<OrchestrationJournalRepository, "list"> | null;
}): SchedulerEvalRunPayload {
  const journalCheckpoints = input.orchestrationJournal && input.rootTurnId
    ? input.orchestrationJournal.list({
      spaceId: input.executionSpace.spaceId,
      turnId: input.rootTurnId,
      limit: 500,
      offset: 0,
    }).map((row) => ({
      checkpointId: row.event_id,
      kind: row.event_type,
      status: "completed" as const,
      actorId: normalizeOptionalString(row.actor_id),
      createdAt: row.created_at,
      detail: parseResultJson(row.payload_json),
    }))
    : [];
  const observedCheckpoints = input.observedEvents
    .map((event, index) => eventToEvalCheckpoint(event, index))
    .filter((checkpoint): checkpoint is SchedulerEvalCheckpointPayload => checkpoint !== null);
  const checkpoints = [...journalCheckpoints, ...observedCheckpoints]
    .sort((lhs, rhs) => lhs.createdAt.localeCompare(rhs.createdAt));

  const summaryEvent = input.observedEvents.find((event) =>
    (event as { observedType?: string }).observedType === "space.orchestrator_event"
    && (event as { turnId?: string }).turnId === input.rootTurnId
    && (event as { eventType?: string }).eventType === "summary.completed",
  ) as { event?: { summary?: { finalSummaryText?: string } } } | undefined;
  const finalSummaryText = normalizeOptionalString(summaryEvent?.event?.summary?.finalSummaryText);
  const recommendations = generateEvalRecommendations(input.evalConfig, checkpoints, input.run.run_id);
  const appliedRecommendations = input.evalConfig.selfImproveEnabled
    ? applyRecommendations(recommendations, input.selfImproveState, input.run.run_id)
    : recommendations;

  return {
    evalRunId: input.run.run_id,
    evalDefinitionId: input.evalConfig.evalDefinitionId,
    scenarioIds: input.evalConfig.scenarioIds ?? [],
    promptVariantId: input.evalConfig.promptVariantId,
    promptPackId: input.evalConfig.promptPackId,
    flowVariantId: input.evalConfig.flowVariantId,
    summaryMode: input.evalConfig.summaryMode ?? "checkpoints",
    selfImproveEnabled: input.evalConfig.selfImproveEnabled ?? false,
    spaceId: input.executionSpace.spaceId,
    spaceUid: input.executionSpace.spaceUid,
    rootTurnId: input.rootTurnId,
    finalSummaryText,
    artifactRefs: [
      {
        kind: "space",
        id: input.executionSpace.spaceId,
        label: input.executionSpace.name,
      },
      ...(input.rootTurnId
        ? [{
          kind: "turn" as const,
          id: input.rootTurnId,
          label: "Root Turn",
        }]
        : []),
      {
        kind: "scheduler_run",
        id: input.run.run_id,
        label: input.job.job_id,
      },
    ],
    checkpoints,
    scenarioResults: (input.evalConfig.scenarioIds ?? []).map((scenarioId) => ({
      scenarioId,
      status: checkpoints.some((checkpoint) => checkpoint.status === "failed") ? "fail" : "pass",
      checkpointCount: checkpoints.length,
    })),
    recommendations: appliedRecommendations,
  };
}
