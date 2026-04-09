import type { Database } from "bun:sqlite";

export type SpaceReplaySessionPrivacyMode = "STANDARD" | "INCOGNITO_SESSION";
export type SpaceReplaySessionStatus = "active" | "closed";

export interface SpaceReplaySessionRow {
  session_id: string;
  space_id: string;
  privacy_mode: SpaceReplaySessionPrivacyMode;
  status: SpaceReplaySessionStatus;
  started_at: string;
  last_activity_at: string;
  closed_at: string | null;
  turn_count: number;
  last_self_check_turn_count: number;
  summary: string;
  purged_at: string | null;
}

export interface CreateSpaceReplaySessionInput {
  sessionId: string;
  spaceId: string;
  privacyMode: SpaceReplaySessionPrivacyMode;
  startedAt?: string;
  lastActivityAt?: string;
  turnCount?: number;
  lastSelfCheckTurnCount?: number;
  summary?: string;
}

export class SpaceReplaySessionRepository {
  constructor(private readonly db: Database) {
    this.ensureSchema();
  }

  create(input: CreateSpaceReplaySessionInput): SpaceReplaySessionRow {
    const startedAt = input.startedAt ?? new Date().toISOString();
    const lastActivityAt = input.lastActivityAt ?? startedAt;
    this.db.query(`
      INSERT INTO space_replay_sessions(
        session_id,
        space_id,
        privacy_mode,
        status,
        started_at,
        last_activity_at,
        closed_at,
        turn_count,
        last_self_check_turn_count,
        summary,
        purged_at
      ) VALUES (?, ?, ?, 'active', ?, ?, NULL, ?, ?, ?, NULL)
    `).run(
      input.sessionId,
      input.spaceId,
      input.privacyMode,
      startedAt,
      lastActivityAt,
      Math.max(0, Math.floor(input.turnCount ?? 0)),
      Math.max(0, Math.floor(input.lastSelfCheckTurnCount ?? 0)),
      input.summary ?? "",
    );
    return this.getById(input.sessionId)!;
  }

  getById(sessionId: string): SpaceReplaySessionRow | undefined {
    return this.db
      .query("SELECT * FROM space_replay_sessions WHERE session_id = ?")
      .get(sessionId) as SpaceReplaySessionRow | undefined ?? undefined;
  }

  getActive(spaceId: string): SpaceReplaySessionRow | undefined {
    return this.db
      .query(`
        SELECT * FROM space_replay_sessions
        WHERE space_id = ?
          AND status = 'active'
        ORDER BY started_at DESC
        LIMIT 1
      `)
      .get(spaceId) as SpaceReplaySessionRow | undefined ?? undefined;
  }

  listActiveIncognito(): SpaceReplaySessionRow[] {
    return this.db
      .query(`
        SELECT * FROM space_replay_sessions
        WHERE status = 'active'
          AND privacy_mode = 'INCOGNITO_SESSION'
        ORDER BY last_activity_at ASC
      `)
      .all() as SpaceReplaySessionRow[];
  }

  touch(
    sessionId: string,
    patch: {
      lastActivityAt?: string;
      turnCountDelta?: number;
      turnCount?: number;
      lastSelfCheckTurnCount?: number;
      summary?: string;
    } = {},
  ): SpaceReplaySessionRow {
    const sets: string[] = [];
    const values: Array<string | number | null> = [];

    if (patch.lastActivityAt) {
      sets.push("last_activity_at = ?");
      values.push(patch.lastActivityAt);
    }
    if (typeof patch.turnCount === "number" && Number.isFinite(patch.turnCount)) {
      sets.push("turn_count = ?");
      values.push(Math.max(0, Math.floor(patch.turnCount)));
    } else if (typeof patch.turnCountDelta === "number" && Number.isFinite(patch.turnCountDelta) && patch.turnCountDelta !== 0) {
      sets.push("turn_count = MAX(0, turn_count + ?)");
      values.push(Math.floor(patch.turnCountDelta));
    }
    if (typeof patch.lastSelfCheckTurnCount === "number" && Number.isFinite(patch.lastSelfCheckTurnCount)) {
      sets.push("last_self_check_turn_count = ?");
      values.push(Math.max(0, Math.floor(patch.lastSelfCheckTurnCount)));
    }
    if (typeof patch.summary === "string") {
      sets.push("summary = ?");
      values.push(patch.summary);
    }

    if (sets.length === 0) {
      return this.getById(sessionId)!;
    }

    values.push(sessionId);
    this.db.query(`
      UPDATE space_replay_sessions
      SET ${sets.join(", ")}
      WHERE session_id = ?
    `).run(...values);
    return this.getById(sessionId)!;
  }

  close(
    sessionId: string,
    patch: {
      status?: SpaceReplaySessionStatus;
      closedAt?: string;
      purgedAt?: string | null;
      lastActivityAt?: string;
      summary?: string;
    } = {},
  ): SpaceReplaySessionRow {
    const status = patch.status ?? "closed";
    const closedAt = patch.closedAt ?? new Date().toISOString();
    this.db.query(`
      UPDATE space_replay_sessions
      SET status = ?,
          closed_at = ?,
          purged_at = ?,
          last_activity_at = ?,
          summary = COALESCE(?, summary)
      WHERE session_id = ?
    `).run(
      status,
      closedAt,
      patch.purgedAt ?? null,
      patch.lastActivityAt ?? closedAt,
      patch.summary ?? null,
      sessionId,
    );
    return this.getById(sessionId)!;
  }

  private ensureSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS space_replay_sessions (
        session_id TEXT PRIMARY KEY,
        space_id TEXT NOT NULL,
        privacy_mode TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at TEXT NOT NULL,
        last_activity_at TEXT NOT NULL,
        closed_at TEXT,
        turn_count INTEGER NOT NULL DEFAULT 0,
        last_self_check_turn_count INTEGER NOT NULL DEFAULT 0,
        summary TEXT NOT NULL DEFAULT '',
        purged_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_space_replay_sessions_space
        ON space_replay_sessions(space_id, started_at DESC);
      CREATE INDEX IF NOT EXISTS idx_space_replay_sessions_active
        ON space_replay_sessions(status, privacy_mode, last_activity_at ASC);
    `);
  }
}
