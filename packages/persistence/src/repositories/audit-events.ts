/**
 * Audit events repository.
 *
 * Stores security/control-plane relevant events for traceability.
 */

import type { Database } from "bun:sqlite";

export interface AuditEventRow {
  audit_event_id: string;
  event_type: string;
  actor: string;
  space_id: string;
  created_at: string;
  payload_json: string;
}

export interface CreateAuditEventInput {
  auditEventId: string;
  eventType: string;
  actor: string;
  spaceId: string;
  payload?: Record<string, unknown>;
  createdAt?: string;
}

export class AuditEventsRepository {
  constructor(private db: Database) {}

  create(input: CreateAuditEventInput): AuditEventRow {
    const createdAt = input.createdAt ?? new Date().toISOString();
    this.db.query(`
      INSERT INTO audit_events (
        audit_event_id,
        event_type,
        actor,
        space_id,
        created_at,
        payload_json
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      input.auditEventId,
      input.eventType,
      input.actor,
      input.spaceId,
      createdAt,
      JSON.stringify(input.payload ?? {}),
    );

    const row = this.get(input.auditEventId);
    if (!row) {
      throw new Error(`Failed to load audit event: ${input.auditEventId}`);
    }
    return row;
  }

  get(auditEventId: string): AuditEventRow | null {
    return this.db.query(`
      SELECT *
      FROM audit_events
      WHERE audit_event_id = ?
      LIMIT 1
    `).get(auditEventId) as AuditEventRow | null;
  }

  list(limit = 200): AuditEventRow[] {
    const normalized = Math.max(1, Math.min(1000, Math.floor(limit)));
    return this.db.query(`
      SELECT *
      FROM audit_events
      ORDER BY created_at DESC
      LIMIT ?
    `).all(normalized) as AuditEventRow[];
  }
}
