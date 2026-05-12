import type { SchedulerJobRow, SchedulerJobRunRow } from "@spaceskit/persistence";
import type {
  SchedulerActionPayload,
  SchedulerCalendarBindingPayload,
  SchedulerEvalArtifactRefPayload,
  SchedulerEvalCheckpointPayload,
  SchedulerEvalConfigPayload,
  SchedulerEvalRecommendationPayload,
  SchedulerEvalRunPayload,
  SchedulerEvalScenarioResultPayload,
  SchedulerEvalSelfImproveStatePayload,
  SchedulerExecutionTargetPayload,
  SchedulerJobRunPayload,
  SchedulerSchedulePresetPayload,
} from "@spaceskit/server";
import type { SchedulerEvalCatalogService } from "./scheduler-eval-catalog-service.js";
import { buildEvalSelfImproveState } from "./scheduler-eval-results.js";
import { SchedulerServiceError } from "./scheduler-errors.js";
import {
  normalizeCalendarDriftStatus,
  normalizeCalendarSyncStatus,
  normalizeNonEmpty,
  normalizeOptionalString,
  normalizeSpaceIds,
  parseInteger,
  parseJsonRecord,
  parseResultJson,
} from "./scheduler-normalizers.js";

export function validateTimezone(timezone: string | undefined): string {
  const normalized = normalizeNonEmpty(timezone, "timezone");
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: normalized }).format(new Date());
    return normalized;
  } catch {
    throw new SchedulerServiceError("INVALID_ARGUMENT", `Invalid timezone: ${normalized}`);
  }
}

export function validateSchedulePreset(
  preset: SchedulerSchedulePresetPayload | undefined,
): SchedulerSchedulePresetPayload {
  if (!preset) {
    throw new SchedulerServiceError("INVALID_ARGUMENT", "schedulePreset is required");
  }

  const minute = parseInteger(preset.minute, "schedulePreset.minute", 0, 59);
  switch (preset.kind) {
    case "hourly": {
      const intervalHours = parseInteger(
        preset.intervalHours ?? 1,
        "schedulePreset.intervalHours",
        1,
        23,
      );
      return {
        kind: "hourly",
        minute,
        intervalHours,
      };
    }

    case "daily": {
      const hour = parseInteger(preset.hour, "schedulePreset.hour", 0, 23);
      return {
        kind: "daily",
        minute,
        hour,
      };
    }

    case "weekly": {
      const hour = parseInteger(preset.hour, "schedulePreset.hour", 0, 23);
      const days = Array.isArray(preset.daysOfWeek)
        ? Array.from(
          new Set(
            preset.daysOfWeek.map((value) => parseInteger(value, "schedulePreset.daysOfWeek", 0, 6)),
          ),
        ).sort((a, b) => a - b)
        : [];
      if (days.length === 0) {
        throw new SchedulerServiceError("INVALID_ARGUMENT", "schedulePreset.daysOfWeek is required for weekly jobs");
      }
      return {
        kind: "weekly",
        minute,
        hour,
        daysOfWeek: days,
      };
    }

    default:
      throw new SchedulerServiceError(
        "INVALID_ARGUMENT",
        `Unsupported scheduler preset kind: ${String((preset as { kind?: unknown }).kind)}`,
      );
  }
}

export function validateAction(action: SchedulerActionPayload | undefined): SchedulerActionPayload {
  if (!action || action.type !== "space_prompt") {
    throw new SchedulerServiceError("INVALID_ARGUMENT", "Only action.type=space_prompt is supported");
  }
  const promptText = normalizeNonEmpty(action.promptText, "action.promptText");
  const targetAgentId = normalizeOptionalString(action.targetAgentId);
  return {
    type: "space_prompt",
    promptText,
    targetAgentId,
  };
}

export function validateExecutionTarget(
  executionTarget: SchedulerExecutionTargetPayload | undefined,
): SchedulerExecutionTargetPayload {
  return executionTarget?.mode === "new_space"
    ? { mode: "new_space" }
    : { mode: "existing_space" };
}

export function validateCalendarBinding(
  calendarBinding: SchedulerCalendarBindingPayload | null | undefined,
): SchedulerCalendarBindingPayload | null {
  if (!calendarBinding) return null;
  const providerId = normalizeOptionalString(calendarBinding.providerId);
  const calendarId = normalizeOptionalString(calendarBinding.calendarId);
  if (!providerId || !calendarId) {
    throw new SchedulerServiceError(
      "INVALID_ARGUMENT",
      "calendarBinding.providerId and calendarBinding.calendarId are required",
    );
  }
  return {
    providerId,
    calendarId,
    eventId: normalizeOptionalString(calendarBinding.eventId),
    syncStatus: calendarBinding.syncStatus,
    driftStatus: calendarBinding.driftStatus,
    driftMessage: normalizeOptionalString(calendarBinding.driftMessage),
    lastSyncedAt: normalizeOptionalString(calendarBinding.lastSyncedAt),
  };
}

