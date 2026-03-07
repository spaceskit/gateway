/**
 * Orchestration journal repository — redacted orchestration trace persistence.
 */

import type { Database } from "bun:sqlite";

export interface OrchestrationJournalRow {
  event_id: string;
  space_id: string;
  turn_id: string;
  seq: number;
  event_type: string;
  actor_id: string;
  lineage_id: string;
  hop_count: number;
  payload_json: string;
  created_at: string;
}

export interface CreateOrchestrationJournalInput {
  eventId: string;
  spaceId: string;
  turnId?: string;
  eventType: string;
  actorId: string;
  lineageId?: string;
  hopCount?: number;
  payloadJson?: string;
  createdAt?: string;
}

export interface ListOrchestrationJournalQuery {
  spaceId: string;
  turnId?: string;
  limit: number;
  offset: number;
}

export class OrchestrationJournalRepository {
  constructor(private db: Database) {}

  create(input: CreateOrchestrationJournalInput): OrchestrationJournalRow {
    const now = input.createdAt ?? new Date().toISOString();
    const seq = this.nextSequence(input.spaceId);
    this.db.query(`
      INSERT INTO orchestration_journal(
        event_id, space_id, turn_id, seq, event_type, actor_id, lineage_id, hop_count, payload_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.eventId,
      input.spaceId,
      input.turnId ?? "",
      seq,
      input.eventType,
      input.actorId,
      input.lineageId ?? "",
      input.hopCount ?? 0,
      input.payloadJson ?? "{}",
      now,
    );
    return this.getById(input.eventId)!;
  }

  getById(eventId: string): OrchestrationJournalRow | undefined {
    return this.db
      .query("SELECT * FROM orchestration_journal WHERE event_id = ?")
      .get(eventId) as OrchestrationJournalRow | undefined ?? undefined;
  }

  list(query: ListOrchestrationJournalQuery): OrchestrationJournalRow[] {
    if (query.turnId && query.turnId.trim().length > 0) {
      return this.db
        .query(`
          SELECT * FROM orchestration_journal
          WHERE space_id = ? AND turn_id = ?
          ORDER BY seq ASC
          LIMIT ? OFFSET ?
        `)
        .all(query.spaceId, query.turnId, query.limit, query.offset) as OrchestrationJournalRow[];
    }

    return this.db
      .query(`
        SELECT * FROM orchestration_journal
        WHERE space_id = ?
        ORDER BY seq ASC
        LIMIT ? OFFSET ?
      `)
      .all(query.spaceId, query.limit, query.offset) as OrchestrationJournalRow[];
  }

  count(spaceId: string, turnId?: string): number {
    if (turnId && turnId.trim().length > 0) {
      const row = this.db
        .query(`
          SELECT COUNT(*) as count
          FROM orchestration_journal
          WHERE space_id = ? AND turn_id = ?
        `)
        .get(spaceId, turnId) as { count: number };
      return row.count;
    }

    const row = this.db
      .query(`
        SELECT COUNT(*) as count
        FROM orchestration_journal
        WHERE space_id = ?
      `)
      .get(spaceId) as { count: number };
    return row.count;
  }

  pruneBefore(cutoffIso: string): number {
    const result = this.db
      .query("DELETE FROM orchestration_journal WHERE created_at < ?")
      .run(cutoffIso);
    return result.changes;
  }

  private nextSequence(spaceId: string): number {
    const row = this.db
      .query(`
        SELECT COALESCE(MAX(seq) + 1, 0) as next_seq
        FROM orchestration_journal
        WHERE space_id = ?
      `)
      .get(spaceId) as { next_seq: number };
    return row.next_seq;
  }
}
