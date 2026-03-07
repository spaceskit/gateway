import type { Database } from "bun:sqlite";

export interface ParticipantUsageCounterRow {
  space_id: string;
  principal_id: string;
  staging_bytes: number;
  uploads_today: number;
  open_changesets: number;
  tool_calls_last_hour: number;
  updated_at: string;
}

export interface UpdateParticipantUsageCounterInput {
  stagingBytesDelta?: number;
  uploadsTodayDelta?: number;
  openChangeSetsDelta?: number;
  toolCallsLastHourDelta?: number;
}

export class ParticipantUsageCounterRepository {
  constructor(private readonly db: Database) {}

  get(spaceId: string, principalId: string): ParticipantUsageCounterRow | undefined {
    return this.db.query(`
      SELECT * FROM participant_usage_counters
      WHERE space_id = ?
        AND principal_id = ?
    `).get(spaceId, principalId) as ParticipantUsageCounterRow | undefined ?? undefined;
  }

  ensure(spaceId: string, principalId: string): ParticipantUsageCounterRow {
    const existing = this.get(spaceId, principalId);
    if (existing) return existing;
    const now = new Date().toISOString();
    this.db.query(`
      INSERT INTO participant_usage_counters(
        space_id,
        principal_id,
        staging_bytes,
        uploads_today,
        open_changesets,
        tool_calls_last_hour,
        updated_at
      ) VALUES (?, ?, 0, 0, 0, 0, ?)
      ON CONFLICT(space_id, principal_id) DO NOTHING
    `).run(spaceId, principalId, now);
    return this.get(spaceId, principalId)!;
  }

  applyDelta(
    spaceId: string,
    principalId: string,
    delta: UpdateParticipantUsageCounterInput,
  ): ParticipantUsageCounterRow {
    const current = this.ensure(spaceId, principalId);
    const next: ParticipantUsageCounterRow = {
      ...current,
      staging_bytes: Math.max(0, current.staging_bytes + normalizeInt(delta.stagingBytesDelta)),
      uploads_today: Math.max(0, current.uploads_today + normalizeInt(delta.uploadsTodayDelta)),
      open_changesets: Math.max(0, current.open_changesets + normalizeInt(delta.openChangeSetsDelta)),
      tool_calls_last_hour: Math.max(0, current.tool_calls_last_hour + normalizeInt(delta.toolCallsLastHourDelta)),
      updated_at: new Date().toISOString(),
    };

    this.db.query(`
      UPDATE participant_usage_counters
      SET staging_bytes = ?,
          uploads_today = ?,
          open_changesets = ?,
          tool_calls_last_hour = ?,
          updated_at = ?
      WHERE space_id = ?
        AND principal_id = ?
    `).run(
      next.staging_bytes,
      next.uploads_today,
      next.open_changesets,
      next.tool_calls_last_hour,
      next.updated_at,
      spaceId,
      principalId,
    );
    return this.get(spaceId, principalId)!;
  }

  resetUploadsToday(spaceId: string, principalId: string): ParticipantUsageCounterRow {
    this.ensure(spaceId, principalId);
    const now = new Date().toISOString();
    this.db.query(`
      UPDATE participant_usage_counters
      SET uploads_today = 0,
          updated_at = ?
      WHERE space_id = ?
        AND principal_id = ?
    `).run(now, spaceId, principalId);
    return this.get(spaceId, principalId)!;
  }

  resetToolCallsLastHour(spaceId: string, principalId: string): ParticipantUsageCounterRow {
    this.ensure(spaceId, principalId);
    const now = new Date().toISOString();
    this.db.query(`
      UPDATE participant_usage_counters
      SET tool_calls_last_hour = 0,
          updated_at = ?
      WHERE space_id = ?
        AND principal_id = ?
    `).run(now, spaceId, principalId);
    return this.get(spaceId, principalId)!;
  }

  listBySpace(spaceId: string): ParticipantUsageCounterRow[] {
    return this.db.query(`
      SELECT * FROM participant_usage_counters
      WHERE space_id = ?
      ORDER BY updated_at DESC
    `).all(spaceId) as ParticipantUsageCounterRow[];
  }
}

function normalizeInt(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.floor(value);
}
