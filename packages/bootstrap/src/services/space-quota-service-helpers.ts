import type {
  ParticipantQuotaPolicyRow,
  ParticipantUsageCounterRow,
  SpaceQuotaPolicyRow,
  SpaceUsageCounterRow,
} from "@spaceskit/persistence";
import {
  SpaceQuotaServiceError,
  type ParticipantQuotaPolicy,
  type ParticipantUsageSnapshot,
  type SpaceQuotaPolicy,
  type SpaceUsageSnapshot,
} from "./space-quota-service-types.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

export function mapSpaceQuotaPolicy(row: SpaceQuotaPolicyRow): SpaceQuotaPolicy {
  return {
    spaceId: row.space_id,
    maxStagingBytes: row.max_staging_bytes,
    maxOpenChangeSets: row.max_open_changesets,
    maxAppliedChangeSetsPerMonth: row.max_applied_changesets_monthly,
    tokenBudget: row.max_token_spend_usd,
    maxParticipantStagingBytes: row.max_participant_staging_bytes,
    maxUploadsPerDay: row.max_participant_uploads_per_day,
    maxOpenChangeSetsPerParticipant: row.max_open_changesets_per_participant,
    maxToolCallsPerHour: row.max_tool_calls_per_hour,
    updatedBy: row.updated_by,
    updatedAt: row.updated_at,
  };
}

export function mapParticipantQuotaPolicy(row?: ParticipantQuotaPolicyRow): ParticipantQuotaPolicy | undefined {
  if (!row) return undefined;
  return {
    spaceId: row.space_id,
    principalId: row.principal_id,
    maxStagingBytes: row.max_staging_bytes,
    maxUploadsPerDay: row.max_uploads_per_day,
    maxOpenChangeSets: row.max_open_changesets,
    maxToolCallsPerHour: row.max_tool_calls_per_hour,
    updatedBy: row.updated_by,
    updatedAt: row.updated_at,
  };
}

export function mapSpaceUsage(
  row: SpaceUsageCounterRow,
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    tokenAccuracy: "reported" | "estimated" | "mixed";
    usageSource: "ledger" | "local_scanner";
  },
  estimatedSpendUsd: number,
): SpaceUsageSnapshot {
  return {
    spaceId: row.space_id,
    stagingBytes: row.staging_bytes,
    openChangeSets: row.open_changesets,
    appliedChangeSetsPerMonth: row.applied_changesets_monthly,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
    tokenSpendUsd: roundMoney(Math.max(row.token_spend_usd, estimatedSpendUsd)),
    tokenAccuracy: usage.tokenAccuracy,
    usageSource: usage.usageSource,
    updatedAt: row.updated_at,
  };
}

export function mapParticipantUsage(row: ParticipantUsageCounterRow): ParticipantUsageSnapshot {
  return {
    spaceId: row.space_id,
    principalId: row.principal_id,
    stagingBytes: row.staging_bytes,
    uploadsToday: row.uploads_today,
    openChangeSets: row.open_changesets,
    toolCallsPerHour: row.tool_calls_last_hour,
    updatedAt: row.updated_at,
  };
}

export function resolveParticipantLimit(overrideValue: number | undefined, fallback: number): number {
  if (typeof overrideValue === "number" && Number.isFinite(overrideValue) && overrideValue > 0) {
    return Math.floor(overrideValue);
  }
  return Math.max(1, Math.floor(fallback));
}

export function resolveMonthWindow(now: Date): { startIso: string; endIso: string } {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const start = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(year, month + 1, 1, 0, 0, 0, 0));
  return {
    startIso: start.toISOString(),
    endIso: end.toISOString(),
  };
}

export function dayWindowToken(now: Date): string {
  const start = new Date(Math.floor(now.getTime() / DAY_MS) * DAY_MS);
  return start.toISOString().slice(0, 10);
}

export function hourWindowToken(now: Date): string {
  const start = new Date(Math.floor(now.getTime() / HOUR_MS) * HOUR_MS);
  return start.toISOString().slice(0, 13);
}

export function normalizeRequired(value: string, field: string): string {
  const normalized = normalizeOptional(value);
  if (!normalized) {
    throw new SpaceQuotaServiceError("INVALID_ARGUMENT", `${field} is required`);
  }
  return normalized;
}

export function normalizeOptional(value: string | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

export function resolveAgentRole(actorType: string | undefined, agentId: string): string {
  const normalizedActorType = actorType?.trim().toLowerCase() ?? "";
  const normalizedAgentId = agentId.trim().toLowerCase();
  if (normalizedActorType === "orchestrator" || normalizedAgentId.includes("orchestrator")) {
    return "orchestrator";
  }
  return "agent";
}

export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
}
