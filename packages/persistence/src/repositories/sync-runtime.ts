/**
 * Sync runtime repository — peer discovery and pull idempotency.
 */

import type { Database } from "bun:sqlite";

export interface SyncPeerRow {
  peer_id: string;
  resource_id: string;
  gateway_version: string;
  endpoint_url: string;
  auth_secret_hash: string;
  sync_enabled: number;
  skill_count: number;
  action_count: number;
  experience_count: number;
  profile_count: number;
  last_announced_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface UpsertSyncPeerInput {
  peerId: string;
  resourceId: string;
  gatewayVersion: string;
  endpointUrl?: string;
  authSecretHash?: string;
  syncEnabled?: boolean;
  skillCount?: number;
  actionCount?: number;
  experienceCount?: number;
  profileCount?: number;
}

export interface SyncPullReceiptRow {
  peer_id: string;
  idempotency_key: string;
  request_hash: string;
  response_payload_json: string;
  applied_count: number;
  skipped_count: number;
  created_at: string;
}

export interface CreateSyncPullReceiptInput {
  peerId: string;
  idempotencyKey: string;
  requestHash: string;
  responsePayloadJson: string;
  appliedCount: number;
  skippedCount: number;
}

export class SyncRuntimeRepository {
  constructor(private db: Database) {}

  upsertPeer(input: UpsertSyncPeerInput): SyncPeerRow {
    const now = new Date().toISOString();
    this.db.query(`
      INSERT INTO sync_peers(
        peer_id, resource_id, gateway_version, endpoint_url, auth_secret_hash,
        sync_enabled, skill_count, action_count, experience_count, profile_count,
        last_announced_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(peer_id) DO UPDATE SET
        resource_id = excluded.resource_id,
        gateway_version = excluded.gateway_version,
        endpoint_url = excluded.endpoint_url,
        auth_secret_hash = excluded.auth_secret_hash,
        sync_enabled = excluded.sync_enabled,
        skill_count = excluded.skill_count,
        action_count = excluded.action_count,
        experience_count = excluded.experience_count,
        profile_count = excluded.profile_count,
        last_announced_at = excluded.last_announced_at,
        updated_at = excluded.updated_at
    `).run(
      input.peerId,
      input.resourceId,
      input.gatewayVersion,
      input.endpointUrl ?? "",
      input.authSecretHash ?? "",
      input.syncEnabled === false ? 0 : 1,
      input.skillCount ?? 0,
      input.actionCount ?? 0,
      input.experienceCount ?? 0,
      input.profileCount ?? 0,
      now,
      now,
      now,
    );

    return this.getPeer(input.peerId)!;
  }

  getPeer(peerId: string): SyncPeerRow | undefined {
    return this.db.query(`
      SELECT * FROM sync_peers WHERE peer_id = ?
    `).get(peerId) as SyncPeerRow | undefined ?? undefined;
  }

  listPeers(): SyncPeerRow[] {
    return this.db.query(`
      SELECT * FROM sync_peers ORDER BY updated_at DESC
    `).all() as SyncPeerRow[];
  }

  getReceipt(peerId: string, idempotencyKey: string): SyncPullReceiptRow | undefined {
    return this.db.query(`
      SELECT * FROM sync_pull_receipts
      WHERE peer_id = ? AND idempotency_key = ?
    `).get(peerId, idempotencyKey) as SyncPullReceiptRow | undefined ?? undefined;
  }

  putReceipt(input: CreateSyncPullReceiptInput): SyncPullReceiptRow {
    this.db.query(`
      INSERT INTO sync_pull_receipts(
        peer_id, idempotency_key, request_hash, response_payload_json,
        applied_count, skipped_count, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(peer_id, idempotency_key) DO UPDATE SET
        request_hash = excluded.request_hash,
        response_payload_json = excluded.response_payload_json,
        applied_count = excluded.applied_count,
        skipped_count = excluded.skipped_count
    `).run(
      input.peerId,
      input.idempotencyKey,
      input.requestHash,
      input.responsePayloadJson,
      input.appliedCount,
      input.skippedCount,
      new Date().toISOString(),
    );

    return this.getReceipt(input.peerId, input.idempotencyKey)!;
  }

  appendProvenance(input: {
    peerId: string;
    resourceType: string;
    resourceId: string;
    action: string;
    status: string;
    reason?: string;
  }): void {
    this.db.query(`
      INSERT INTO sync_provenance(
        peer_id, resource_type, resource_id, action, status, reason, pulled_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.peerId,
      input.resourceType,
      input.resourceId,
      input.action,
      input.status,
      input.reason ?? "",
      new Date().toISOString(),
    );
  }
}

