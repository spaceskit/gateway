import type { Database } from "bun:sqlite";

export interface ParticipantQuotaPolicyRow {
  space_id: string;
  principal_id: string;
  max_staging_bytes: number;
  max_uploads_per_day: number;
  max_open_changesets: number;
  max_tool_calls_per_hour: number;
  updated_by: string;
  updated_at: string;
}

export interface UpsertParticipantQuotaPolicyInput {
  spaceId: string;
  principalId: string;
  maxStagingBytes?: number;
  maxUploadsPerDay?: number;
  maxOpenChangeSets?: number;
  maxToolCallsPerHour?: number;
  updatedBy?: string;
}

export class ParticipantQuotaPolicyRepository {
  constructor(private readonly db: Database) {}

  get(spaceId: string, principalId: string): ParticipantQuotaPolicyRow | undefined {
    return this.db.query(`
      SELECT * FROM participant_quota_policies
      WHERE space_id = ?
        AND principal_id = ?
    `).get(spaceId, principalId) as ParticipantQuotaPolicyRow | undefined ?? undefined;
  }

  listBySpace(spaceId: string): ParticipantQuotaPolicyRow[] {
    return this.db.query(`
      SELECT * FROM participant_quota_policies
      WHERE space_id = ?
      ORDER BY updated_at DESC
    `).all(spaceId) as ParticipantQuotaPolicyRow[];
  }

  upsert(input: UpsertParticipantQuotaPolicyInput): ParticipantQuotaPolicyRow {
    const current = this.get(input.spaceId, input.principalId);
    const now = new Date().toISOString();
    this.db.query(`
      INSERT INTO participant_quota_policies(
        space_id,
        principal_id,
        max_staging_bytes,
        max_uploads_per_day,
        max_open_changesets,
        max_tool_calls_per_hour,
        updated_by,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(space_id, principal_id) DO UPDATE SET
        max_staging_bytes = excluded.max_staging_bytes,
        max_uploads_per_day = excluded.max_uploads_per_day,
        max_open_changesets = excluded.max_open_changesets,
        max_tool_calls_per_hour = excluded.max_tool_calls_per_hour,
        updated_by = excluded.updated_by,
        updated_at = excluded.updated_at
    `).run(
      input.spaceId,
      input.principalId,
      normalizeInteger(input.maxStagingBytes, current?.max_staging_bytes ?? 0),
      normalizeInteger(input.maxUploadsPerDay, current?.max_uploads_per_day ?? 0),
      normalizeInteger(input.maxOpenChangeSets, current?.max_open_changesets ?? 0),
      normalizeInteger(input.maxToolCallsPerHour, current?.max_tool_calls_per_hour ?? 0),
      normalizeString(input.updatedBy) ?? current?.updated_by ?? "system",
      now,
    );
    return this.get(input.spaceId, input.principalId)!;
  }
}

function normalizeInteger(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return Math.max(0, Math.floor(fallback));
  }
  return Math.max(0, Math.floor(value));
}

function normalizeString(value: string | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}
