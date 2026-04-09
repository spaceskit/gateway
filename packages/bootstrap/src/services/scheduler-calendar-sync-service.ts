import type { Logger } from "@spaceskit/observability";
import type { CapabilityRegistry, CapabilityPolicyContext } from "@spaceskit/core";
import type {
  SchedulerJobRepository,
  SchedulerJobRow,
} from "@spaceskit/persistence";
import type {
  SchedulerJobPayload,
  SchedulerSchedulePresetPayload,
} from "@spaceskit/server";
import type {
  SchedulerCalendarBindingPayload,
  SchedulerExecutionTargetPayload,
} from "./internal-payload-types.js";

const MIRROR_NOTE_HEADER = "Spaces Scheduler Mirror";
const DEFAULT_EVENT_DURATION_MS = 30 * 60 * 1000;

interface CalendarRecurrenceRecord {
  frequency: "daily" | "weekly";
  interval?: number;
  daysOfWeek?: number[];
}

interface CalendarEventRecord {
  id: string;
  calendarId: string;
  title: string;
  startAt?: string;
  endAt?: string;
  notes?: string;
  attendeeCount?: number;
  detachedOccurrenceCount?: number;
  recurrence?: CalendarRecurrenceRecord;
}

interface SchedulerJobProjection {
  row: SchedulerJobRow;
  executionTarget: SchedulerExecutionTargetPayload;
  calendarBinding: SchedulerCalendarBindingPayload | null;
  schedulePreset: SchedulerSchedulePresetPayload;
}

type SchedulerCalendarJobPayload = SchedulerJobPayload & {
  executionTarget: SchedulerExecutionTargetPayload;
  calendarBinding?: SchedulerCalendarBindingPayload | null;
};

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

function projectRow(row: SchedulerJobRow): SchedulerJobProjection {
  return {
    row,
    executionTarget: parseExecutionTarget(row.execution_target_json),
    calendarBinding: parseCalendarBinding(row.calendar_binding_json),
    schedulePreset: parseSchedulePreset(row.schedule_preset_json),
  };
}

function buildMirroredEvent(
  job: SchedulerCalendarJobPayload,
  referenceIso: string,
): { ok: true; payload: Record<string, unknown> } | { ok: false; message: string } {
  if (job.schedulePreset.kind === "hourly") {
    return {
      ok: false,
      message: "Apple Calendar mirroring does not support hourly scheduler recurrence.",
    };
  }

  const startAt = normalizeOptionalString(job.nextRunAt) ?? referenceIso;
  const start = new Date(startAt);
  if (Number.isNaN(start.getTime())) {
    return { ok: false, message: "Scheduler next_run_at is invalid for calendar mirroring." };
  }

  return {
    ok: true,
    payload: {
      title: job.name,
      startAt: start.toISOString(),
      endAt: new Date(start.getTime() + DEFAULT_EVENT_DURATION_MS).toISOString(),
      notes: buildMirrorNotes(job),
      recurrence: buildExpectedRecurrence(job.schedulePreset),
    },
  };
}

function assessEventAgainstJob(
  projection: SchedulerJobProjection,
  event: CalendarEventRecord,
):
  | { kind: "no_change" }
  | { kind: "update_job"; name: string; schedulePreset: SchedulerSchedulePresetPayload }
  | { kind: "drift"; message: string } {
  const binding = projection.calendarBinding;
  if (!binding) {
    return { kind: "drift", message: "Scheduler job lost its calendar binding." };
  }

  const expectedNotes = buildMirrorNotes({
    jobId: projection.row.job_id,
    name: projection.row.name,
    schedulePreset: projection.schedulePreset,
    timezone: projection.row.timezone,
    primarySpaceId: projection.row.primary_space_id ?? undefined,
    createdByPrincipalId: projection.row.created_by_principal_id,
    executionTarget: projection.executionTarget,
  } as SchedulerCalendarJobPayload);
  if ((event.notes ?? "").trim() != expectedNotes.trim()) {
    return { kind: "drift", message: "Calendar notes/body changed outside supported scheduler fields." };
  }
  if ((event.attendeeCount ?? 0) > 0) {
    return { kind: "drift", message: "Calendar attendees are unsupported for scheduler mirrors." };
  }
  if ((event.detachedOccurrenceCount ?? 0) > 0) {
    return { kind: "drift", message: "Detached recurring event edits are unsupported for scheduler mirrors." };
  }

  const expectedRecurrence = buildExpectedRecurrence(projection.schedulePreset);
  if (!sameRecurrence(expectedRecurrence, event.recurrence)) {
    return { kind: "drift", message: "Calendar recurrence changed outside supported scheduler fields." };
  }

  const eventParts = getZonedParts(new Date(normalizeNonEmpty(event.startAt, "event.startAt")), projection.row.timezone);
  const expectedParts = schedulePartsFromPreset(projection.schedulePreset);
  const eventDays = event.recurrence?.daysOfWeek?.slice().sort((lhs, rhs) => lhs - rhs)
    ?? [eventParts.dayOfWeek];
  const expectedDays = expectedParts.daysOfWeek?.slice().sort((lhs, rhs) => lhs - rhs);
  const title = normalizeOptionalString(event.title) ?? projection.row.name;

  const nameChanged = title !== projection.row.name;
  const timeChanged = expectedParts.hour !== eventParts.hour || expectedParts.minute !== eventParts.minute;
  const weekdayChanged = projection.schedulePreset.kind === "weekly"
    && JSON.stringify(eventDays) !== JSON.stringify(expectedDays);

  if (!nameChanged && !timeChanged && !weekdayChanged && event.calendarId === binding.calendarId) {
    return { kind: "no_change" };
  }

  return {
    kind: "update_job",
    name: title,
    schedulePreset: applyEventTimeToPreset(projection.schedulePreset, eventParts.hour, eventParts.minute, eventDays),
  };
}

