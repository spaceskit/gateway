import type { Database } from "bun:sqlite";

export interface SpaceUsageCounterRow {
  space_id: string;
  staging_bytes: number;
  open_changesets: number;
  applied_changesets_monthly: number;
  token_spend_usd: number;
  updated_at: string;
}

export interface UpdateSpaceUsageCounterInput {
  stagingBytesDelta?: number;
  openChangeSetsDelta?: number;
  appliedChangeSetsMonthlyDelta?: number;
  tokenSpendUsdDelta?: number;
}

export class SpaceUsageCounterRepository {
  constructor(private readonly db: Database) {}

  get(spaceId: string): SpaceUsageCounterRow | undefined {
    return this.db.query(`
      SELECT * FROM space_usage_counters
      WHERE space_id = ?
    `).get(spaceId) as SpaceUsageCounterRow | undefined ?? undefined;
  }

  ensure(spaceId: string): SpaceUsageCounterRow {
    const existing = this.get(spaceId);
    if (existing) return existing;
    const now = new Date().toISOString();
    this.db.query(`
      INSERT INTO space_usage_counters(
        space_id,
        staging_bytes,
        open_changesets,
        applied_changesets_monthly,
        token_spend_usd,
        updated_at
      ) VALUES (?, 0, 0, 0, 0, ?)
      ON CONFLICT(space_id) DO NOTHING
    `).run(spaceId, now);
    return this.get(spaceId)!;
  }

  applyDelta(spaceId: string, delta: UpdateSpaceUsageCounterInput): SpaceUsageCounterRow {
    const current = this.ensure(spaceId);
    const next: SpaceUsageCounterRow = {
      ...current,
      staging_bytes: Math.max(0, current.staging_bytes + normalizeInt(delta.stagingBytesDelta)),
      open_changesets: Math.max(0, current.open_changesets + normalizeInt(delta.openChangeSetsDelta)),
      applied_changesets_monthly: Math.max(0, current.applied_changesets_monthly + normalizeInt(delta.appliedChangeSetsMonthlyDelta)),
      token_spend_usd: Math.max(0, current.token_spend_usd + normalizeFloat(delta.tokenSpendUsdDelta)),
      updated_at: new Date().toISOString(),
    };
    this.db.query(`
      UPDATE space_usage_counters
      SET staging_bytes = ?,
          open_changesets = ?,
          applied_changesets_monthly = ?,
          token_spend_usd = ?,
          updated_at = ?
      WHERE space_id = ?
    `).run(
      next.staging_bytes,
      next.open_changesets,
      next.applied_changesets_monthly,
      next.token_spend_usd,
      next.updated_at,
      spaceId,
    );
    return this.get(spaceId)!;
  }

  setAppliedChangeSetsMonthly(spaceId: string, value: number): SpaceUsageCounterRow {
    this.ensure(spaceId);
    const now = new Date().toISOString();
    this.db.query(`
      UPDATE space_usage_counters
      SET applied_changesets_monthly = ?,
          updated_at = ?
      WHERE space_id = ?
    `).run(Math.max(0, Math.floor(value)), now, spaceId);
    return this.get(spaceId)!;
  }
}

function normalizeInt(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.floor(value);
}

function normalizeFloat(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return value;
}
