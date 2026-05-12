import type { SchedulerJobStatus } from "@spaceskit/persistence";
import type {
  SchedulerCalendarBindingPayload,
  SchedulerJobRunPayload,
  SchedulerListJobsPayload,
} from "@spaceskit/server";
import { SchedulerServiceError } from "./scheduler-errors.js";

export function normalizeNonEmpty(value: string | undefined | null, field: string): string {
  const normalized = value?.trim();
  if (!normalized) {
    throw new SchedulerServiceError("INVALID_ARGUMENT", `${field} is required`);
  }
  return normalized;
}

export function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

export function normalizeNullableSpaceId(value: string | null): string | null {
  if (value === null) return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

export function normalizeSpaceIds(spaceIds: string[]): string[] {
  return Array.from(
    new Set(
      spaceIds
        .map((spaceId) => spaceId.trim())
        .filter((spaceId) => spaceId.length > 0),
    ),
  );
}

export function normalizeLimit(limit: number | undefined, fallback: number): number {
  if (typeof limit !== "number" || !Number.isFinite(limit)) return fallback;
  return Math.min(Math.max(Math.floor(limit), 1), 500);
}

export function normalizeOffset(offset: number | undefined): number {
  if (typeof offset !== "number" || !Number.isFinite(offset)) return 0;
  return Math.max(0, Math.floor(offset));
}

export function normalizeStatuses(statuses: SchedulerListJobsPayload["statuses"]): SchedulerJobStatus[] | undefined {
  if (!Array.isArray(statuses) || statuses.length === 0) return undefined;
  const normalized = statuses.map((status) => normalizeStatus(status));
  return normalized.length > 0 ? Array.from(new Set(normalized)) : undefined;
}

export function normalizeStatus(status: unknown): SchedulerJobStatus {
  if (status === "active" || status === "paused" || status === "invalid") return status;
  throw new SchedulerServiceError("INVALID_ARGUMENT", `Unsupported scheduler status: ${String(status)}`);
}

export function normalizeRunStatus(status: unknown): SchedulerJobRunPayload["status"] | undefined {
  if (status === "running" || status === "completed" || status === "failed" || status === "skipped") {
    return status;
  }
  return undefined;
}

export function parseInteger(value: unknown, field: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw new SchedulerServiceError(
      "INVALID_ARGUMENT",
      `${field} must be an integer between ${min} and ${max}`,
    );
  }
  return value;
}

export function parseResultJson(raw: string | null): Record<string, unknown> | undefined {
  return parseJsonRecord(raw) ?? undefined;
}

export function parseJsonRecord(raw: string | null | undefined): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // ignore malformed json payloads
  }
  return null;
}

export function normalizeCalendarSyncStatus(
  value: unknown,
): SchedulerCalendarBindingPayload["syncStatus"] | undefined {
  return value === "pending" || value === "synced" || value === "error" ? value : undefined;
}

export function normalizeCalendarDriftStatus(
  value: unknown,
): SchedulerCalendarBindingPayload["driftStatus"] | undefined {
  return value === "none" || value === "drifted" ? value : undefined;
}
