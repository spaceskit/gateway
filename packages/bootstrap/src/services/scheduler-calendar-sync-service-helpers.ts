import type { SchedulerJobRow } from "@spaceskit/persistence";
import type { SchedulerJobPayload, SchedulerSchedulePresetPayload } from "@spaceskit/server";
import type {
  SchedulerCalendarBindingPayload,
  SchedulerExecutionTargetPayload,
} from "./internal-payload-types.js";
import { getZonedParts } from "./scheduler-cron.js";

const MIRROR_NOTE_HEADER = "Spaces Scheduler Mirror";
const DEFAULT_EVENT_DURATION_MS = 30 * 60 * 1000;

export interface CalendarRecurrenceRecord {
  frequency: "daily" | "weekly";
  interval?: number;
  daysOfWeek?: number[];
}

export interface CalendarEventRecord {
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

export interface SchedulerJobProjection {
  row: SchedulerJobRow;
  executionTarget: SchedulerExecutionTargetPayload;
  calendarBinding: SchedulerCalendarBindingPayload | null;
  schedulePreset: SchedulerSchedulePresetPayload;
}

export type SchedulerCalendarJobPayload = SchedulerJobPayload & {
  executionTarget: SchedulerExecutionTargetPayload;
  calendarBinding?: SchedulerCalendarBindingPayload | null;
};

export function projectRow(row: SchedulerJobRow): SchedulerJobProjection {
  return {
    row,
    executionTarget: parseExecutionTarget(row.execution_target_json),
    calendarBinding: parseCalendarBinding(row.calendar_binding_json),
    schedulePreset: parseSchedulePreset(row.schedule_preset_json),
  };
}

export function buildMirroredEvent(
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

export function assessEventAgainstJob(
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

export function applyEventTimeToPreset(
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

export function schedulePartsFromPreset(
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

export function buildMirrorNotes(
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

export function buildExpectedRecurrence(preset: SchedulerSchedulePresetPayload): CalendarRecurrenceRecord | undefined {
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

export function sameRecurrence(
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

export function extractCalendarEvent(data: unknown): CalendarEventRecord | null {
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

export function parseRecurrence(value: unknown): CalendarRecurrenceRecord | undefined {
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

export function parseExecutionTarget(raw: string | null | undefined): SchedulerExecutionTargetPayload {
  if (!raw) return { mode: "existing_space" };
  try {
    const parsed = JSON.parse(raw) as SchedulerExecutionTargetPayload;
    return parsed?.mode === "new_space" ? { mode: "new_space" } : { mode: "existing_space" };
  } catch {
    return { mode: "existing_space" };
  }
}

export function parseCalendarBinding(raw: string | null | undefined): SchedulerCalendarBindingPayload | null {
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

export function parseSchedulePreset(raw: string): SchedulerSchedulePresetPayload {
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

export function compilePresetToCron(preset: SchedulerSchedulePresetPayload): string {
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

export function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length === 0 ? undefined : normalized;
}

export function normalizeOptionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function normalizeCalendarSyncStatus(value: unknown): SchedulerCalendarBindingPayload["syncStatus"] | null {
  if (value === "pending" || value === "synced" || value === "error") {
    return value;
  }
  return null;
}

export function normalizeCalendarDriftStatus(value: unknown): SchedulerCalendarBindingPayload["driftStatus"] | null {
  if (value === "none" || value === "drifted") {
    return value;
  }
  return null;
}

export function requireNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error(`${field} is required`);
  }
  return value;
}

export function normalizeNonEmpty(value: string | undefined, field: string): string {
  const normalized = normalizeOptionalString(value);
  if (!normalized) {
    throw new Error(`${field} is required`);
  }
  return normalized;
}