export async function validateEvalConfig(
  evalConfig: SchedulerEvalConfigPayload | null | undefined,
  evalCatalogService: Pick<SchedulerEvalCatalogService, "getDefinition">,
): Promise<SchedulerEvalConfigPayload | null> {
  if (!evalConfig) return null;
  const evalDefinitionId = normalizeNonEmpty(evalConfig.evalDefinitionId, "evalConfig.evalDefinitionId");
  const definition = await evalCatalogService.getDefinition(evalDefinitionId);
  if (!definition) {
    throw new SchedulerServiceError(
      "INVALID_ARGUMENT",
      `Unknown scheduler eval definition: ${evalDefinitionId}`,
    );
  }
  if (evalConfig.promptVariantId && evalConfig.promptPackId) {
    throw new SchedulerServiceError(
      "INVALID_ARGUMENT",
      "Provide either evalConfig.promptVariantId or evalConfig.promptPackId, not both",
    );
  }
  const scenarioIds = normalizeSpaceIds(evalConfig.scenarioIds ?? []);
  if (scenarioIds.length > 0) {
    for (const scenarioId of scenarioIds) {
      if (!definition.scenarioIds.includes(scenarioId)) {
        throw new SchedulerServiceError(
          "INVALID_ARGUMENT",
          `Scenario ${scenarioId} is not part of ${evalDefinitionId}`,
        );
      }
    }
  }
  return {
    evalDefinitionId,
    scenarioIds,
    promptVariantId: normalizeOptionalString(evalConfig.promptVariantId),
    promptPackId: normalizeOptionalString(evalConfig.promptPackId),
    flowVariantId: normalizeOptionalString(evalConfig.flowVariantId),
    summaryMode: evalConfig.summaryMode === "final_summary" ? "final_summary" : "checkpoints",
    selfImproveEnabled: evalConfig.selfImproveEnabled === true,
  };
}

export function compilePresetToCron(preset: SchedulerSchedulePresetPayload): string {
  switch (preset.kind) {
    case "hourly": {
      const minute = parseInteger(preset.minute, "schedulePreset.minute", 0, 59);
      const intervalHours = parseInteger(preset.intervalHours ?? 1, "schedulePreset.intervalHours", 1, 23);
      const hour = intervalHours === 1 ? "*" : `*/${intervalHours}`;
      return `${minute} ${hour} * * *`;
    }
    case "daily": {
      const minute = parseInteger(preset.minute, "schedulePreset.minute", 0, 59);
      const hour = parseInteger(preset.hour, "schedulePreset.hour", 0, 23);
      return `${minute} ${hour} * * *`;
    }
    case "weekly": {
      const minute = parseInteger(preset.minute, "schedulePreset.minute", 0, 59);
      const hour = parseInteger(preset.hour, "schedulePreset.hour", 0, 23);
      const days = (preset.daysOfWeek ?? [])
        .map((value) => parseInteger(value, "schedulePreset.daysOfWeek", 0, 6))
        .sort((a, b) => a - b);
      if (days.length === 0) {
        throw new SchedulerServiceError("INVALID_ARGUMENT", "schedulePreset.daysOfWeek is required for weekly jobs");
      }
      return `${minute} ${hour} * * ${Array.from(new Set(days)).join(",")}`;
    }
  }
}

export function parseSchedulePreset(raw: string): SchedulerSchedulePresetPayload {
  try {
    const parsed = JSON.parse(raw) as SchedulerSchedulePresetPayload;
    return validateSchedulePreset(parsed);
  } catch {
    throw new SchedulerServiceError("FAILED_PRECONDITION", "Scheduler job has invalid schedule preset JSON");
  }
}

export function parseAction(row: SchedulerJobRow): SchedulerActionPayload {
  return validateAction({
    type: "space_prompt",
    promptText: row.prompt_text,
    targetAgentId: normalizeOptionalString(row.target_agent_id),
  });
}

export function parseExecutionTarget(raw: string | null | undefined): SchedulerExecutionTargetPayload {
  const parsed = parseJsonRecord(raw);
  return parsed?.mode === "new_space" ? { mode: "new_space" } : { mode: "existing_space" };
}

export function parseCalendarBinding(raw: string | null | undefined): SchedulerCalendarBindingPayload | undefined {
  const parsed = parseJsonRecord(raw);
  if (!parsed) return undefined;
  const providerId = normalizeOptionalString(parsed.providerId);
  const calendarId = normalizeOptionalString(parsed.calendarId);
  if (!providerId || !calendarId) return undefined;
  return {
    providerId,
    calendarId,
    eventId: normalizeOptionalString(parsed.eventId),
    syncStatus: normalizeCalendarSyncStatus(parsed.syncStatus),
    driftStatus: normalizeCalendarDriftStatus(parsed.driftStatus),
    driftMessage: normalizeOptionalString(parsed.driftMessage),
    lastSyncedAt: normalizeOptionalString(parsed.lastSyncedAt),
  };
}

