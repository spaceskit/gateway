import { SchedulerServiceError } from "./scheduler-errors.js";

const FORMATTER_CACHE_MAX_SIZE = 50;

interface CronMatcher {
  expression: string;
  minute: FieldMatcher;
  hour: FieldMatcher;
  dayOfMonth: FieldMatcher;
  month: FieldMatcher;
  dayOfWeek: FieldMatcher;
}

interface FieldMatcher {
  matches: (value: number) => boolean;
}

export interface ZonedParts {
  year: number;
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

export function computeNextRun(cronExpression: string, timezone: string, referenceIso: string): string | null {
  const matcher = parseCronExpression(cronExpression);
  const reference = new Date(referenceIso);
  if (Number.isNaN(reference.getTime())) {
    throw new SchedulerServiceError("INVALID_ARGUMENT", `Invalid reference time: ${referenceIso}`);
  }

  const cursor = new Date(reference.getTime());
  cursor.setUTCSeconds(0, 0);
  cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);

  // 2-year ceiling to avoid unbounded loops for malformed expressions.
  const maxIterations = 2 * 366 * 24 * 60;
  for (let i = 0; i < maxIterations; i += 1) {
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

function parseCronExpression(expression: string): CronMatcher {
  const normalized = expression.trim();
  const fields = normalized.split(/\s+/);
  if (fields.length !== 5) {
    throw new SchedulerServiceError("INVALID_ARGUMENT", `Invalid cron expression: ${expression}`);
  }

  return {
    expression: normalized,
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
    const rawStep = Number.parseInt(trimmed.slice(2), 10);
    if (!Number.isInteger(rawStep) || rawStep <= 0) {
      throw new SchedulerServiceError("INVALID_ARGUMENT", `Invalid cron step value: ${token}`);
    }
    return {
      matches: (value) => (value - min) % rawStep === 0,
    };
  }

  const allowedValues = new Set<number>();
  for (const part of trimmed.split(",")) {
    const piece = part.trim();
    if (!piece) continue;
    if (piece.includes("-")) {
      const [startRaw, endRaw] = piece.split("-", 2);
      const start = Number.parseInt(startRaw, 10);
      const end = Number.parseInt(endRaw, 10);
      if (!Number.isInteger(start) || !Number.isInteger(end) || start > end) {
        throw new SchedulerServiceError("INVALID_ARGUMENT", `Invalid cron range value: ${piece}`);
      }
      for (let value = start; value <= end; value += 1) {
        assertRange(value, min, max, piece);
        allowedValues.add(value);
      }
      continue;
    }

    const value = Number.parseInt(piece, 10);
    if (!Number.isInteger(value)) {
      throw new SchedulerServiceError("INVALID_ARGUMENT", `Invalid cron field value: ${piece}`);
    }
    assertRange(value, min, max, piece);
    allowedValues.add(value);
  }

  if (allowedValues.size === 0) {
    throw new SchedulerServiceError("INVALID_ARGUMENT", `Invalid cron field: ${token}`);
  }

  return {
    matches: (value) => allowedValues.has(value),
  };
}

function assertRange(value: number, min: number, max: number, token: string): void {
  if (value < min || value > max) {
    throw new SchedulerServiceError(
      "INVALID_ARGUMENT",
      `Cron value out of range (${min}-${max}): ${token}`,
    );
  }
}

export function getZonedParts(date: Date, timezone: string): ZonedParts {
  const formatter = getFormatter(timezone);
  const parts = formatter.formatToParts(date);

  let year = 0;
  let month = 0;
  let day = 0;
  let hour = 0;
  let minute = 0;
  let weekdayShort = "";

  for (const part of parts) {
    switch (part.type) {
      case "year":
        year = Number.parseInt(part.value, 10);
        if (Number.isNaN(year)) {
          throw new SchedulerServiceError("FAILED_PRECONDITION", `Failed to parse year "${part.value}" for timezone ${timezone}`);
        }
        break;
      case "month":
        month = Number.parseInt(part.value, 10);
        if (Number.isNaN(month)) {
          throw new SchedulerServiceError("FAILED_PRECONDITION", `Failed to parse month "${part.value}" for timezone ${timezone}`);
        }
        break;
      case "day":
        day = Number.parseInt(part.value, 10);
        if (Number.isNaN(day)) {
          throw new SchedulerServiceError("FAILED_PRECONDITION", `Failed to parse day "${part.value}" for timezone ${timezone}`);
        }
        break;
      case "hour":
        hour = Number.parseInt(part.value, 10);
        if (Number.isNaN(hour)) {
          throw new SchedulerServiceError("FAILED_PRECONDITION", `Failed to parse hour "${part.value}" for timezone ${timezone}`);
        }
        break;
      case "minute":
        minute = Number.parseInt(part.value, 10);
        if (Number.isNaN(minute)) {
          throw new SchedulerServiceError("FAILED_PRECONDITION", `Failed to parse minute "${part.value}" for timezone ${timezone}`);
        }
        break;
      case "weekday":
        weekdayShort = part.value.slice(0, 3).toLowerCase();
        break;
      default:
        break;
    }
  }

  const dayOfWeek = dayOfWeekByName[weekdayShort];
  if (dayOfWeek === undefined) {
    throw new SchedulerServiceError(
      "FAILED_PRECONDITION",
      `Failed to resolve weekday "${weekdayShort}" for timezone ${timezone}. Intl.DateTimeFormat returned an unrecognized weekday name.`,
    );
  }

  return {
    year,
    month,
    day,
    hour,
    minute,
    dayOfWeek,
  };
}

function getFormatter(timezone: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(timezone);
  if (cached) return cached;
  if (formatterCache.size >= FORMATTER_CACHE_MAX_SIZE) {
    const oldest = formatterCache.keys().next().value;
    if (oldest !== undefined) {
      formatterCache.delete(oldest);
    }
  }
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
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
