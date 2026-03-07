/**
 * Turn repository — stores every turn in a space.
 */

import type { Database, Statement } from "bun:sqlite";

export interface TurnRow {
  turn_id: string;
  space_id: string;
  actor_type: string;
  actor_id: string;
  input_json: string | null;
  output_json: string | null;
  status: string;
  token_input_count: number;
  token_output_count: number;
  connector_provider: string;
  requested_connector: string;
  effective_connector: string;
  fallback_reason: string;
  fallback_used: number;
  user_turn_id: string;
  race_id: string;
  race_rank: number;
  race_score: number;
  race_winner: number;
  moderator_rationale: string;
  created_at: string;
  completed_at: string | null;
  reply_to_turn_id: string | null;
}

export interface CreateTurnInput {
  turnId: string;
  spaceId: string;
  actorType: string;
  actorId: string;
  inputJson?: string;
  userTurnId?: string;
  connectorProvider?: string;
  requestedConnector?: string;
  replyToTurnId?: string;
}

export interface SpaceAgentTurnAggregate {
  agentId: string;
  actorType: string;
  turnCount: number;
  lastActivityAt?: string;
  earliestTurnAt?: string;
}

export class TurnRepository {
  private stmtCreate: Statement;
  private stmtListBySpaceAndAgent: Statement;
  private stmtListBySpaceAndAgentSince: Statement;
  private stmtComplete: Statement;

  constructor(private db: Database) {
    this.stmtCreate = db.prepare(`
      INSERT INTO turns(
        turn_id, space_id, actor_type, actor_id, input_json, status,
        user_turn_id, connector_provider, requested_connector, created_at,
        reply_to_turn_id
      ) VALUES (?, ?, ?, ?, ?, 'started', ?, ?, ?, ?, ?)
    `);
    this.stmtListBySpaceAndAgent = db.prepare(
      "SELECT * FROM turns WHERE space_id = ? AND actor_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?",
    );
    this.stmtListBySpaceAndAgentSince = db.prepare(
      "SELECT * FROM turns WHERE space_id = ? AND actor_id = ? AND created_at >= ? ORDER BY created_at DESC LIMIT ?",
    );
    this.stmtComplete = db.prepare(`
      UPDATE turns SET
        status = 'completed',
        output_json = ?,
        token_input_count = ?,
        token_output_count = ?,
        effective_connector = ?,
        fallback_reason = ?,
        fallback_used = ?,
        completed_at = ?
      WHERE turn_id = ?
    `);
  }

  create(input: CreateTurnInput): TurnRow {
    const now = new Date().toISOString();
    try {
      this.stmtCreate.run(
        input.turnId,
        input.spaceId,
        input.actorType,
        input.actorId,
        input.inputJson ?? null,
        input.userTurnId ?? "",
        input.connectorProvider ?? "",
        input.requestedConnector ?? "",
        now,
        input.replyToTurnId ?? null,
      );
    } catch (error) {
      if (!isMissingReplyToTurnColumnError(error)) {
        throw error;
      }
      // Backward-compatibility path for older DBs that have not yet applied
      // the additive reply_to_turn_id migration.
      this.db.query(`
        INSERT INTO turns(
          turn_id, space_id, actor_type, actor_id, input_json, status,
          user_turn_id, connector_provider, requested_connector, created_at
        ) VALUES (?, ?, ?, ?, ?, 'started', ?, ?, ?, ?)
      `).run(
        input.turnId,
        input.spaceId,
        input.actorType,
        input.actorId,
        input.inputJson ?? null,
        input.userTurnId ?? "",
        input.connectorProvider ?? "",
        input.requestedConnector ?? "",
        now,
      );
    }
    return this.getById(input.turnId)!;
  }

  getById(turnId: string): TurnRow | undefined {
    return this.db
      .query("SELECT * FROM turns WHERE turn_id = ?")
      .get(turnId) as TurnRow | undefined ?? undefined;
  }

  listBySpace(spaceId: string, limit = 100, offset = 0): TurnRow[] {
    return this.db
      .query("SELECT * FROM turns WHERE space_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?")
      .all(spaceId, limit, offset) as TurnRow[];
  }

