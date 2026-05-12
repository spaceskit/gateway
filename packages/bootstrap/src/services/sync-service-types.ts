import type { SpaceRepository } from "@spaceskit/persistence";

export interface SyncResourceRef {
  type?: string;
  id?: string;
  versionHash?: string;
  resourceType: string;
  resourceId: string;
  title?: string;
  updatedAt?: string;
  tags?: string[];
}

export interface SyncResourcePayload {
  ref: SyncResourceRef;
  content: Record<string, unknown>;
}

export interface SyncResourceDenied {
  ref: SyncResourceRef;
  reason: string;
}

export interface SyncProvenance {
  peerId: string;
  ref: SyncResourceRef;
  action: string;
  status: string;
  reason?: string;
  pulledAt: string;
}

export interface QueryResourcesInput {
  apiVersion?: string;
  peerId: string;
  resourceId?: string;
  types?: string[];
  tags?: string[];
  updatedAfter?: string;
  cursor?: string;
  limit?: number;
}

export interface QueryResourcesResult {
  resources: SyncResourceRef[];
  nextCursor?: string;
  apiVersion: string;
}

export interface PullResourcesInput {
  apiVersion?: string;
  peerId: string;
  idempotencyKey: string;
  refs: SyncResourceRef[];
}

export interface PullResourcesResult {
  resources: SyncResourcePayload[];
  denied: SyncResourceDenied[];
  provenance: SyncProvenance[];
  appliedCount: number;
  skippedCount: number;
  apiVersion: string;
}

export interface AnnouncePeerInput {
  apiVersion?: string;
  peerId: string;
  resourceId: string;
  gatewayVersion: string;
  endpointUrl?: string;
  authSecretHash?: string;
  skillCount?: number;
  actionCount?: number;
  experienceCount?: number;
  profileCount?: number;
}

export interface AnnouncePeerResult {
  peerId: string;
  resourceId: string;
  gatewayVersion: string;
  syncEnabled: boolean;
  announcedAt: string;
  apiVersion: string;
}

export interface SyncFromPeerInput {
  peerId: string;
  targetSpaceId: string;
  resourceId?: string;
  types?: string[];
  tags?: string[];
  limit?: number;
  maxPages?: number;
  idempotencyKeyPrefix?: string;
}

export interface SyncFromPeerResult {
  peerId: string;
  targetSpaceId: string;
  pages: number;
  queriedCount: number;
  pulledCount: number;
  importedCount: number;
  skippedCount: number;
  deniedCount: number;
  nextCursor?: string;
}

export interface SyncServiceLogger {
  info?: (message: string, fields?: Record<string, unknown>) => void;
  warn?: (message: string, fields?: Record<string, unknown>) => void;
  error?: (message: string, error?: unknown, fields?: Record<string, unknown>) => void;
}

export interface SyncPolicyDecision {
  allowed: boolean;
  reason?: string;
}

export interface SyncPolicyContext {
  peerId: string;
  resourceType: string;
  resourceId: string;
  artifactType?: string;
  title?: string;
  tags?: string[];
  isGeneratedBasic?: boolean;
}

export interface GatewaySyncServiceOptions {
  /** Optional repo used when importing resources from peers. */
  spaceRepo?: SpaceRepository;
  /** Default local peer ID used for outbound peer calls. */
  localPeerId?: string;
  /** Resolve plaintext shared secret for outbound requests to a specific peer. */
  resolvePeerSecret?: (peerId: string) => string | undefined;
  /** Injected fetch implementation for tests. */
  fetchImpl?: typeof fetch;
  /** Remote request timeout in milliseconds. */
  remoteTimeoutMs?: number;
  /** Enable background pull when peers announce themselves. */
  autoPullOnAnnounce?: boolean;
  /** Default target space used by auto pull. */
  autoPullTargetSpaceId?: string;
  /** Optional policy hook for query responses. */
  evaluateQueryPolicy?: (context: SyncPolicyContext) => SyncPolicyDecision;
  /** Optional policy hook for pull responses. */
  evaluatePullPolicy?: (context: SyncPolicyContext) => SyncPolicyDecision;
  logger?: SyncServiceLogger;
}

export class GatewaySyncError extends Error {
  readonly code:
    | "INVALID_ARGUMENT"
    | "NOT_FOUND"
    | "FAILED_PRECONDITION"
    | "PERMISSION_DENIED";

  constructor(
    code: GatewaySyncError["code"],
    message: string,
  ) {
    super(message);
    this.code = code;
  }
}