function applyEventTimeToPreset(
  preset: SchedulerSchedulePresetPayload,
  hour: number,
  minute: number,
  daysOfWeek: number[],
): SchedulerSchedulePresetPayload {
  switch (preset.kind) {
    case "daily":
      return {
        kind: "daily",
        hour,
        minute,
      };
    case "weekly":
      return {
        kind: "weekly",
        hour,
        minute,
        daysOfWeek: Array.from(new Set(daysOfWeek)).sort((lhs, rhs) => lhs - rhs),
      };
    case "hourly":
      return preset;
  }
}

function schedulePartsFromPreset(
  preset: SchedulerSchedulePresetPayload,
): { hour: number; minute: number; daysOfWeek?: number[] } {
  switch (preset.kind) {
    case "hourly":
      return { hour: 0, minute: preset.minute };
    case "daily":
      return {
        hour: requireNumber(preset.hour, "schedulePreset.hour"),
        minute: preset.minute,
      };
    case "weekly":
      return {
        hour: requireNumber(preset.hour, "schedulePreset.hour"),
        minute: preset.minute,
        daysOfWeek: Array.from(new Set((preset.daysOfWeek ?? []).slice())).sort((lhs, rhs) => lhs - rhs),
      };
  }
}

function buildMirrorNotes(
  job: Pick<SchedulerCalendarJobPayload, "jobId" | "schedulePreset" | "timezone" | "primarySpaceId" | "executionTarget" | "name">,
): string {
  const metadata: Record<string, unknown> = {
    jobId: job.jobId,
    schedulePreset: job.schedulePreset,
    timezone: job.timezone,
    primarySpaceId: job.primarySpaceId,
    executionTarget: job.executionTarget.mode,
    title: job.name,
  };
  return `${MIRROR_NOTE_HEADER}\n${JSON.stringify(metadata, null, 2)}`;
}

function buildExpectedRecurrence(preset: SchedulerSchedulePresetPayload): CalendarRecurrenceRecord | undefined {
  switch (preset.kind) {
    case "daily":
      return {
        frequency: "daily",
        interval: 1,
      };
    case "weekly":
      return {
        frequency: "weekly",
        interval: 1,
        daysOfWeek: Array.from(new Set((preset.daysOfWeek ?? []).slice())).sort((lhs, rhs) => lhs - rhs),
      };
    case "hourly":
      return undefined;
  }
}

function sameRecurrence(
  expected: CalendarRecurrenceRecord | undefined,
  actual: CalendarRecurrenceRecord | undefined,
): boolean {
  if (!expected && !actual) return true;
  if (!expected || !actual) return false;
  if (expected.frequency !== actual.frequency) return false;
  if ((actual.interval ?? 1) !== (expected.interval ?? 1)) return false;
  const expectedDays = expected.daysOfWeek ?? [];
  const actualDays = actual.daysOfWeek ?? [];
  return JSON.stringify(expectedDays) === JSON.stringify(actualDays);
}

