/**
 * Multi-Gateway Sync — POST-MVP STUB
 *
 * This module provides the interfaces for cross-instance event replication.
 * Implementation deferred to post-MVP. See STATUS.md for details.
 *
 * TODO: Implement after MVP
 * - Outbound queue + periodic sync timer
 * - Deduplication via DJB2 checksum with LRU-bounded set
 * - Monotonic sequence counters per peer
 * - Real HTTP/WebSocket peer communication
 */

/**
 * Represents a peer Spaceskit instance for sync operations
 */
export interface SyncPeer {
  id: string;
  url: string;
  lastSyncAt: Date | null;
  status: "connected" | "disconnected" | "syncing";
}

/**
 * Message format for cross-gateway state synchronization
 */
export interface SyncMessage {
  peerId: string;
  sequence: number;
  timestamp: string;
  eventType: string;
  payload: unknown;
  checksum: string;
}

/**
 * Configuration options for GatewaySync
 */
export interface GatewaySyncOptions {
  peerId: string;
  eventBus: unknown;
  syncIntervalMs?: number;
  maxBatchSize?: number;
  syncEventTypes?: string[];
}

/**
 * Manages synchronization across multiple Spaceskit instances — stub implementation.
 * TODO: Implement after MVP.
 */
export class GatewaySync {
  constructor(_options: GatewaySyncOptions) {
    // Post-MVP
  }

  addPeer(_id: string, _url: string): void {
    // no-op stub
  }

  removePeer(_id: string): void {
    // no-op stub
  }

  listPeers(): SyncPeer[] {
    return [];
  }

  start(): void {
    // no-op stub
  }

  stop(): void {
    // no-op stub
  }

  getOutboundQueue(): SyncMessage[] {
    return [];
  }

  handleIncomingSync(_messages: SyncMessage[]): void {
    // no-op stub
  }
}
