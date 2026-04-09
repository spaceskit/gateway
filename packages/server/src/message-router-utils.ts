import type { SpaceState } from "@spaceskit/core";
import type { SpeechEventPayload } from "./protocol.js";

const SPACE_STATUSES: SpaceState[] = [
  "created",
  "active",
  "paused",
  "completed",
  "failed",
  "archived",
  "deleted",
];

const ROUTED_ERROR_CODES = new Set([
  "INVALID_ARGUMENT",
  "NOT_FOUND",
  "ALREADY_EXISTS",
  "FAILED_PRECONDITION",
  "PERMISSION_DENIED",
  "RATE_LIMITED",
  "CIRCUIT_OPEN",
]);

export function mapSpeechEventTypeForPayload(
  eventType: string,
  state: SpeechEventPayload["state"],
): string {
  switch (eventType) {
    case "session_started":
      return "started";
    case "transcript_segment":
      return "listening";
    case "session_rerouted":
      return "processing";
    case "transcript_final":
      return "completed";
    case "session_control":
      if (state === "interrupted") return "interrupted";
      if (state === "ended") return "completed";
      return "processing";
    default:
      return "processing";
  }
}

export function normalizeString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

export function normalizeApprovalGrantPayload(
  value: unknown,
): { mode: "once" | "time_window" | "durable"; ttlSeconds?: number } | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const mode = value.mode;
  if (mode !== "once" && mode !== "time_window" && mode !== "durable") {
    return undefined;
  }
  const ttlSeconds = value.ttlSeconds;
  if (ttlSeconds === undefined || ttlSeconds === null) {
    return { mode };
  }
  if (
    typeof ttlSeconds !== "number"
    || !Number.isFinite(ttlSeconds)
    || !Number.isInteger(ttlSeconds)
    || ttlSeconds <= 0
  ) {
    return undefined;
  }
  return {
    mode,
    ttlSeconds,
  };
}

export function parseOptionalIssuedTokenTtlSeconds(value: unknown): number | undefined | null {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value)) {
    return null;
  }
  if (value <= 0) {
    return null;
  }
  return value;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parsePaginationInt(
  value: unknown,
  options: { field: string; defaultValue: number; min: number; max: number },
): { ok: true; value: number } | { ok: false; message: string } {
  if (value === undefined || value === null) {
    return { ok: true, value: options.defaultValue };
  }
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value)) {
    return { ok: false, message: `${options.field} must be an integer` };
  }
  if (value < options.min || value > options.max) {
    return {
      ok: false,
      message: `${options.field} must be between ${options.min} and ${options.max}`,
    };
  }
  return { ok: true, value };
}

export function parseSpaceStatuses(raw: unknown): SpaceState[] | undefined {
  if (!Array.isArray(raw)) return undefined;

  const statuses = raw
    .filter((value): value is string => typeof value === "string")
    .filter((value): value is SpaceState =>
      (SPACE_STATUSES as string[]).includes(value),
    );

  return statuses.length > 0 ? statuses : undefined;
}

export function isGatewayErrorLike(
  err: unknown,
): err is {
  code:
    | "INVALID_ARGUMENT"
    | "NOT_FOUND"
    | "ALREADY_EXISTS"
    | "FAILED_PRECONDITION"
    | "PERMISSION_DENIED"
    | "RATE_LIMITED"
    | "CIRCUIT_OPEN";
  message: string;
} {
  if (typeof err !== "object" || err === null) {
    return false;
  }

  const candidate = err as { code?: unknown; message?: unknown };
  return (
    typeof candidate.code === "string"
    && ROUTED_ERROR_CODES.has(candidate.code)
    && typeof candidate.message === "string"
  );
}