export function parseEvalConfig(raw: string | null | undefined): SchedulerEvalConfigPayload | null {
  const parsed = parseJsonRecord(raw);
  const evalDefinitionId = normalizeOptionalString(parsed?.evalDefinitionId);
  if (!evalDefinitionId) return null;
  const scenarioIds = Array.isArray(parsed?.scenarioIds)
    ? parsed.scenarioIds
      .map((value) => normalizeOptionalString(value))
      .filter((value): value is string => Boolean(value))
    : [];
  return {
    evalDefinitionId,
    scenarioIds,
    promptVariantId: normalizeOptionalString(parsed?.promptVariantId),
    promptPackId: normalizeOptionalString(parsed?.promptPackId),
    flowVariantId: normalizeOptionalString(parsed?.flowVariantId),
    summaryMode: parsed?.summaryMode === "final_summary" ? "final_summary" : "checkpoints",
    selfImproveEnabled: parsed?.selfImproveEnabled === true,
  };
}

export function parseEvalSelfImproveState(
  raw: string | null | undefined,
  evalConfig: SchedulerEvalConfigPayload | null,
): SchedulerEvalSelfImproveStatePayload | null {
  const parsed = parseJsonRecord(raw);
  if (!parsed) {
    return evalConfig
      ? buildEvalSelfImproveState(evalConfig)
      : null;
  }
  const appliedRevisionIds = Array.isArray(parsed.appliedRevisionIds)
    ? parsed.appliedRevisionIds
      .map((value) => normalizeOptionalString(value))
      .filter((value): value is string => Boolean(value))
    : [];
  return {
    enabled: parsed.enabled === true || evalConfig?.selfImproveEnabled === true,
    appliedRevisionIds,
    lastAppliedRunId: normalizeOptionalString(parsed.lastAppliedRunId),
  };
}

export function parseEvalRun(raw: string | null | undefined): SchedulerEvalRunPayload | null {
  const parsed = parseJsonRecord(raw);
  const evalRunId = normalizeOptionalString(parsed?.evalRunId);
  const evalDefinitionId = normalizeOptionalString(parsed?.evalDefinitionId);
  if (!parsed || !evalRunId || !evalDefinitionId) return null;
  return {
    evalRunId,
    evalDefinitionId,
    scenarioIds: Array.isArray(parsed.scenarioIds)
      ? parsed.scenarioIds
        .map((value) => normalizeOptionalString(value))
        .filter((value): value is string => Boolean(value))
      : [],
    promptVariantId: normalizeOptionalString(parsed.promptVariantId),
    promptPackId: normalizeOptionalString(parsed.promptPackId),
    flowVariantId: normalizeOptionalString(parsed.flowVariantId),
    summaryMode: parsed.summaryMode === "final_summary" ? "final_summary" : "checkpoints",
    selfImproveEnabled: parsed.selfImproveEnabled === true,
    spaceId: normalizeOptionalString(parsed.spaceId),
    spaceUid: normalizeOptionalString(parsed.spaceUid),
    rootTurnId: normalizeOptionalString(parsed.rootTurnId),
    finalSummaryText: normalizeOptionalString(parsed.finalSummaryText),
    artifactRefs: Array.isArray(parsed.artifactRefs)
      ? parsed.artifactRefs as SchedulerEvalArtifactRefPayload[]
      : [],
    checkpoints: Array.isArray(parsed.checkpoints)
      ? parsed.checkpoints as SchedulerEvalCheckpointPayload[]
      : [],
    scenarioResults: Array.isArray(parsed.scenarioResults)
      ? parsed.scenarioResults as SchedulerEvalScenarioResultPayload[]
      : [],
    recommendations: Array.isArray(parsed.recommendations)
      ? parsed.recommendations as SchedulerEvalRecommendationPayload[]
      : [],
  };
}

export function toRunPayload(row: SchedulerJobRunRow): SchedulerJobRunPayload {
  return {
    runId: row.run_id,
    jobId: row.job_id,
    trigger: row.trigger,
    status: row.status,
    commandId: normalizeOptionalString(row.command_id),
    scheduledFor: row.scheduled_for ?? undefined,
    startedAt: row.started_at ?? undefined,
    finishedAt: row.finished_at ?? undefined,
    skipReason: normalizeOptionalString(row.skip_reason),
    errorCode: normalizeOptionalString(row.error_code),
    errorMessage: normalizeOptionalString(row.error_message),
    result: parseResultJson(row.result_json),
    evalRun: parseEvalRun(row.eval_run_json) ?? undefined,
  };
}
