import type {
  SchedulerJobRepository,
  SchedulerJobRow,
  SpaceRepository,
} from "@spaceskit/persistence";
import { computeNextRun } from "./scheduler-cron.js";

export function ensurePrimarySpaceState(input: {
  job: SchedulerJobRow;
  jobs: SchedulerJobRepository;
  spaces: SpaceRepository;
}): boolean {
  const primarySpaceId = input.job.primary_space_id?.trim() || "";
  if (!primarySpaceId) {
    input.jobs.update(input.job.job_id, {
      status: "invalid",
      enabled: false,
      invalidReason: "primary_space_missing",
      nextRunAt: null,
      lastErrorCode: "PRIMARY_SPACE_MISSING",
      lastErrorMessage: "Primary execution space is missing.",
    });
    return true;
  }

  if (!input.spaces.getById(primarySpaceId)) {
    input.jobs.update(input.job.job_id, {
      primarySpaceId: null,
      status: "invalid",
      enabled: false,
      invalidReason: "primary_space_missing",
      nextRunAt: null,
      lastErrorCode: "PRIMARY_SPACE_MISSING",
      lastErrorMessage: "Primary execution space was deleted.",
    });
    return true;
  }

  return false;
}

export function computeNextRunFromJob(job: SchedulerJobRow, referenceIso: string): string | null {
  return computeNextRun(job.cron_expression, job.timezone, referenceIso);
}
