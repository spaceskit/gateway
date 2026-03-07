import { randomUUID } from "node:crypto";
import type { Database } from "bun:sqlite";

export type AgentUsageSessionStatus = "active" | "closed";

export interface AgentUsageSessionRow {
  session_id: string;
  space_id: string;
  agent_id: string;
  agent_role: string;
  status: AgentUsageSessionStatus;
  started_at: string;
  ended_at: string | null;
  last_activity_at: string;
  reset_by: string;
  created_at: string;
  updated_at: string;
}

export interface EnsureAgentUsageSessionInput {
  spaceId: string;
  agentId: string;
  agentRole?: string;
  nowIso?: string;
}

export interface ResetAgentUsageSessionInput {
  spaceId: string;
  agentId: string;
  agentRole?: string;
  resetBy: string;
  nowIso?: string;
}

export interface AgentUsageSessionResetResult {
  closedSession?: AgentUsageSessionRow;
  activeSession: AgentUsageSessionRow;
}

export class AgentUsageSessionRepository {
  constructor(private readonly db: Database) {}

  get(sessionId: string): AgentUsageSessionRow | undefined {
    return this.db.query(`
      SELECT * FROM agent_usage_sessions
      WHERE session_id = ?
    `).get(sessionId) as AgentUsageSessionRow | undefined ?? undefined;
  }

  getActive(spaceId: string, agentId: string): AgentUsageSessionRow | undefined {
    return this.db.query(`
      SELECT * FROM agent_usage_sessions
      WHERE space_id = ?
        AND agent_id = ?
        AND status = 'active'
      ORDER BY updated_at DESC
      LIMIT 1
    `).get(spaceId, agentId) as AgentUsageSessionRow | undefined ?? undefined;
  }

  ensureActive(input: EnsureAgentUsageSessionInput): AgentUsageSessionRow {
    const spaceId = input.spaceId.trim();
    const agentId = input.agentId.trim();
    const agentRole = normalizeRole(input.agentRole);
    const now = input.nowIso ?? new Date().toISOString();
    const existing = this.getActive(spaceId, agentId);
    if (existing) {
      if (existing.agent_role !== agentRole) {
        this.db.query(`
          UPDATE agent_usage_sessions
          SET agent_role = ?,
              updated_at = ?
          WHERE session_id = ?
        `).run(agentRole, now, existing.session_id);
        return this.get(existing.session_id)!;
      }
      return existing;
    }

    const sessionId = `aus-${randomUUID()}`;
    this.db.query(`
      INSERT INTO agent_usage_sessions(
        session_id,
        space_id,
        agent_id,
        agent_role,
        status,
        started_at,
        ended_at,
        last_activity_at,
        reset_by,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, 'active', ?, NULL, ?, '', ?, ?)
    `).run(
      sessionId,
      spaceId,
      agentId,
      agentRole,
      now,
      now,
      now,
      now,
    );
    return this.get(sessionId)!;
  }

  touch(spaceIdRaw: string, agentIdRaw: string, lastActivityAtIso?: string): AgentUsageSessionRow {
    const spaceId = spaceIdRaw.trim();
    const agentId = agentIdRaw.trim();
    const now = lastActivityAtIso ?? new Date().toISOString();
    const active = this.ensureActive({
      spaceId,
      agentId,
      nowIso: now,
    });
    this.db.query(`
      UPDATE agent_usage_sessions
      SET last_activity_at = ?,
          updated_at = ?
      WHERE session_id = ?
    `).run(now, now, active.session_id);
    return this.get(active.session_id)!;
  }

  resetActive(input: ResetAgentUsageSessionInput): AgentUsageSessionResetResult {
    const spaceId = input.spaceId.trim();
    const agentId = input.agentId.trim();
    const agentRole = normalizeRole(input.agentRole);
    const resetBy = input.resetBy.trim();
    const now = input.nowIso ?? new Date().toISOString();
    const current = this.getActive(spaceId, agentId);

    if (current) {
      this.db.query(`
        UPDATE agent_usage_sessions
        SET status = 'closed',
            ended_at = ?,
            reset_by = ?,
            updated_at = ?
        WHERE session_id = ?
      `).run(now, resetBy, now, current.session_id);
    }

    const activeSession = this.ensureActive({
      spaceId,
      agentId,
      agentRole,
      nowIso: now,
    });

    return {
      closedSession: current ? this.get(current.session_id) : undefined,
      activeSession,
    };
  }

  listBySpace(spaceIdRaw: string, opts: { status?: AgentUsageSessionStatus; limit?: number } = {}): AgentUsageSessionRow[] {
    const spaceId = spaceIdRaw.trim();
    const limit = normalizeLimit(opts.limit);
    if (opts.status) {
      return this.db.query(`
        SELECT * FROM agent_usage_sessions
        WHERE space_id = ?
          AND status = ?
        ORDER BY updated_at DESC
        LIMIT ?
      `).all(spaceId, opts.status, limit) as AgentUsageSessionRow[];
    }
    return this.db.query(`
      SELECT * FROM agent_usage_sessions
      WHERE space_id = ?
      ORDER BY updated_at DESC
      LIMIT ?
    `).all(spaceId, limit) as AgentUsageSessionRow[];
  }
}

function normalizeRole(value: string | undefined): string {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : "agent";
}

function normalizeLimit(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 500;
  }
  return Math.max(1, Math.min(5000, Math.floor(value)));
}
