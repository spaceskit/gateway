/**
 * Dead Letter Queue — stores failed turns for manual review/retry.
 *
 * When a turn fails after exhausting retries, it's placed in the dead letter
 * queue for manual inspection. Supports retry with exponential backoff.
 */

import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DeadLetter {
  id: string;
  spaceId: string;
  turnId: string;
  agentId: string;
  input: string;
  error: string;
  errorStack?: string;
  retryCount: number;
  maxRetries: number;
  /** ISO timestamps of each retry attempt. */
  retryHistory: string[];
  status: "pending" | "retrying" | "resolved" | "abandoned";
  createdAt: Date;
  resolvedAt?: Date;
}

export interface DeadLetterQueue {
  /** Add a failed turn to the queue. */
  enqueue(params: DeadLetterEnqueueParams): Promise<DeadLetter>;
  /** Get a specific dead letter. */
  get(id: string): Promise<DeadLetter | null>;
  /** List pending dead letters. */
  listPending(limit?: number): Promise<DeadLetter[]>;
  /** List dead letters for a specific space. */
  listBySpace(spaceId: string): Promise<DeadLetter[]>;
  /** Mark as retrying. */
  markRetrying(id: string): Promise<void>;
  /** Mark as resolved (successfully retried or manually resolved). */
  resolve(id: string): Promise<void>;
  /** Abandon a dead letter (give up retrying). */
  abandon(id: string): Promise<void>;
  /** Clean up old resolved/abandoned entries. Returns number deleted. */
  cleanup(olderThanDays?: number): Promise<number>;
  /** Count pending items. */
  countPending(): Promise<number>;
}

export interface DeadLetterEnqueueParams {
  spaceId: string;
  turnId: string;
  agentId: string;
  input: string;
  error: Error;
  maxRetries?: number;
}

// ---------------------------------------------------------------------------
// SQLite Implementation
// ---------------------------------------------------------------------------

export class SQLiteDeadLetterQueue implements DeadLetterQueue {
  private db: any; // bun:sqlite Database

  constructor(db: any) {
    this.db = db;
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS dead_letters (
        id TEXT PRIMARY KEY,
        space_id TEXT NOT NULL,
        turn_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        input TEXT NOT NULL,
        error TEXT NOT NULL,
        error_stack TEXT,
        retry_count INTEGER DEFAULT 0,
        max_retries INTEGER DEFAULT 3,
        retry_history_json TEXT DEFAULT '[]',
        status TEXT DEFAULT 'pending',
        created_at TEXT NOT NULL,
        resolved_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_deadletter_status ON dead_letters(status);
      CREATE INDEX IF NOT EXISTS idx_deadletter_space ON dead_letters(space_id);
    `);
  }

  async enqueue(params: DeadLetterEnqueueParams): Promise<DeadLetter> {
    const dl: DeadLetter = {
      id: randomUUID(),
      spaceId: params.spaceId,
      turnId: params.turnId,
      agentId: params.agentId,
      input: params.input,
      error: params.error.message,
      errorStack: params.error.stack,
      retryCount: 0,
      maxRetries: params.maxRetries ?? 3,
      retryHistory: [],
      status: "pending",
      createdAt: new Date(),
    };

    this.db.prepare(`
      INSERT INTO dead_letters (id, space_id, turn_id, agent_id, input, error, error_stack, max_retries, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      dl.id, dl.spaceId, dl.turnId, dl.agentId, dl.input,
      dl.error, dl.errorStack ?? null, dl.maxRetries,
      dl.createdAt.toISOString(),
    );

    return dl;
  }

  async get(id: string): Promise<DeadLetter | null> {
    const row = this.db.prepare("SELECT * FROM dead_letters WHERE id = ?").get(id) as any;
    return row ? this.rowToDeadLetter(row) : null;
  }

  async listPending(limit = 50): Promise<DeadLetter[]> {
    const rows = this.db.prepare(
      "SELECT * FROM dead_letters WHERE status = 'pending' ORDER BY created_at DESC LIMIT ?",
    ).all(limit) as any[];
    return rows.map((r) => this.rowToDeadLetter(r));
  }

  async listBySpace(spaceId: string): Promise<DeadLetter[]> {
    const rows = this.db.prepare(
      "SELECT * FROM dead_letters WHERE space_id = ? ORDER BY created_at DESC",
    ).all(spaceId) as any[];
    return rows.map((r) => this.rowToDeadLetter(r));
  }

  async markRetrying(id: string): Promise<void> {
    const dl = await this.get(id);
    if (!dl) return;

    const history = [...dl.retryHistory, new Date().toISOString()];
    this.db.prepare(`
      UPDATE dead_letters SET status = 'retrying', retry_count = retry_count + 1, retry_history_json = ? WHERE id = ?
    `).run(JSON.stringify(history), id);
  }

  async resolve(id: string): Promise<void> {
    this.db.prepare(
      "UPDATE dead_letters SET status = 'resolved', resolved_at = ? WHERE id = ?",
    ).run(new Date().toISOString(), id);
  }

  async abandon(id: string): Promise<void> {
    this.db.prepare(
      "UPDATE dead_letters SET status = 'abandoned', resolved_at = ? WHERE id = ?",
    ).run(new Date().toISOString(), id);
  }

  async countPending(): Promise<number> {
    const row = this.db.prepare(
      "SELECT COUNT(*) as count FROM dead_letters WHERE status = 'pending'",
    ).get() as any;
    return row?.count ?? 0;
  }

  /**
   * Clean up old resolved/abandoned dead letters.
   * Prevents unbounded database growth.
   */
  async cleanup(olderThanDays = 30): Promise<number> {
    const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000).toISOString();
    const stmt = this.db.prepare(
      "DELETE FROM dead_letters WHERE status IN ('resolved', 'abandoned') AND created_at < ?",
    );
    stmt.run(cutoff);
    return stmt.changes ?? 0;
  }

  private rowToDeadLetter(row: any): DeadLetter {
    return {
      id: row.id,
      spaceId: row.space_id,
      turnId: row.turn_id,
      agentId: row.agent_id,
      input: row.input,
      error: row.error,
      errorStack: row.error_stack ?? undefined,
      retryCount: row.retry_count ?? 0,
      maxRetries: row.max_retries ?? 3,
      retryHistory: (() => { try { return JSON.parse(row.retry_history_json ?? "[]"); } catch { return []; } })(),
      status: row.status ?? "pending",
      createdAt: new Date(row.created_at),
      resolvedAt: row.resolved_at ? new Date(row.resolved_at) : undefined,
    };
  }
}
