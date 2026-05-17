import type { Logger } from "@spaceskit/observability";
import type { CapabilityRegistry, CapabilityPolicyContext } from "@spaceskit/core";
import type {
  SchedulerJobRepository,
  SchedulerJobRow,
} from "@spaceskit/persistence";
import type {
  SchedulerCalendarBindingPayload,
} from "./internal-payload-types.js";
import { computeNextRun } from "./scheduler-cron.js";
import {
  assessEventAgainstJob,
  buildMirroredEvent,
  compilePresetToCron,
  extractCalendarEvent,
  normalizeOptionalString,
  projectRow,
} from "./scheduler-calendar-sync-service-helpers.js";
import type {
  CalendarEventRecord,
  SchedulerCalendarJobPayload,
} from "./scheduler-calendar-sync-service-helpers.js";

export interface SchedulerCalendarSyncServiceOptions {
  capabilities: CapabilityRegistry;
  jobs: SchedulerJobRepository;
  logger?: Logger;
  now?: () => Date;
}

export class SchedulerCalendarSyncService {
  private readonly now: () => Date;
  private readonly logger: Logger | null;

  constructor(private readonly options: SchedulerCalendarSyncServiceOptions) {
    this.now = options.now ?? (() => new Date());
    this.logger = options.logger ?? null;
  }

  async syncJob(job: SchedulerCalendarJobPayload, context: { principalId?: string } = {}): Promise<void> {
    if (!job.calendarBinding) return;
    const supported = buildMirroredEvent(job, this.now().toISOString());
    if (!supported.ok) {
      this.persistBinding(job.jobId, {
        ...job.calendarBinding,
        syncStatus: "error",
        driftStatus: "none",
        driftMessage: supported.message,
      });
      return;
    }

    try {
      const data = job.calendarBinding.eventId
        ? await this.invokeCalendar(job, "updateEvent", {
          eventId: job.calendarBinding.eventId,
          calendarId: job.calendarBinding.calendarId,
          ...supported.payload,
        }, context.principalId)
        : await this.invokeCalendar(job, "createEvent", {
          calendarId: job.calendarBinding.calendarId,
          ...supported.payload,
        }, context.principalId);

      const event = extractCalendarEvent(data);
      this.persistBinding(job.jobId, {
        providerId: job.calendarBinding.providerId,
        calendarId: normalizeOptionalString(event?.calendarId) ?? job.calendarBinding.calendarId,
        eventId: normalizeOptionalString(event?.id) ?? job.calendarBinding.eventId,
        syncStatus: "synced",
        driftStatus: "none",
        driftMessage: undefined,
        lastSyncedAt: this.now().toISOString(),
      });
    } catch (error) {
      this.persistBinding(job.jobId, {
        ...job.calendarBinding,
        syncStatus: "error",
        driftStatus: job.calendarBinding.driftStatus ?? "none",
        driftMessage: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async deleteJob(job: SchedulerCalendarJobPayload, context: { principalId?: string } = {}): Promise<void> {
    const binding = job.calendarBinding;
    if (!binding?.eventId) return;
    try {
      await this.invokeCalendar(job, "deleteEvent", {
        eventId: binding.eventId,
        calendarId: binding.calendarId,
      }, context.principalId);
    } catch (error) {
      this.logger?.warn("Failed deleting calendar mirror for scheduler job", {
        jobId: job.jobId,
        eventId: binding.eventId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async reconcileAllJobs(limit = 500): Promise<void> {
    const rows = this.options.jobs.list({ limit });
    for (const row of rows) {
      try {
        await this.reconcileJob(row);
      } catch (error) {
        this.logger?.warn("Scheduler calendar reconciliation failed", {
          jobId: row.job_id,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  private async reconcileJob(row: SchedulerJobRow): Promise<void> {
    const projection = projectRow(row);
    const binding = projection.calendarBinding;
    if (!binding?.eventId) return;

    let event: CalendarEventRecord | null = null;
    try {
      const data = await this.options.capabilities.invoke({
        capability: "calendar",
        operation: "getEvent",
        targetProvider: binding.providerId,
        args: {
          calendarId: binding.calendarId,
          eventId: binding.eventId,
        },
      }, {
        spaceId: row.primary_space_id ?? undefined,
        principalId: row.created_by_principal_id || undefined,
        executionOrigin: "system",
      });
      event = extractCalendarEvent((data as { data?: unknown }).data ?? data);
    } catch (error) {
      this.persistBinding(row.job_id, {
        ...binding,
        syncStatus: "error",
        driftStatus: "drifted",
        driftMessage: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    if (!event) {
      this.persistBinding(row.job_id, {
        ...binding,
        syncStatus: "error",
        driftStatus: "drifted",
        driftMessage: "Calendar mirror is missing or unreadable.",
      });
      return;
    }

    const assessment = assessEventAgainstJob(projection, event);
    if (assessment.kind === "drift") {
      this.persistBinding(row.job_id, {
        ...binding,
        syncStatus: "synced",
        driftStatus: "drifted",
        driftMessage: assessment.message,
      });
      return;
    }

    if (assessment.kind === "update_job") {
      const nextBinding: SchedulerCalendarBindingPayload = {
        ...binding,
        calendarId: normalizeOptionalString(event.calendarId) ?? binding.calendarId,
        eventId: normalizeOptionalString(event.id) ?? binding.eventId,
        syncStatus: "synced",
        driftStatus: "none",
        driftMessage: undefined,
        lastSyncedAt: this.now().toISOString(),
      };
      this.options.jobs.update(row.job_id, {
        name: assessment.name,
        schedulePresetJson: JSON.stringify(assessment.schedulePreset),
        cronExpression: compilePresetToCron(assessment.schedulePreset),
        nextRunAt: computeNextRun(
          compilePresetToCron(assessment.schedulePreset),
          row.timezone,
          this.now().toISOString(),
        ),
        calendarBindingJson: JSON.stringify(nextBinding),
      });
      return;
    }

    this.persistBinding(row.job_id, {
      ...binding,
      calendarId: normalizeOptionalString(event.calendarId) ?? binding.calendarId,
      eventId: normalizeOptionalString(event.id) ?? binding.eventId,
      syncStatus: "synced",
      driftStatus: "none",
      driftMessage: undefined,
      lastSyncedAt: this.now().toISOString(),
    });
  }

  private async invokeCalendar(
    job: SchedulerCalendarJobPayload,
    operation: "createEvent" | "updateEvent" | "deleteEvent",
    args: Record<string, unknown>,
    principalId?: string,
  ): Promise<unknown> {
    const result = await this.options.capabilities.invoke({
      capability: "calendar",
      operation,
      targetProvider: job.calendarBinding?.providerId,
      args,
    }, {
      spaceId: job.primarySpaceId,
      principalId: principalId ?? job.createdByPrincipalId,
      executionOrigin: "system",
    } satisfies CapabilityPolicyContext);
    return (result as { data?: unknown }).data ?? result;
  }

  private persistBinding(jobId: string, binding: SchedulerCalendarBindingPayload): void {
    this.options.jobs.update(jobId, {
      calendarBindingJson: JSON.stringify(binding),
    });
  }
}
