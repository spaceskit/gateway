import type { Database } from "bun:sqlite";

export interface EventLogRow {
  event_id: string;
  space_id: string;
  turn_id: string;
  agent_id: string;
  seq: number;
  event_type: string;
  created_at: string;
  payload_json: string;
}

export interface CreateEventLogInput {
  eventId: string;
  spaceId: string;
  turnId?: string;
  agentId?: string;
  seq?: number;
  eventType: string;
  payloadJson?: string;
  createdAt?: string;
}

export interface ListEventLogQuery {
  spaceId: string;
  turnId?: string;
  limit?: number;
  offset?: number;
}

export class EventLogRepository {
  constructor(private readonly db: Database) {}

  create(input: CreateEventLogInput): EventLogRow {
    const spaceId = input.spaceId.trim();
    const turnId = (input.turnId ?? "").trim();
    const agentId = (input.agentId ?? "").trim();
    const createdAt = input.createdAt ?? new Date().toISOString();
    const seq = typeof input.seq === "number" && Number.isFinite(input.seq)
      ? Math.max(0, Math.floor(input.seq))
      : this.nextSequence(spaceId, turnId);

    this.db.query(`
      INSERT INTO event_log(
        event_id,
        space_id,
        turn_id,
        agent_id,
        seq,
        event_type,
        created_at,
        payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.eventId,
      spaceId,
      turnId,
      agentId,
      seq,
      input.eventType,
      createdAt,
      input.payloadJson ?? "{}",
    );

    return this.get(input.eventId)!;
  }

  get(eventId: string): EventLogRow | undefined {
    return this.db.query(`
      SELECT * FROM event_log
      WHERE event_id = ?
    `).get(eventId) as EventLogRow | undefined ?? undefined;
  }

  list(query: ListEventLogQuery): EventLogRow[] {
    const limit = normalizeLimit(query.limit);
    const offset = normalizeOffset(query.offset);
    const turnId = query.turnId?.trim();
    if (turnId) {
      return this.db.query(`
        SELECT * FROM event_log
        WHERE space_id = ?
          AND turn_id = ?
        ORDER BY seq ASC, created_at ASC
        LIMIT ? OFFSET ?
      `).all(query.spaceId, turnId, limit, offset) as EventLogRow[];
    }

    return this.db.query(`
      SELECT * FROM event_log
      WHERE space_id = ?
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `).all(query.spaceId, limit, offset) as EventLogRow[];
  }

  count(spaceId: string, turnId?: string): number {
    const normalizedTurnId = turnId?.trim();
    if (normalizedTurnId) {
      const row = this.db.query(`
        SELECT COUNT(*) AS count
        FROM event_log
        WHERE space_id = ?
          AND turn_id = ?
      `).get(spaceId, normalizedTurnId) as { count: number };
      return row.count;
    }

    const row = this.db.query(`
      SELECT COUNT(*) AS count
      FROM event_log
      WHERE space_id = ?
    `).get(spaceId) as { count: number };
    return row.count;
  }

  private nextSequence(spaceId: string, turnId: string): number {
    const row = this.db.query(`
      SELECT COALESCE(MAX(seq) + 1, 0) AS next_seq
      FROM event_log
      WHERE space_id = ?
        AND turn_id = ?
    `).get(spaceId, turnId) as { next_seq: number };
    return row.next_seq;
  }
}

function normalizeLimit(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 200;
  }
  return Math.max(1, Math.min(5000, Math.floor(value)));
}

function normalizeOffset(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.floor(value));
}