function extractCalendarEvent(data: unknown): CalendarEventRecord | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return null;
  }
  const record = data as Record<string, unknown>;
  const event = record.event;
  if (!event || typeof event !== "object" || Array.isArray(event)) {
    return null;
  }
  const eventRecord = event as Record<string, unknown>;
  const id = normalizeOptionalString(eventRecord.id);
  const calendarId = normalizeOptionalString(eventRecord.calendarId);
  const title = normalizeOptionalString(eventRecord.title);
  if (!id || !calendarId || !title) {
    return null;
  }
  return {
    id,
    calendarId,
    title,
    startAt: normalizeOptionalString(eventRecord.startAt),
    endAt: normalizeOptionalString(eventRecord.endAt),
    notes: normalizeOptionalString(eventRecord.notes),
    attendeeCount: normalizeOptionalNumber(eventRecord.attendeeCount),
    detachedOccurrenceCount: normalizeOptionalNumber(eventRecord.detachedOccurrenceCount),
    recurrence: parseRecurrence(eventRecord.recurrence),
  };
}

function parseRecurrence(value: unknown): CalendarRecurrenceRecord | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const frequency = normalizeOptionalString(record.frequency);
  if (frequency !== "daily" && frequency !== "weekly") return undefined;
  return {
    frequency,
    interval: normalizeOptionalNumber(record.interval),
    daysOfWeek: Array.isArray(record.daysOfWeek)
      ? record.daysOfWeek
        .map((entry) => normalizeOptionalNumber(entry))
        .filter((entry): entry is number => entry !== undefined)
        .sort((lhs, rhs) => lhs - rhs)
      : undefined,
  };
}

function parseExecutionTarget(raw: string | null | undefined): SchedulerExecutionTargetPayload {
  if (!raw) return { mode: "existing_space" };
  try {
    const parsed = JSON.parse(raw) as SchedulerExecutionTargetPayload;
    return parsed?.mode === "new_space" ? { mode: "new_space" } : { mode: "existing_space" };
  } catch {
    return { mode: "existing_space" };
  }
}

function parseCalendarBinding(raw: string | null | undefined): SchedulerCalendarBindingPayload | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as SchedulerCalendarBindingPayload;
    const providerId = normalizeOptionalString(parsed.providerId);
    const calendarId = normalizeOptionalString(parsed.calendarId);
    if (!providerId || !calendarId) return null;
    return {
      providerId,
      calendarId,
      eventId: normalizeOptionalString(parsed.eventId),
      syncStatus: normalizeCalendarSyncStatus(parsed.syncStatus) ?? "pending",
      driftStatus: normalizeCalendarDriftStatus(parsed.driftStatus) ?? "none",
      driftMessage: normalizeOptionalString(parsed.driftMessage),
      lastSyncedAt: normalizeOptionalString(parsed.lastSyncedAt),
    };
  } catch {
    return null;
  }
}

function parseSchedulePreset(raw: string): SchedulerSchedulePresetPayload {
  const parsed = JSON.parse(raw) as SchedulerSchedulePresetPayload;
  switch (parsed.kind) {
    case "hourly":
      return {
        kind: "hourly",
        minute: requireNumber(parsed.minute, "schedulePreset.minute"),
        intervalHours: parsed.intervalHours,
      };
    case "daily":
      return {
        kind: "daily",
        minute: requireNumber(parsed.minute, "schedulePreset.minute"),
        hour: requireNumber(parsed.hour, "schedulePreset.hour"),
      };
    case "weekly":
      return {
        kind: "weekly",
        minute: requireNumber(parsed.minute, "schedulePreset.minute"),
        hour: requireNumber(parsed.hour, "schedulePreset.hour"),
        daysOfWeek: Array.from(new Set((parsed.daysOfWeek ?? []).slice())).sort((lhs, rhs) => lhs - rhs),
      };
    default:
      throw new Error("Unsupported scheduler preset JSON");
  }
}

function compilePresetToCron(preset: SchedulerSchedulePresetPayload): string {
  switch (preset.kind) {
    case "hourly": {
      const intervalHours = requireNumber(preset.intervalHours ?? 1, "schedulePreset.intervalHours");
      return `${preset.minute} */${intervalHours} * * *`;
    }
    case "daily":
      return `${preset.minute} ${requireNumber(preset.hour, "schedulePreset.hour")} * * *`;
    case "weekly":
      return `${preset.minute} ${requireNumber(preset.hour, "schedulePreset.hour")} * * ${Array.from(new Set((preset.daysOfWeek ?? []).slice())).join(",")}`;
  }
}

