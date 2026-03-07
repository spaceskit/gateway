/**
 * Space agent assignment repository — normalized assignment lifecycle.
 */

import type { Database } from "bun:sqlite";

export interface SpaceAgentAssignmentRow {
  space_id: string;
  agent_id: string;
  profile_id: string;
  security_scope_json: string | null;
  spawn_context: string | null;
  context_overrides_json: string | null;
  role: string;
  turn_order: number;
  is_primary: number;
  assigned_at: string;
  updated_at: string;
}

export interface UpsertSpaceAgentAssignmentInput {
  spaceId: string;
  agentId: string;
  profileId: string;
  securityScopeJson?: string | null;
  spawnContext?: string | null;
  contextOverridesJson?: string | null;
  role?: string;
  turnOrder?: number;
  isPrimary?: boolean;
  assignedAt?: string;
}

export class SpaceAgentAssignmentRepository {
  constructor(private db: Database) {}

  upsert(input: UpsertSpaceAgentAssignmentInput): SpaceAgentAssignmentRow {
    const now = new Date().toISOString();
    const assignedAt = input.assignedAt ?? now;

    this.db.query(`
      INSERT INTO space_agent_assignments(
        space_id, agent_id, profile_id, security_scope_json, spawn_context, context_overrides_json, role,
        turn_order, is_primary, assigned_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(space_id, agent_id) DO UPDATE SET
        profile_id = excluded.profile_id,
        security_scope_json = excluded.security_scope_json,
        spawn_context = excluded.spawn_context,
        context_overrides_json = excluded.context_overrides_json,
        role = excluded.role,
        turn_order = excluded.turn_order,
        is_primary = excluded.is_primary,
        assigned_at = excluded.assigned_at,
        updated_at = excluded.updated_at
    `).run(
      input.spaceId,
      input.agentId,
      input.profileId,
      input.securityScopeJson ?? null,
      input.spawnContext ?? null,
      input.contextOverridesJson ?? null,
      input.role ?? "participant",
      input.turnOrder ?? 0,
      input.isPrimary ? 1 : 0,
      assignedAt,
      now,
    );

    return this.get(input.spaceId, input.agentId)!;
  }

  get(spaceId: string, agentId: string): SpaceAgentAssignmentRow | undefined {
    return this.db
      .query("SELECT * FROM space_agent_assignments WHERE space_id = ? AND agent_id = ?")
      .get(spaceId, agentId) as SpaceAgentAssignmentRow | undefined ?? undefined;
  }

  listBySpace(spaceId: string): SpaceAgentAssignmentRow[] {
    return this.db
      .query("SELECT * FROM space_agent_assignments WHERE space_id = ? ORDER BY turn_order ASC, assigned_at ASC")
      .all(spaceId) as SpaceAgentAssignmentRow[];
  }

  delete(spaceId: string, agentId: string): boolean {
    return this.db
      .query("DELETE FROM space_agent_assignments WHERE space_id = ? AND agent_id = ?")
      .run(spaceId, agentId).changes > 0;
  }
}
