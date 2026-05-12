export function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function asString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

export function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

export function asInteger(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return Math.trunc(parsed);
    }
  }
  return undefined;
}

export function asPositiveInteger(value: unknown): number | undefined {
  const parsed = asInteger(value);
  if (parsed === undefined || parsed <= 0) return undefined;
  return parsed;
}

export function normalizePercentage(value: unknown): number | undefined {
  const numberValue = asInteger(value);
  if (numberValue === undefined) return undefined;
  return Math.max(0, Math.min(100, numberValue));
}

export function asIsoFromEpochSeconds(value: unknown): string | undefined {
  const seconds = asInteger(value);
  if (seconds === undefined) return undefined;
  if (seconds <= 0) return undefined;
  try {
    return new Date(seconds * 1_000).toISOString();
  } catch {
    return undefined;
  }
}

export function parseIsoString(value: unknown): string | undefined {
  const raw = asString(value);
  if (!raw) {
    return undefined;
  }
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined;
}

export function joinNonEmpty(values: Array<string | undefined>, separator: string): string {
  return values
    .map((value) => value?.trim() || "")
    .filter((value) => value.length > 0)
    .join(separator);
}
