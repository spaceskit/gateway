/**
 * Space external agent binding repository — binds local space assignments
 * to remote MCP-discovered agents.
 */

import type { Database } from "bun:sqlite";

export interface SpaceExternalAgentBindingRow {
  space_id: string;
  agent_id: string;
  endpoint_id: string;
  remote_agent_id: string;
  display_name: string;
  created_at: string;
  updated_at: string;
}

export interface UpsertSpaceExternalAgentBindingInput {
  spaceId: string;
  agentId: string;
  endpointId: string;
  remoteAgentId: string;
  displayName?: string;
}

export class SpaceExternalAgentBindingRepository {
  constructor(private db: Database) {}

  upsert(input: UpsertSpaceExternalAgentBindingInput): SpaceExternalAgentBindingRow {
    const now = new Date().toISOString();

    this.db.query(`
      INSERT INTO space_external_agent_bindings(
        space_id, agent_id, endpoint_id, remote_agent_id, display_name, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(space_id, agent_id) DO UPDATE SET
        endpoint_id = excluded.endpoint_id,
        remote_agent_id = excluded.remote_agent_id,
        display_name = excluded.display_name,
        updated_at = excluded.updated_at
    `).run(
      input.spaceId,
      input.agentId,
      input.endpointId,
      input.remoteAgentId,
      input.displayName?.trim() ?? "",
      now,
      now,
    );

    return this.get(input.spaceId, input.agentId)!;
  }

  get(spaceId: string, agentId: string): SpaceExternalAgentBindingRow | null {
    return this.db.query(`
      SELECT *
      FROM space_external_agent_bindings
      WHERE space_id = ?
        AND agent_id = ?
      LIMIT 1
    `).get(spaceId, agentId) as SpaceExternalAgentBindingRow | null;
  }

  listBySpace(spaceId: string): SpaceExternalAgentBindingRow[] {
    return this.db.query(`
      SELECT *
      FROM space_external_agent_bindings
      WHERE space_id = ?
      ORDER BY updated_at DESC, agent_id ASC
    `).all(spaceId) as SpaceExternalAgentBindingRow[];
  }

  delete(spaceId: string, agentId: string): boolean {
    return this.db.query(`
      DELETE FROM space_external_agent_bindings
      WHERE space_id = ?
        AND agent_id = ?
    `).run(spaceId, agentId).changes > 0;
  }

  deleteBySpace(spaceId: string): number {
    return this.db.query(`
      DELETE FROM space_external_agent_bindings
      WHERE space_id = ?
    `).run(spaceId).changes;
  }
}

