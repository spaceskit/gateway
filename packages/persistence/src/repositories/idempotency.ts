/**
 * Idempotency repository — deduplicates retried mutations by key.
 */

import type { Database } from "bun:sqlite";

export interface IdempotencyRecordRow {
  id: number;
  principal_id: string;
  endpoint: string;
  idempotency_key: string;
  request_hash: string;
  response_type: string;
  response_payload: string;
  created_at: string;
}

export interface CreateIdempotencyRecordInput {
  principalId: string;
  endpoint: string;
  idempotencyKey: string;
  requestHash: string;
  responseType: string;
  responsePayload: string;
}

export class IdempotencyRepository {
  constructor(private db: Database) {}

  get(principalId: string, endpoint: string, idempotencyKey: string): IdempotencyRecordRow | undefined {
    return this.db
      .query(`
        SELECT * FROM idempotency_records
        WHERE principal_id = ? AND endpoint = ? AND idempotency_key = ?
      `)
      .get(principalId, endpoint, idempotencyKey) as IdempotencyRecordRow | undefined ?? undefined;
  }

  put(input: CreateIdempotencyRecordInput): IdempotencyRecordRow {
    const now = new Date().toISOString();

    this.db.query(`
      INSERT INTO idempotency_records(
        principal_id, endpoint, idempotency_key,
        request_hash, response_type, response_payload, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(principal_id, endpoint, idempotency_key) DO NOTHING
    `).run(
      input.principalId,
      input.endpoint,
      input.idempotencyKey,
      input.requestHash,
      input.responseType,
      input.responsePayload,
      now,
    );

    return this.get(input.principalId, input.endpoint, input.idempotencyKey)!;
  }
}

