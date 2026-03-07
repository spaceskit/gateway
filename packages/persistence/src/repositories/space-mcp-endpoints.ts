/**
 * Space MCP endpoint repository — per-space MCP server configuration.
 */

import { randomUUID } from "node:crypto";
import type { Database } from "bun:sqlite";

export type SpaceMcpTransport = "sse" | "stdio";
export type SpaceMcpEndpointHealth = "unknown" | "ok" | "degraded" | "error";

export interface SpaceMcpEndpointRow {
  endpoint_id: string;
  space_id: string;
  transport: string;
  endpoint: string;
  args_json: string;
  secret_ref: string;
  enabled: number;
  health_status: string;
  health_message: string;
  last_connected_at: string | null;
  last_error_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface UpsertSpaceMcpEndpointInput {
  endpointId?: string;
  spaceId: string;
  transport: SpaceMcpTransport;
  endpoint: string;
  argsJson?: string;
  secretRef?: string;
  enabled?: boolean;
}

export interface UpdateSpaceMcpEndpointHealthInput {
  endpointId: string;
  healthStatus: SpaceMcpEndpointHealth;
  healthMessage?: string;
  lastConnectedAt?: string | null;
  lastErrorAt?: string | null;
}

export class SpaceMcpEndpointRepository {
  constructor(private db: Database) {}

  upsert(input: UpsertSpaceMcpEndpointInput): SpaceMcpEndpointRow {
    const now = new Date().toISOString();
    const existing = this.getBySpace(input.spaceId);
    const endpointId = input.endpointId?.trim()
      || existing?.endpoint_id
      || `space-mcp-${randomUUID()}`;

    this.db.query(`
      INSERT INTO space_mcp_endpoints(
        endpoint_id, space_id, transport, endpoint, args_json, secret_ref,
        enabled, health_status, health_message, last_connected_at, last_error_at,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)
      ON CONFLICT(space_id) DO UPDATE SET
        endpoint_id = excluded.endpoint_id,
        transport = excluded.transport,
        endpoint = excluded.endpoint,
        args_json = excluded.args_json,
        secret_ref = excluded.secret_ref,
        enabled = excluded.enabled,
        updated_at = excluded.updated_at
    `).run(
      endpointId,
      input.spaceId,
      input.transport,
      input.endpoint,
      input.argsJson ?? "[]",
      input.secretRef?.trim() ?? "",
      input.enabled === false ? 0 : 1,
      existing?.health_status ?? "unknown",
      existing?.health_message ?? "",
      existing?.created_at ?? now,
      now,
    );

    return this.getBySpace(input.spaceId)!;
  }

  getBySpace(spaceId: string): SpaceMcpEndpointRow | null {
    return this.db.query(`
      SELECT *
      FROM space_mcp_endpoints
      WHERE space_id = ?
      LIMIT 1
    `).get(spaceId) as SpaceMcpEndpointRow | null;
  }

  getByEndpointId(endpointId: string): SpaceMcpEndpointRow | null {
    return this.db.query(`
      SELECT *
      FROM space_mcp_endpoints
      WHERE endpoint_id = ?
      LIMIT 1
    `).get(endpointId) as SpaceMcpEndpointRow | null;
  }

  listEnabled(): SpaceMcpEndpointRow[] {
    return this.db.query(`
      SELECT *
      FROM space_mcp_endpoints
      WHERE enabled = 1
      ORDER BY updated_at DESC, space_id ASC
    `).all() as SpaceMcpEndpointRow[];
  }

  listAll(): SpaceMcpEndpointRow[] {
    return this.db.query(`
      SELECT *
      FROM space_mcp_endpoints
      ORDER BY updated_at DESC, space_id ASC
    `).all() as SpaceMcpEndpointRow[];
  }

  clearBySpace(spaceId: string): boolean {
    return this.db.query(`
      DELETE FROM space_mcp_endpoints
      WHERE space_id = ?
    `).run(spaceId).changes > 0;
  }

  updateHealth(input: UpdateSpaceMcpEndpointHealthInput): boolean {
    return this.db.query(`
      UPDATE space_mcp_endpoints
      SET
        health_status = ?,
        health_message = ?,
        last_connected_at = ?,
        last_error_at = ?,
        updated_at = ?
      WHERE endpoint_id = ?
    `).run(
      input.healthStatus,
      input.healthMessage?.trim() ?? "",
      input.lastConnectedAt ?? null,
      input.lastErrorAt ?? null,
      new Date().toISOString(),
      input.endpointId,
    ).changes > 0;
  }
}

