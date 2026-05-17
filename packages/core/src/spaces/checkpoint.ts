/**
 * CheckpointManager — save/restore space execution state.
 *
 * Enables:
 * - Pausing and resuming spaces across server restarts
 * - Debugging by replaying from a checkpoint
 * - Recovery from failures
 * - State inspection at any point in execution
 */

import { randomUUID } from "node:crypto";
import type { ModelMessage } from "../agents/model-provider.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Checkpoint {
  checkpointId: string;
  spaceId: string;
  label?: string;
  /** Serialized space state snapshot. */
  stateJson: string;
  /** Serialized space config at checkpoint time. */
  configJson: string;
  /** Turn IDs completed before this checkpoint. */
  turnIds: string[];
  /** Agent execution states at checkpoint time. */
  agentStates: Record<string, { status: string; lastTurnId?: string; messages: ModelMessage[] }>;
  createdAt: Date;
}

export interface CheckpointManager {
  /** Save current space state as a checkpoint. */
  save(spaceId: string, data: CheckpointData): Promise<Checkpoint>;
  /** Load a specific checkpoint. */
  load(checkpointId: string): Promise<Checkpoint | null>;
  /** List all checkpoints for a space, newest first. */
  list(spaceId: string): Promise<Checkpoint[]>;
  /** Get the latest checkpoint for a space. */
  latest(spaceId: string): Promise<Checkpoint | null>;
  /** Delete a checkpoint. */
  delete(checkpointId: string): Promise<void>;
  /** Delete all checkpoints for a space. */
  deleteAll(spaceId: string): Promise<void>;
  /** Optional lookup by checkpoint label across spaces (newest first). */
  listByLabel?(label: string, limit?: number): Promise<Checkpoint[]>;
}

export interface CheckpointData {
  stateJson: string;
  configJson: string;
  turnIds: string[];
  agentStates: Record<string, { status: string; lastTurnId?: string; messages: ModelMessage[] }>;
  label?: string;
}

// ---------------------------------------------------------------------------
// SQLite Implementation
// ---------------------------------------------------------------------------

export class SQLiteCheckpointManager implements CheckpointManager {
  private db: any; // bun:sqlite Database

  constructor(db: any) {
    this.db = db;
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS checkpoints (
        checkpoint_id TEXT PRIMARY KEY,
        space_id TEXT NOT NULL,
        label TEXT,
        state_json TEXT NOT NULL,
        config_json TEXT NOT NULL,
        turn_ids_json TEXT NOT NULL DEFAULT '[]',
        agent_states_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_checkpoint_space ON checkpoints(space_id, created_at DESC);
    `);
  }

  async save(spaceId: string, data: CheckpointData): Promise<Checkpoint> {
    const checkpoint: Checkpoint = {
      checkpointId: randomUUID(),
      spaceId,
      label: data.label,
      stateJson: data.stateJson,
      configJson: data.configJson,
      turnIds: data.turnIds,
      agentStates: data.agentStates,
      createdAt: new Date(),
    };

    this.db.prepare(`
      INSERT INTO checkpoints (checkpoint_id, space_id, label, state_json, config_json, turn_ids_json, agent_states_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      checkpoint.checkpointId,
      spaceId,
      data.label ?? null,
      data.stateJson,
      data.configJson,
      JSON.stringify(data.turnIds),
      JSON.stringify(data.agentStates),
      checkpoint.createdAt.toISOString(),
    );

    return checkpoint;
  }

  async load(checkpointId: string): Promise<Checkpoint | null> {
    const row = this.db.prepare("SELECT * FROM checkpoints WHERE checkpoint_id = ?").get(checkpointId) as any;
    return row ? this.rowToCheckpoint(row) : null;
  }

  async list(spaceId: string): Promise<Checkpoint[]> {
    const rows = this.db.prepare(
      "SELECT * FROM checkpoints WHERE space_id = ? ORDER BY created_at DESC",
    ).all(spaceId) as any[];
    return rows.map((r) => this.rowToCheckpoint(r));
  }

  async latest(spaceId: string): Promise<Checkpoint | null> {
    const row = this.db.prepare(
      "SELECT * FROM checkpoints WHERE space_id = ? ORDER BY created_at DESC LIMIT 1",
    ).get(spaceId) as any;
    return row ? this.rowToCheckpoint(row) : null;
  }

  async delete(checkpointId: string): Promise<void> {
    this.db.prepare("DELETE FROM checkpoints WHERE checkpoint_id = ?").run(checkpointId);
  }

  async deleteAll(spaceId: string): Promise<void> {
    this.db.prepare("DELETE FROM checkpoints WHERE space_id = ?").run(spaceId);
  }

  async listByLabel(label: string, limit = 50): Promise<Checkpoint[]> {
    const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 50;
    const rows = this.db.prepare(
      "SELECT * FROM checkpoints WHERE label = ? ORDER BY created_at DESC LIMIT ?",
    ).all(label, safeLimit) as any[];
    return rows.map((r) => this.rowToCheckpoint(r));
  }

  private rowToCheckpoint(row: any): Checkpoint {
    let turnIds: string[] = [];
    let agentStates: Record<string, { status: string; lastTurnId?: string; messages: ModelMessage[] }> = {};
    try { turnIds = JSON.parse(row.turn_ids_json ?? "[]"); } catch { /* corrupted data */ }
    try { agentStates = JSON.parse(row.agent_states_json ?? "{}"); } catch { /* corrupted data */ }
    for (const [agentId, state] of Object.entries(agentStates)) {
      if (!Array.isArray(state.messages)) {
        throw new Error(`Checkpoint agent state is missing messages: ${agentId}`);
      }
    }
    return {
      checkpointId: row.checkpoint_id,
      spaceId: row.space_id,
      label: row.label ?? undefined,
      stateJson: row.state_json,
      configJson: row.config_json,
      turnIds,
      agentStates,
      createdAt: new Date(row.created_at),
    };
  }
}
