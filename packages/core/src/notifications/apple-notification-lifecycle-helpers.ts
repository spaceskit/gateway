import type {
  AppleNotificationAction,
  AppleNotificationQuietHours,
  ApplePushPlatform,
} from "./apple-notification-lifecycle.js";

export function normalizeRequired(value: unknown, name: string): string {
  const normalized = normalizeOptionalString(value);
  if (!normalized) {
    throw serviceError("INVALID_ARGUMENT", `${name} is required`);
  }
  return normalized;
}

export function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

export function normalizePlatform(value: ApplePushPlatform): ApplePushPlatform {
  if (value === "ios" || value === "macos") return value;
  throw serviceError("INVALID_ARGUMENT", "platform must be ios or macos");
}

export function normalizeAction(value: AppleNotificationAction): AppleNotificationAction {
  if (
    value === "approve"
    || value === "reject"
    || value === "defer"
    || value === "revise"
    || value === "open_app"
  ) {
    return value;
  }
  throw serviceError("INVALID_ARGUMENT", "action is not supported");
}

export function normalizeActionList(value: unknown): AppleNotificationAction[] {
  if (!Array.isArray(value)) return ["open_app"];
  return value.filter((entry): entry is AppleNotificationAction =>
    entry === "approve"
    || entry === "reject"
    || entry === "defer"
    || entry === "revise"
    || entry === "open_app"
  );
}

export function normalizeMinute(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const normalized = Math.floor(value);
  return Math.max(0, Math.min((24 * 60) - 1, normalized));
}

export function normalizeCooldownSeconds(value: number, defaultCooldownSeconds: number): number {
  if (!Number.isFinite(value)) return defaultCooldownSeconds;
  return Math.max(0, Math.floor(value));
}

export function isInQuietHours(now: Date, quietHours: AppleNotificationQuietHours): boolean {
  if (!quietHours.enabled) return false;
  const minute = (now.getUTCHours() * 60) + now.getUTCMinutes();
  const start = normalizeMinute(quietHours.startMinute);
  const end = normalizeMinute(quietHours.endMinute);
  if (start === end) return true;
  if (start < end) {
    return minute >= start && minute < end;
  }
  return minute >= start || minute < end;
}

export function serviceError(code: string, message: string): Error & { code: string } {
  const error = new Error(message) as Error & { code: string };
  error.code = code;
  return error;
}
