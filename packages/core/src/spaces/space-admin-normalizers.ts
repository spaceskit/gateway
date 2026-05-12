import { normalizeUuid } from "../identity/uuid.js";
import type { ThinkingCapturePolicy } from "./memory-policy.js";
import type {
  CoordinatorRole,
  SpaceResourceType,
  SpaceState,
  TurnModelConfig,
  TurnModelStrategy,
} from "./types.js";

const TURN_MODEL_VALUES: TurnModelStrategy[] = [
  "sequential_all",
  "primary_only",
  "first_success",
  "round_robin",
  "parallel_race",
  "debate_synthesis",
  "adaptive_auto",
];

const SPACE_STATE_VALUES: SpaceState[] = [
  "created",
  "active",
  "paused",
  "completed",
  "failed",
  "archived",
  "deleted",
];

const ROLE_VALUES = new Set<CoordinatorRole | "participant">([
  "participant",
  "global_coordinator",
  "space_moderator",
]);

export function stableJsonHash(value: unknown): string {
  return JSON.stringify(sortValue(value)) ?? "null";
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sortValue(entry));
  }
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => [key, sortValue(entry)] as const);
    return Object.fromEntries(entries);
  }
  return value;
}

export function inferResponseType(value: unknown): string {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  return typeof value;
}

export function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}

export function parseSpaceConfig(spaceConfigJson: string | null): Record<string, unknown> {
  if (!spaceConfigJson) return {};
  try {
    const parsed = JSON.parse(spaceConfigJson);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function resolveSpaceUid(parsedConfig: Record<string, unknown>): string | undefined {
  const direct = normalizeUuidString(parsedConfig.spaceUid);
  if (direct) return direct;
  return normalizeUuidString(parsedConfig.space_uid);
}

export function parseStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

export function normalizeSpaceResourceType(value: unknown): SpaceResourceType {
  if (value === "folder") return "folder";
  if (value === "url") return "url";
  return "url";
}

export function parseSpaceResourceType(value: unknown): SpaceResourceType | null {
  if (value === "folder" || value === "url") return value;
  return null;
}

export function parseStringMap(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  const mapped: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw === "string") {
      mapped[key] = raw;
    }
  }
  return mapped;
}

export function parseTurnModelConfig(value: Record<string, unknown>): TurnModelConfig | undefined {
  if (isRecord(value.turnModelConfig)) {
    return value.turnModelConfig as unknown as TurnModelConfig;
  }
  if (isRecord(value.turn_model_config)) {
    return value.turn_model_config as unknown as TurnModelConfig;
  }
  return undefined;
}

export function parseVisibility(value: unknown): "shared" | "private" {
  if (value === "private") return "private";
  return "shared";
}

export function parseOptionalInt(value: unknown): number | undefined {
  const parsed = asInt(value);
  return parsed === undefined ? undefined : parsed;
}

export function parseThinkingCapturePolicy(value: unknown): ThinkingCapturePolicy | undefined {
  const normalized = normalizeOptionalString(value);
  switch (normalized) {
    case "OFF":
    case "SUMMARY":
    case "FULL":
      return normalized;
    default:
      return undefined;
  }
}

export function normalizeTurnModel(raw: string): TurnModelStrategy {
  if ((TURN_MODEL_VALUES as string[]).includes(raw)) {
    return raw as TurnModelStrategy;
  }
  return "sequential_all";
}

export function normalizeSpaceState(raw: string): SpaceState {
  if ((SPACE_STATE_VALUES as string[]).includes(raw)) {
    return raw as SpaceState;
  }
  return "created";
}

export function normalizeRole(raw: CoordinatorRole | "participant" | undefined): CoordinatorRole | "participant" {
  if (raw && ROLE_VALUES.has(raw)) {
    return raw;
  }
  return "participant";
}

export function parseDate(raw: string | undefined, fallback: Date): Date {
  if (!raw) return fallback;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? fallback : date;
}

export function parseOptionalDate(raw: string | null | undefined): Date | undefined {
  if (!raw) return undefined;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function normalizeOptionalString(value: unknown): string | undefined {
  const raw = asString(value);
  if (!raw) return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function normalizeUuidString(value: unknown): string | undefined {
  return normalizeUuid(value);
}

export function asInt(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value, 10);
    return Number.isNaN(parsed) ? undefined : parsed;
  }
  return undefined;
}

export function asBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    if (value === "true" || value === "1") return true;
    if (value === "false" || value === "0") return false;
  }
  return undefined;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