function computeNextRun(cronExpression: string, timezone: string, referenceIso: string): string | null {
  const matcher = parseCronExpression(cronExpression);
  const reference = new Date(referenceIso);
  if (Number.isNaN(reference.getTime())) {
    throw new Error(`Invalid reference time: ${referenceIso}`);
  }

  const cursor = new Date(reference.getTime());
  cursor.setUTCSeconds(0, 0);
  cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);

  const maxIterations = 2 * 366 * 24 * 60;
  for (let index = 0; index < maxIterations; index += 1) {
    const parts = getZonedParts(cursor, timezone);
    if (
      matcher.minute.matches(parts.minute)
      && matcher.hour.matches(parts.hour)
      && matcher.dayOfMonth.matches(parts.day)
      && matcher.month.matches(parts.month)
      && matcher.dayOfWeek.matches(parts.dayOfWeek)
    ) {
      return cursor.toISOString();
    }
    cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);
  }

  return null;
}

interface CronMatcher {
  minute: FieldMatcher;
  hour: FieldMatcher;
  dayOfMonth: FieldMatcher;
  month: FieldMatcher;
  dayOfWeek: FieldMatcher;
}

interface FieldMatcher {
  matches: (value: number) => boolean;
}

interface ZonedParts {
  month: number;
  day: number;
  hour: number;
  minute: number;
  dayOfWeek: number;
}

const dayOfWeekByName: Record<string, number> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function parseCronExpression(expression: string): CronMatcher {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new Error(`Invalid cron expression: ${expression}`);
  }
  return {
    minute: parseField(fields[0], 0, 59),
    hour: parseField(fields[1], 0, 23),
    dayOfMonth: parseField(fields[2], 1, 31),
    month: parseField(fields[3], 1, 12),
    dayOfWeek: parseField(fields[4], 0, 6),
  };
}

function parseField(token: string, min: number, max: number): FieldMatcher {
  const trimmed = token.trim();
  if (trimmed === "*") {
    return { matches: () => true };
  }
  if (trimmed.startsWith("*/")) {
    const step = Number.parseInt(trimmed.slice(2), 10);
    if (!Number.isInteger(step) || step <= 0) {
      throw new Error(`Invalid cron step value: ${token}`);
    }
    return { matches: (value) => (value - min) % step === 0 };
  }

  const values = new Set<number>();
  for (const part of trimmed.split(",")) {
    const piece = part.trim();
    if (!piece) continue;
    const value = Number.parseInt(piece, 10);
    if (!Number.isInteger(value) || value < min || value > max) {
      throw new Error(`Invalid cron field value: ${piece}`);
    }
    values.add(value);
  }
  return { matches: (value) => values.has(value) };
}

function getZonedParts(date: Date, timezone: string): ZonedParts {
  const formatter = getFormatter(timezone);
  const parts = formatter.formatToParts(date);

  let month = 0;
  let day = 0;
  let hour = 0;
  let minute = 0;
  let weekdayShort = "";

  for (const part of parts) {
    switch (part.type) {
      case "month":
        month = Number.parseInt(part.value, 10);
        break;
      case "day":
        day = Number.parseInt(part.value, 10);
        break;
      case "hour":
        hour = Number.parseInt(part.value, 10);
        break;
      case "minute":
        minute = Number.parseInt(part.value, 10);
        break;
      case "weekday":
        weekdayShort = part.value.slice(0, 3).toLowerCase();
        break;
      default:
        break;
    }
  }

  return {
    month,
    day,
    hour,
    minute,
    dayOfWeek: dayOfWeekByName[weekdayShort] ?? 0,
  };
}

function getFormatter(timezone: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(timezone);
  if (cached) return cached;
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  formatterCache.set(timezone, formatter);
  return formatter;
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length === 0 ? undefined : normalized;
}

function normalizeOptionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizeCalendarSyncStatus(value: unknown): SchedulerCalendarBindingPayload["syncStatus"] | null {
  if (value === "pending" || value === "synced" || value === "error") {
    return value;
  }
  return null;
}

function normalizeCalendarDriftStatus(value: unknown): SchedulerCalendarBindingPayload["driftStatus"] | null {
  if (value === "none" || value === "drifted") {
    return value;
  }
  return null;
}

function requireNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error(`${field} is required`);
  }
  return value;
}

function normalizeNonEmpty(value: string | undefined, field: string): string {
  const normalized = normalizeOptionalString(value);
  if (!normalized) {
    throw new Error(`${field} is required`);
  }
  return normalized;
}
