import type { Database } from "bun:sqlite";

export interface SpaceQuotaPolicyRow {
  space_id: string;
  max_staging_bytes: number;
  max_open_changesets: number;
  max_applied_changesets_monthly: number;
  max_token_spend_usd: number;
  max_participant_staging_bytes: number;
  max_participant_uploads_per_day: number;
  max_open_changesets_per_participant: number;
  max_tool_calls_per_hour: number;
  updated_by: string;
  updated_at: string;
}

export interface UpsertSpaceQuotaPolicyInput {
  spaceId: string;
  maxStagingBytes?: number;
  maxOpenChangeSets?: number;
  maxAppliedChangeSetsMonthly?: number;
  maxTokenSpendUsd?: number;
  maxParticipantStagingBytes?: number;
  maxParticipantUploadsPerDay?: number;
  maxOpenChangeSetsPerParticipant?: number;
  maxToolCallsPerHour?: number;
  updatedBy?: string;
}

export class SpaceQuotaPolicyRepository {
  constructor(private readonly db: Database) {}

  getBySpace(spaceId: string): SpaceQuotaPolicyRow | undefined {
    return this.db.query(`
      SELECT * FROM space_quota_policies
      WHERE space_id = ?
    `).get(spaceId) as SpaceQuotaPolicyRow | undefined ?? undefined;
  }

  ensure(spaceId: string, updatedBy = "system"): SpaceQuotaPolicyRow {
    const existing = this.getBySpace(spaceId);
    if (existing) return existing;
    return this.upsert({
      spaceId,
      updatedBy,
    });
  }

  upsert(input: UpsertSpaceQuotaPolicyInput): SpaceQuotaPolicyRow {
    const current = this.getBySpace(input.spaceId);
    const now = new Date().toISOString();
    this.db.query(`
      INSERT INTO space_quota_policies(
        space_id,
        max_staging_bytes,
        max_open_changesets,
        max_applied_changesets_monthly,
        max_token_spend_usd,
        max_participant_staging_bytes,
        max_participant_uploads_per_day,
        max_open_changesets_per_participant,
        max_tool_calls_per_hour,
        updated_by,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(space_id) DO UPDATE SET
        max_staging_bytes = excluded.max_staging_bytes,
        max_open_changesets = excluded.max_open_changesets,
        max_applied_changesets_monthly = excluded.max_applied_changesets_monthly,
        max_token_spend_usd = excluded.max_token_spend_usd,
        max_participant_staging_bytes = excluded.max_participant_staging_bytes,
        max_participant_uploads_per_day = excluded.max_participant_uploads_per_day,
        max_open_changesets_per_participant = excluded.max_open_changesets_per_participant,
        max_tool_calls_per_hour = excluded.max_tool_calls_per_hour,
        updated_by = excluded.updated_by,
        updated_at = excluded.updated_at
    `).run(
      input.spaceId,
      normalizeInteger(input.maxStagingBytes, current?.max_staging_bytes ?? 1073741824),
      normalizeInteger(input.maxOpenChangeSets, current?.max_open_changesets ?? 50),
      normalizeInteger(input.maxAppliedChangeSetsMonthly, current?.max_applied_changesets_monthly ?? 500),
      normalizeFloat(input.maxTokenSpendUsd, current?.max_token_spend_usd ?? 0),
      normalizeInteger(input.maxParticipantStagingBytes, current?.max_participant_staging_bytes ?? 268435456),
      normalizeInteger(input.maxParticipantUploadsPerDay, current?.max_participant_uploads_per_day ?? 100),
      normalizeInteger(input.maxOpenChangeSetsPerParticipant, current?.max_open_changesets_per_participant ?? 10),
      normalizeInteger(input.maxToolCallsPerHour, current?.max_tool_calls_per_hour ?? 1000),
      normalizeString(input.updatedBy) ?? current?.updated_by ?? "system",
      now,
    );
    return this.getBySpace(input.spaceId)!;
  }
}

function normalizeInteger(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return Math.max(0, Math.floor(fallback));
  }
  return Math.max(0, Math.floor(value));
}

function normalizeFloat(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return Math.max(0, fallback);
  }
  return Math.max(0, value);
}

function normalizeString(value: string | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}