  listBySpaceAfterTurn(spaceId: string, afterTurnId: string, limit = 100): TurnRow[] {
    return this.db
      .query(`
        SELECT t.*
        FROM turns t
        JOIN turns cursor ON cursor.turn_id = ?
        WHERE t.space_id = ?
          AND (
            t.created_at > cursor.created_at
            OR (t.created_at = cursor.created_at AND t.turn_id > cursor.turn_id)
          )
        ORDER BY t.created_at ASC, t.turn_id ASC
        LIMIT ?
      `)
      .all(afterTurnId, spaceId, Math.max(1, Math.floor(limit))) as TurnRow[];
  }

  countBySpaceAfterTurn(spaceId: string, afterTurnId: string): number {
    const row = this.db.query(`
      SELECT COUNT(*) as count
      FROM turns t
      JOIN turns cursor ON cursor.turn_id = ?
      WHERE t.space_id = ?
        AND (
          t.created_at > cursor.created_at
          OR (t.created_at = cursor.created_at AND t.turn_id > cursor.turn_id)
        )
    `).get(afterTurnId, spaceId) as { count?: number } | undefined;
    return row?.count ?? 0;
  }

  listBySpaceAndAgent(spaceId: string, agentId: string, limit = 100, offset = 0): TurnRow[] {
    return this.stmtListBySpaceAndAgent.all(spaceId, agentId, limit, offset) as TurnRow[];
  }

  listBySpaceAndAgentSince(spaceId: string, agentId: string, sinceIso: string, limit = 100): TurnRow[] {
    const normalizedLimit = Math.max(1, Math.floor(limit));
    return this.stmtListBySpaceAndAgentSince.all(
      spaceId,
      agentId,
      sinceIso,
      normalizedLimit,
    ) as TurnRow[];
  }

  complete(
    turnId: string,
    output: { outputJson: string; tokenInput: number; tokenOutput: number; effectiveConnector?: string; fallbackReason?: string; fallbackUsed?: boolean },
  ): void {
    this.stmtComplete.run(
      output.outputJson,
      output.tokenInput,
      output.tokenOutput,
      output.effectiveConnector ?? "",
      output.fallbackReason ?? "",
      output.fallbackUsed ? 1 : 0,
      new Date().toISOString(),
      turnId,
    );
  }

  fail(turnId: string, error: string): void {
    this.db.query(`
      UPDATE turns SET status = 'failed', output_json = ?, completed_at = ?
      WHERE turn_id = ?
    `).run(JSON.stringify({ error }), new Date().toISOString(), turnId);
  }

  countBySpace(spaceId: string): number {
    const row = this.db
      .query("SELECT COUNT(*) as count FROM turns WHERE space_id = ?")
      .get(spaceId) as { count: number };
    return row.count;
  }

  countCompletedBySpaceAndAgentSince(spaceId: string, agentId: string, sinceIso: string): number {
    const row = this.db.query(`
      SELECT COUNT(*) as count
      FROM turns
      WHERE space_id = ?
        AND actor_id = ?
        AND status = 'completed'
        AND created_at >= ?
    `).get(spaceId, agentId, sinceIso) as { count: number };
    return row.count ?? 0;
  }

  lastActivityBySpaceAndAgentSince(spaceId: string, agentId: string, sinceIso: string): string | undefined {
    const row = this.db.query(`
      SELECT MAX(COALESCE(completed_at, created_at)) as last_activity_at
      FROM turns
      WHERE space_id = ?
        AND actor_id = ?
        AND created_at >= ?
    `).get(spaceId, agentId, sinceIso) as { last_activity_at: string | null } | null;
    return row?.last_activity_at ?? undefined;
  }

  listAgentAggregatesBySpace(spaceId: string): SpaceAgentTurnAggregate[] {
    return this.db.query(`
      SELECT
        actor_id AS agentId,
        actor_type AS actorType,
        COUNT(*) AS turnCount,
        MAX(COALESCE(completed_at, created_at)) AS lastActivityAt,
        MIN(created_at) AS earliestTurnAt
      FROM turns
      WHERE space_id = ?
      GROUP BY actor_id, actor_type
      ORDER BY lastActivityAt DESC
    `).all(spaceId) as SpaceAgentTurnAggregate[];
  }
}

function isMissingReplyToTurnColumnError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return error.message.includes("no column named reply_to_turn_id");
}
