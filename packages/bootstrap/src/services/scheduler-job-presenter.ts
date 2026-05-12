import { deterministicUuid, normalizeUuid } from "../utils/uuid.js";
import type {
  SchedulerJobRow,
  SchedulerJobSpaceRepository,
} from "@spaceskit/persistence";
import type {
  SchedulerJobPayload,
  SchedulerLinkedSpacePayload,
} from "@spaceskit/server";
import type { SpaceAdminService } from "@spaceskit/core";
import {
  normalizeOptionalString,
  normalizeRunStatus,
  normalizeSpaceIds,
} from "./scheduler-normalizers.js";
import {
  parseAction,
  parseCalendarBinding,
  parseEvalConfig,
  parseEvalSelfImproveState,
  parseExecutionTarget,
  parseSchedulePreset,
} from "./scheduler-payloads.js";

export class SchedulerJobPresenter {
  constructor(
    private readonly options: {
      jobSpaces: SchedulerJobSpaceRepository;
      spaceAdminService: Pick<SpaceAdminService, "getSpace">;
    },
  ) {}

  involvedSpaceIds(job: SchedulerJobRow): string[] {
    const linked = this.options.jobSpaces.listByJob(job.job_id).map((entry) => entry.space_id);
    const all = [
      ...(job.primary_space_id ? [job.primary_space_id] : []),
      ...linked,
    ];
    return normalizeSpaceIds(all);
  }

  async toSchedulerJobPayload(row: SchedulerJobRow): Promise<SchedulerJobPayload> {
    const linkedSpaceRows = this.options.jobSpaces.listByJob(row.job_id);
    const linkedIds = normalizeSpaceIds([
      ...(row.primary_space_id ? [row.primary_space_id] : []),
      ...linkedSpaceRows.map((entry) => entry.space_id),
    ]);

    const linkedSpaces: SchedulerLinkedSpacePayload[] = [];
    const linkedAtBySpaceId = new Map(linkedSpaceRows.map((entry) => [entry.space_id, entry.linked_at]));
    for (const spaceId of linkedIds) {
      const space = await this.options.spaceAdminService.getSpace(spaceId).catch(() => null);
      const fallbackUid = deterministicUuid(spaceId, "spaceskit.space.uuid");
      linkedSpaces.push({
        spaceId,
        spaceUid: normalizeUuid(space?.spaceUid) ?? fallbackUid,
        name: normalizeOptionalString(space?.name) ?? spaceId,
        isPrimary: row.primary_space_id === spaceId,
        linkedAt: row.primary_space_id === spaceId
          ? row.created_at
          : linkedAtBySpaceId.get(spaceId) ?? row.updated_at,
      });
    }

    const schedulePreset = parseSchedulePreset(row.schedule_preset_json);
    const action = parseAction(row);
    const evalConfig = parseEvalConfig(row.eval_config_json);
    const evalSelfImproveState = parseEvalSelfImproveState(row.eval_self_improve_state_json, evalConfig);
    return {
      jobId: row.job_id,
      name: row.name,
      status: row.status,
      enabled: row.enabled === 1,
      cronExpression: row.cron_expression,
      schedulePreset,
      timezone: row.timezone,
      action,
      primarySpaceId: row.primary_space_id ?? undefined,
      invalidReason: normalizeOptionalString(row.invalid_reason),
      nextRunAt: row.next_run_at ?? undefined,
      lastRunAt: row.last_run_at ?? undefined,
      lastRunStatus: normalizeRunStatus(row.last_run_status),
      lastErrorCode: normalizeOptionalString(row.last_error_code),
      lastErrorMessage: normalizeOptionalString(row.last_error_message),
      createdByPrincipalId: row.created_by_principal_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      linkedSpaces,
      executionTarget: parseExecutionTarget(row.execution_target_json),
      calendarBinding: parseCalendarBinding(row.calendar_binding_json),
      evalConfig: evalConfig ?? undefined,
      evalSelfImproveState: evalSelfImproveState ?? undefined,
    };
  }
}
