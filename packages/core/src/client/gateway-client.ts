/**
 * Spaceskit Client SDK
 *
 * Self-contained WebSocket client for connecting to Spaceskit over the
 * legacy JSON transport shim.
 * No cross-package dependencies — safe to extract into its own package.
 *
 * Canonical cross-process contracts now live in `/proto`; this file remains
 * an internal compatibility client until the runtime fully migrates.
 *
 * Features:
 * - Full WebSocket protocol support (all message types)
 * - Ed25519 challenge-response authentication via Web Crypto API
 * - Auto-reconnect with exponential backoff
 * - Request-response correlation with configurable timeout
 * - Event subscriptions with unsubscribe handlers
 */

// ---------------------------------------------------------------------------
// Ed25519 Auth Helpers
// ---------------------------------------------------------------------------

/**
 * An Ed25519 key pair for gateway authentication.
 * Generate with `generateAuthKeyPair()`, or provide your own CryptoKeyPair.
 */
export interface AuthKeyPair {
  /** Ed25519 private key (CryptoKey) */
  privateKey: CryptoKey;
  /** Ed25519 public key (CryptoKey) */
  publicKey: CryptoKey;
  /** Base64-encoded raw public key bytes (for sending to server) */
  publicKeyBase64: string;
}

/**
 * Generate a new Ed25519 key pair for gateway authentication.
 * Uses Web Crypto API — works in Bun, Node 20+, and browsers.
 */
export async function generateAuthKeyPair(): Promise<AuthKeyPair> {
  const keyPair = await crypto.subtle.generateKey(
    { name: "Ed25519" } as any,
    true, // extractable
    ["sign", "verify"],
  );

  // Export raw public key bytes → base64
  const rawPub = await crypto.subtle.exportKey("raw", keyPair.publicKey);
  const publicKeyBase64 = btoa(
    String.fromCharCode(...new Uint8Array(rawPub)),
  );

  return {
    privateKey: keyPair.privateKey,
    publicKey: keyPair.publicKey,
    publicKeyBase64,
  };
}

/**
 * Sign a base64-encoded challenge with an Ed25519 private key.
 * Returns the signature as a base64 string.
 */
export async function signChallenge(
  challengeBase64: string,
  privateKey: CryptoKey,
): Promise<string> {
  // Decode challenge from base64
  const challengeBytes = Uint8Array.from(
    atob(challengeBase64),
    (c) => c.charCodeAt(0),
  );

  // Sign with Ed25519
  const signature = await crypto.subtle.sign(
    { name: "Ed25519" } as any,
    privateKey,
    challengeBytes,
  );

  // Encode signature as base64
  return btoa(String.fromCharCode(...new Uint8Array(signature)));
}

// ---------------------------------------------------------------------------
// Protocol Types
// ---------------------------------------------------------------------------

/**
 * Message envelope for all Spaceskit protocol messages
 */
export interface GatewayMessage<T = unknown> {
  type: string;
  id: string;
  replyTo?: string;
  ts: string;
  payload: T;
}

/**
 * Client-to-Gateway: Authenticate with the gateway
 */
export interface AuthenticatePayload {
  publicKey: string;
  signature: string;
  clientType: string;
  clientVersion: string;
  deviceId?: string;
  devicePublicKey?: string;
  deviceProofSignature?: string;
}

/**
 * Client-to-Gateway: Execute a turn in a space
 */
export interface ExecuteTurnPayload {
  spaceUid: string;
  input: string;
  targetAgentId?: string;
}

/**
 * Client-to-Gateway: Resume a turn with feedback
 */
export interface ResumeFeedbackPayload {
  spaceUid: string;
  turnId: string;
  response: 'approve' | 'reject' | 'revise' | 'defer';
  revision?: string;
}

/**
 * Client-to-Gateway: Subscribe to space events
 */
export interface SubscribePayload {
  spaceUids: string[];
}

export interface SubscribeDeniedSpace {
  spaceUid: string;
  reason: string;
}

export interface SubscribeResponsePayload {
  subscribedSpaceUids: string[];
  denied: SubscribeDeniedSpace[];
}

/**
 * Client-to-Gateway: Invoke a capability
 */
export interface CapabilityInvokePayload {
  capability: string;
  method: string;
  params: Record<string, unknown>;
  targetProvider?: string;
}

/**
 * Space Admin: create a new space.
 */
export interface SpaceCreatePayload {
  apiVersion?: string;
  idempotencyKey?: string;
  spaceId?: string;
  workspaceRoot?: string;
  resourceId: string;
  spaceType?: string;
  name: string;
  goal?: string;
  turnModel?: string;
  templateId?: string;
  templateRevision?: number;
  capabilities?: string[];
  capabilityOverrides?: Record<string, string>;
  visibility?: 'shared' | 'private';
  turnModelConfig?: Record<string, unknown>;
  maxTurns?: number;
  moderatorProfileId?: string;
  initialAgents?: SpaceCreateInitialAgentPayload[];
}

/**
 * Space Admin: fetch one space by ID.
 */
export interface SpaceGetPayload {
  apiVersion?: string;
  spaceId: string;
}

/**
 * Space Admin: list spaces.
 */
export interface SpaceListPayload {
  apiVersion?: string;
  statuses?: string[];
  resourceId?: string;
  limit?: number;
}

/**
 * Space Admin: add agent assignment.
 */
export interface SpaceAddAgentPayload {
  apiVersion?: string;
  idempotencyKey?: string;
  spaceId: string;
  agentId: string;
  profileId: string;
  securityScope?: Record<string, unknown>;
  spawnContext?: string;
  contextOverrides?: Record<string, unknown>;
  role?: SpaceAssignmentRole;
  turnOrder?: number;
  isPrimary?: boolean;
}

/**
 * Space Admin: remove agent assignment.
 */
export interface SpaceRemoveAgentPayload {
  apiVersion?: string;
  idempotencyKey?: string;
  spaceId: string;
  agentId: string;
}

/**
 * Space Admin: update assignment.
 */
export interface SpaceUpdateAgentAssignmentPayload {
  apiVersion?: string;
  idempotencyKey?: string;
  spaceId: string;
  agentId: string;
  profileId?: string;
  securityScope?: Record<string, unknown> | null;
  spawnContext?: string | null;
  contextOverrides?: Record<string, unknown> | null;
  role?: SpaceAssignmentRole;
  turnOrder?: number;
  isPrimary?: boolean;
  /**
   * Force runtime usage-session replacement even when profileId remains unchanged.
   */
  resetSession?: boolean;
}

/**
 * Space Admin: set orchestrator profile.
 */
export interface SpaceSetOrchestratorPayload {
  apiVersion?: string;
  idempotencyKey?: string;
  spaceId: string;
  profileId: string;
}

/**
 * Space Admin: list assignments for one space.
 */
export interface SpaceListAgentAssignmentsPayload {
  apiVersion?: string;
  spaceId: string;
}

export interface SpaceGetMcpEndpointPayload {
  apiVersion?: string;
  spaceId: string;
}

export interface SpaceSetMcpEndpointPayload {
  apiVersion?: string;
  spaceId: string;
  transport: 'sse' | 'stdio';
  endpoint: string;
  args?: string[];
  secretRef?: string;
  enabled?: boolean;
}

export interface SpaceClearMcpEndpointPayload {
  apiVersion?: string;
  spaceId: string;
}

export interface SpaceDiscoverMcpAgentsPayload {
  apiVersion?: string;
  spaceId: string;
}

export interface SpaceApproveMcpAgentPayload {
  apiVersion?: string;
  spaceId: string;
  remoteAgentId: string;
  displayName?: string;
  agentId?: string;
  profileId?: string;
}

/**
 * Space Admin: add one skill to a space.
 */
export interface SpaceAddSkillPayload {
  apiVersion?: string;
  idempotencyKey?: string;
  spaceId: string;
  skillId: string;
}

/**
 * Space Admin: remove one skill from a space.
 */
export interface SpaceRemoveSkillPayload {
  apiVersion?: string;
  idempotencyKey?: string;
  spaceId: string;
  skillId: string;
}

/**
 * Space Admin: list all skills assigned to a space.
 */
export interface SpaceListSkillsPayload {
  apiVersion?: string;
  spaceId: string;
}

export interface SpaceWorkspace {
  spaceId: string;
  spaceUid: string;
  mode: "managed" | "folder_bound";
  explicitWorkspaceRoot?: string;
  effectiveWorkspaceRoot: string;
  metaPath: string;
  logsPath: string;
  workPath: string;
  sharedContextPath: string;
  scratchpadsPath: string;
  layoutVersion: number;
  gitRepoDetected: boolean;
  metadataStatus: "unknown" | "ready" | "conflict";
  updatedAt: string;
}

export interface SpaceGetWorkspacePayload {
  apiVersion?: string;
  spaceId: string;
}

export interface SpaceSetWorkspacePayload {
  apiVersion?: string;
  spaceId: string;
  workspaceRoot?: string | null;
}

export interface SpaceGetWorkspaceResponsePayload {
  workspace: SpaceWorkspace;
}

export interface SpaceSetWorkspaceResponsePayload {
  workspace: SpaceWorkspace;
}

export interface SpaceCreateInitialAgentPayload {
  agentId: string;
  profileId: string;
  securityScope?: Record<string, unknown>;
  spawnContext?: string;
  contextOverrides?: Record<string, unknown>;
  role?: SpaceAssignmentRole;
  turnOrder?: number;
  isPrimary?: boolean;
}

export type SpaceAssignmentRole =
  | 'participant'
  | 'global_coordinator'
  | 'space_moderator';

export interface SpaceAgentAssignment {
  spaceId: string;
  agentId: string;
  profileId: string;
  securityScope?: Record<string, unknown>;
  spawnContext?: string;
  contextOverrides?: Record<string, unknown>;
  role: SpaceAssignmentRole;
  turnOrder: number;
  isPrimary: boolean;
  assignedAt: string;
  runtimeKind?: 'local' | 'external_mcp';
  endpointId?: string;
  remoteAgentId?: string;
  displayName?: string;
}

export interface SpaceSummary {
  id: string;
  spaceUid: string;
  workspace?: SpaceWorkspace;
  resourceId: string;
  name: string;
  goal?: string;
  orchestratorProfileId?: string;
  templateId?: string;
  turnModel: string;
  turnModelConfig?: Record<string, unknown>;
  skillIds?: string[];
  agents: SpaceAgentAssignment[];
  capabilities: string[];
  capabilityOverrides: Record<string, string>;
  maxTurns?: number;
  visibility: 'shared' | 'private';
  moderatorProfileId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SpaceCreateResponsePayload {
  space: SpaceSummary;
}

export interface SpaceGetResponsePayload {
  space: SpaceSummary;
}

export interface SpaceListResponsePayload {
  spaces: SpaceSummary[];
}

export interface SpaceAddAgentResponsePayload {
  assignment: SpaceAgentAssignment;
  space?: SpaceSummary | null;
}

export interface SpaceRemoveAgentResponsePayload {
  removed: boolean;
  spaceId: string;
  spaceUid: string;
  agentId: string;
  space?: SpaceSummary | null;
}

export interface SpaceUpdateAgentAssignmentResponsePayload {
  assignment: SpaceAgentAssignment;
  space?: SpaceSummary | null;
}

export interface SpaceListAgentAssignmentsResponsePayload {
  assignments: SpaceAgentAssignment[];
}

export interface SpaceMcpEndpoint {
  endpointId: string;
  spaceId: string;
  transport: 'sse' | 'stdio';
  endpoint: string;
  args: string[];
  secretRef?: string;
  enabled: boolean;
  healthStatus: 'unknown' | 'ok' | 'degraded' | 'error';
  healthMessage?: string;
  lastConnectedAt?: string;
  lastErrorAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SpaceGetMcpEndpointResponsePayload {
  spaceId: string;
  endpoint?: SpaceMcpEndpoint;
  fallbackEnabled: boolean;
}

export interface SpaceSetMcpEndpointResponsePayload {
  endpoint: SpaceMcpEndpoint;
}

export interface SpaceClearMcpEndpointResponsePayload {
  spaceId: string;
  cleared: boolean;
}

export interface McpDiscoveredAgent {
  remoteAgentId: string;
  displayName: string;
  description?: string;
  metadata?: Record<string, unknown>;
}

export interface SpaceDiscoverMcpAgentsResponsePayload {
  spaceId: string;
  endpointId?: string;
  agents: McpDiscoveredAgent[];
}

export interface ExternalAgentRuntimeBinding {
  runtimeKind: 'external_mcp';
  spaceId: string;
  agentId: string;
  endpointId: string;
  remoteAgentId: string;
  displayName?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SpaceApproveMcpAgentResponsePayload {
  spaceId: string;
  assignment: SpaceAgentAssignment;
  binding: ExternalAgentRuntimeBinding;
}

export interface SpaceAddSkillResponsePayload {
  spaceId: string;
  spaceUid: string;
  skillId: string;
  skills: string[];
  space?: SpaceSummary | null;
}

export interface SpaceRemoveSkillResponsePayload {
  removed: boolean;
  spaceId: string;
  spaceUid: string;
  skillId: string;
  skills: string[];
  space?: SpaceSummary | null;
}

export interface SpaceListSkillsResponsePayload {
  spaceId: string;
  spaceUid: string;
  skills: string[];
}

export interface SpaceResource {
  resourceId: string;
  spaceId: string;
  spaceUid: string;
  uri: string;
  type: 'folder' | 'url';
  label?: string;
  addedAt: string;
}

export interface SpaceAddResourcePayload {
  apiVersion?: string;
  idempotencyKey?: string;
  resourceId?: string;
  spaceId: string;
  uri: string;
  type: 'folder' | 'url';
  label?: string;
}

export interface SpaceRemoveResourcePayload {
  apiVersion?: string;
  idempotencyKey?: string;
  spaceId: string;
  resourceId: string;
}

export interface SpaceListResourcesPayload {
  apiVersion?: string;
  spaceId: string;
}

export interface SpaceAddResourceResponsePayload {
  resource: SpaceResource;
}

export interface SpaceRemoveResourceResponsePayload {
  removed: boolean;
  spaceId: string;
  spaceUid: string;
  resourceId: string;
}

export interface SpaceListResourcesResponsePayload {
  spaceId: string;
  spaceUid: string;
  resources: SpaceResource[];
}

export interface SpaceListOrchestrationJournalPayload {
  apiVersion?: string;
  spaceId?: string;
  spaceUid?: string;
  turnId?: string;
  limit?: number;
  offset?: number;
}

export interface OrchestrationJournalEntry {
  eventId: string;
  spaceId: string;
  spaceUid: string;
  turnId?: string;
  seq: number;
  eventType: string;
  actorId: string;
  lineageId?: string;
  hopCount: number;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface SpaceListOrchestrationJournalResponsePayload {
  spaceId: string;
  spaceUid: string;
  entries: OrchestrationJournalEntry[];
  total: number;
  nextOffset?: number;
}

export interface ProfileModelConfig {
  preferredModels: string[];
  fallbackModels?: string[];
  constraints?: Record<string, unknown>;
}

export interface ProfileSummary {
  profileId: string;
  name: string;
  description: string;
  personalityPrompt: string;
  defaultSkillIds: string[];
  providerHint?: string;
  modelHint?: string;
  modelConfig?: ProfileModelConfig;
  canModerate: boolean;
  isDefault: boolean;
  status: 'active' | 'archived';
  activeRevision: number;
  source: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProfileCreatePayload {
  apiVersion?: string;
  idempotencyKey?: string;
  profileId?: string;
  name: string;
  description?: string;
  personalityPrompt?: string;
  defaultSkillIds?: string[];
  providerHint?: string;
  modelHint?: string;
  modelConfig?: ProfileModelConfig;
  canModerate?: boolean;
  isDefault?: boolean;
}

export interface ProfileCreateResponsePayload {
  profile: ProfileSummary;
  created: boolean;
}

export interface ProfileGetPayload {
  apiVersion?: string;
  profileId: string;
}

export interface ProfileGetResponsePayload {
  profile: ProfileSummary;
}

export interface ProfileListPayload {
  apiVersion?: string;
  includeArchived?: boolean;
}

export interface ProfileListResponsePayload {
  profiles: ProfileSummary[];
}

export interface ProfileUpdatePayload {
  apiVersion?: string;
  idempotencyKey?: string;
  profileId: string;
  name?: string;
  description?: string;
  personalityPrompt?: string;
  defaultSkillIds?: string[];
  providerHint?: string;
  modelHint?: string;
  modelConfig?: ProfileModelConfig;
  canModerate?: boolean;
  isDefault?: boolean;
}

export interface ProfileUpdateResponsePayload {
  profile: ProfileSummary;
  newRevision: number;
}

export interface ProfileArchivePayload {
  apiVersion?: string;
  idempotencyKey?: string;
  profileId: string;
}

export interface ProfileArchiveResponsePayload {
  profile: ProfileSummary;
  archived: boolean;
}

export type PresetKind = 'agent' | 'space';
export type PresetSource = 'system' | 'user';
export type CommunicationMode = 'async_notes' | 'chat_first' | 'structured_handoff';

export interface TemplateAgentDefinition {
  agentId: string;
  profileId: string;
  role?: SpaceAssignmentRole;
  turnOrder?: number;
  isPrimary?: boolean;
}

export interface SpacePresetConfig {
  communicationMode: CommunicationMode;
  turnModel: string;
  baseAgents: TemplateAgentDefinition[];
  agentPresetIds: string[];
}

export interface AgentPresetConfig {
  defaultAgents: TemplateAgentDefinition[];
}

export interface PresetSummary {
  presetId: string;
  kind: PresetKind;
  title: string;
  description: string;
  source: PresetSource;
  version: number;
  tags: string[];
}

export interface PresetDetail extends PresetSummary {
  spacePreset?: SpacePresetConfig;
  agentPreset?: AgentPresetConfig;
}

export interface PresetListPayload {
  apiVersion?: string;
  kind?: PresetKind | 'all';
  source?: PresetSource | 'all';
  tags?: string[];
}

export interface PresetGetPayload {
  apiVersion?: string;
  presetId: string;
}

export interface PresetApplyToSpacePayload {
  apiVersion?: string;
  idempotencyKey?: string;
  presetId: string;
  targetSpaceId?: string;
  spaceId?: string;
  resourceId?: string;
  name?: string;
  goal?: string;
  visibility?: 'shared' | 'private';
  workspaceRoot?: string;
}

export interface PresetApplyToSpaceResult {
  applicationId: string;
  presetId: string;
  spaceId: string;
  createdSpace: boolean;
  appliedAgents: number;
  skippedAgents: number;
  appliedAt: string;
  space: SpaceSummary;
}

export interface SpaceTemplateSummary {
  templateId: string;
  title: string;
  communicationMode: CommunicationMode;
  agentPresetIds: string[];
  createdBy: string;
  updatedAt: string;
}

export interface SpacePreviewTemplatePayload {
  apiVersion?: string;
  templateId: string;
  resourceId?: string;
  name?: string;
  goal?: string;
}

export interface SpacePreviewTemplateResult {
  template: SpaceTemplateSummary;
  resolved: {
    templateId: string;
    templateRevision: number;
    name: string;
    goal?: string;
    resourceId: string;
    communicationMode: CommunicationMode;
    turnModel: string;
    initialAgents: TemplateAgentDefinition[];
  };
  warnings: string[];
}

export interface SpaceCreateFromTemplatePayload {
  apiVersion?: string;
  idempotencyKey?: string;
  templateId: string;
  spaceId?: string;
  resourceId: string;
  name?: string;
  goal?: string;
  visibility?: 'shared' | 'private';
  workspaceRoot?: string;
}

export interface SpaceCreateFromTemplateResult {
  template: SpaceTemplateSummary;
  space: SpaceSummary;
}

export interface SpaceSaveTemplatePayload {
  apiVersion?: string;
  templateId?: string;
  title: string;
  description?: string;
  communicationMode?: CommunicationMode;
  baseAgents?: TemplateAgentDefinition[];
  agentPresetIds?: string[];
  sourceSpaceId?: string;
  tags?: string[];
}

export interface SpaceSaveTemplateResult {
  template: SpaceTemplateSummary;
  created: boolean;
}

export interface DeviceIdentity {
  deviceId: string;
  principalId: string;
  publicKey: string;
  platform?: string;
  keyVersion: string;
  status: 'active' | 'revoked' | 'rotated';
  createdAt: string;
  updatedAt: string;
  lastSeenAt?: string;
  revokedAt?: string;
}

export interface AuthRegisterDevicePayload {
  apiVersion?: string;
  deviceId: string;
  publicKey: string;
  platform?: string;
}

export interface AuthRegisterDeviceResult {
  device: DeviceIdentity;
  created: boolean;
}

export interface AuthRotateDeviceKeyPayload {
  apiVersion?: string;
  deviceId: string;
  nextPublicKey: string;
  platform?: string;
}

export interface AuthRotateDeviceKeyResult {
  device: DeviceIdentity;
}

export interface AuthRevokeDevicePayload {
  apiVersion?: string;
  deviceId: string;
}

export interface AuthRevokeDeviceResult {
  deviceId: string;
  revoked: boolean;
  device?: DeviceIdentity;
}

export interface AuthListDevicesPayload {
  apiVersion?: string;
  includeRevoked?: boolean;
}

export interface AuthIssueHttpPrincipalTokenPayload {
  apiVersion?: string;
  ttlSeconds?: number;
}

export interface AuthIssueHttpPrincipalTokenResult {
  token: string;
  tokenType: 'Bearer';
  principalId: string;
  deviceId?: string;
  issuedAt: string;
  expiresAt: string;
  ttlSeconds: number;
}

/**
 * Adapter -> Gateway: Register one or more native capability providers.
 */
export interface CapabilitiesRegisterPayload {
  providers: AdapterCapabilityProvider[];
}

/**
 * Adapter -> Gateway: Deregister one or more native capability providers.
 */
export interface CapabilitiesDeregisterPayload {
  providerIds: string[];
}

/**
 * Shared provider descriptor used by adapter registration.
 */
export interface AdapterCapabilityProvider {
  id: string;
  name: string;
  source: 'adapter';
  capabilityType: string;
  operations: string[];
}

/**
 * Gateway -> Adapter: Invoke a native capability.
 */
export interface AdapterCapabilityInvokePayload {
  invocationId: string;
  capability: string;
  operation: string;
  args: Record<string, unknown>;
  targetProvider?: string;
}

/**
 * Adapter -> Gateway: Invocation success payload.
 */
export interface AdapterCapabilityResultPayload {
  invocationId: string;
  providerId: string;
  data: unknown;
  durationMs?: number;
}

/**
 * Adapter -> Gateway: Invocation failure payload.
 */
export interface AdapterCapabilityErrorPayload {
  invocationId: string;
  providerId?: string;
  code?: string;
  message: string;
  details?: unknown;
}

/**
 * Inter-Agent: Direct message between agents in a space
 */
export interface AgentMessagePayload {
  spaceId: string;
  spaceUid: string;
  fromAgentId: string;
  /** Target agent ID. Use "*" to broadcast to all agents in the space. */
  toAgentId: string;
  content: string;
}

/**
 * Inter-Agent: Poke an idle agent to resume work
 */
export interface AgentPokePayload {
  spaceId: string;
  spaceUid: string;
  targetAgentId: string;
  reason: string;
  unblockedByTurnId?: string;
}

/**
 * Inter-Agent: Agent idle notification
 */
export interface AgentIdlePayload {
  spaceId: string;
  spaceUid: string;
  agentId: string;
  idleDurationMs: number;
  lastTurnId?: string;
}

/**
 * Inter-Agent: Declare a task dependency between turns
 */
export interface TaskDependencyPayload {
  spaceId: string;
  spaceUid: string;
  blockedTurnId: string;
  dependsOnTurnId: string;
}

/**
 * Inter-Agent: Task dependency resolved notification
 */
export interface TaskDependencyResolvedPayload {
  spaceId: string;
  spaceUid: string;
  unblockedTurnId: string;
  resolvedByTurnId: string;
}

/**
 * Gateway-to-Client: Authentication challenge
 */
export interface AuthChallengePayload {
  challenge?: string;
  success: boolean;
  reason?: string;
}

/**
 * Gateway-to-Client: Authentication result
 */
export interface AuthResultPayload {
  success: boolean;
  reason?: string;
  challenge?: string;
}

/**
 * Gateway-to-Client: Turn event notification
 */
export interface TurnEventPayload {
  spaceId: string;
  spaceUid: string;
  turnId: string;
  eventType: string;
  data: unknown;
}

/**
 * Gateway-to-Client: Turn stream (delta) data
 */
export interface TurnStreamPayload {
  spaceId: string;
  spaceUid: string;
  turnId: string;
  agentId: string;
  delta: string;
  seq: number;
  done: boolean;
}

/**
 * Gateway-to-Client: Space state update
 */
export interface SpaceStatePayload {
  spaceId: string;
  spaceUid: string;
  state: string;
  turnCount: number;
  activeAgentId?: string;
  pendingFeedback: number;
}

/**
 * Gateway-to-Client: Notification
 */
export interface NotificationPayload {
  notificationId: string;
  category: string;
  severity: 'info' | 'warning' | 'error' | 'critical';
  title: string;
  body: string;
  spaceId?: string;
  spaceUid?: string;
  agentId?: string;
  data?: Record<string, unknown>;
  createdAt: string;
}

export interface SpaceAgentUpdatedEventPayload {
  spaceId: string;
  spaceUid: string;
  agentId: string;
  oldProfileId: string;
  newProfileId: string;
  updatedAt: string;
}

/**
 * Gateway-to-Client: Error response
 */
export interface ErrorPayload {
  code: string;
  message: string;
  details?: unknown;
  retryable?: boolean;
  correlationId?: string;
}

export interface UsageWindowSummary {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  spentUsd: number;
  tokenAccuracy: 'reported' | 'estimated' | 'mixed';
  usageSource: 'ledger' | 'local_scanner' | 'legacy_turns';
}

export interface BudgetSummary {
  softCapUsd: number;
  hardCapUsd: number;
  warningThreshold: number;
  spentUsd: number;
  leftUsd: number;
}

export interface ProviderUsageSnapshot {
  providerId: string;
  status: 'available' | 'unavailable' | 'unknown';
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  spentUsd: number;
  tokenAccuracy: 'reported' | 'estimated' | 'mixed';
  usageSource: 'ledger' | 'local_scanner' | 'legacy_turns';
  message?: string;
}

export interface VoiceUsageWindowSummary {
  sttSeconds: number;
  ttsChars: number;
  ttsSeconds: number;
  estimatedCostUsd: number;
}

export interface VoiceUsageSourceSummary extends VoiceUsageWindowSummary {
  source: 'managed' | 'byok' | 'local_model' | 'apple_speech' | 'unknown';
}

export interface VoiceUsageLockSummary {
  enabled: boolean;
  managedSttSecondsMonthlyLimit?: number;
  managedTtsCharsMonthlyLimit?: number;
  managedTtsSecondsMonthlyLimit?: number;
  managedCurrentMonthSttSeconds?: number;
  managedCurrentMonthTtsChars?: number;
  managedCurrentMonthTtsSeconds?: number;
}

export interface VoiceUsageSnapshot {
  windows: {
    last5h: VoiceUsageWindowSummary;
    last7d: VoiceUsageWindowSummary;
    last30d: VoiceUsageWindowSummary;
    lifetime: VoiceUsageWindowSummary;
  };
  bySource: VoiceUsageSourceSummary[];
  lock?: VoiceUsageLockSummary;
}

export interface UsageSnapshot {
  computedAt: string;
  currency: 'USD';
  windows: {
    last5h: UsageWindowSummary;
    last7d: UsageWindowSummary;
    last30d: UsageWindowSummary;
    lifetime: UsageWindowSummary;
  };
  budget: BudgetSummary;
  providerUsage: ProviderUsageSnapshot[];
  voice?: VoiceUsageSnapshot;
}

export interface GatewayPolicy {
  allowedCapabilityTypes: string[];
  deniedCapabilityTypes: string[];
  allowedSkillIds: string[];
  deniedSkillIds: string[];
  globalFlags: Record<string, unknown>;
  updatedAt: string;
}

export interface GatewayPolicyUpdatePayload {
  apiVersion?: string;
  allowedCapabilityTypes?: string[];
  deniedCapabilityTypes?: string[];
  allowedSkillIds?: string[];
  deniedSkillIds?: string[];
  globalFlags?: Record<string, unknown>;
}

export interface GatewayFactoryResetPayload {
  apiVersion?: string;
  confirmation: string;
}

export interface GatewayFactoryResetResult {
  gatewayId: string;
  gatewayUuid?: string;
  resetAt: string;
  tablesCleared: number;
  rowsDeleted: number;
}

export interface SpaceResetPayload {
  apiVersion?: string;
  spaceId: string;
}

export interface SpaceResetResult {
  spaceId: string;
  resetAt: string;
  tablesCleared: number;
  rowsDeleted: number;
}

export type GatewayKnowledgeBaseEntryKind = "web" | "file" | "folder";
export type GatewayKnowledgeBaseScopeType = "global" | "space";

export interface GatewayKnowledgeBaseEntry {
  entryId: string;
  name: string;
  kind: GatewayKnowledgeBaseEntryKind;
  uri: string;
  description?: string;
  tags: string[];
  scopeType: GatewayKnowledgeBaseScopeType;
  spaceId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface GatewayListKnowledgeBaseEntriesPayload {
  apiVersion?: string;
  spaceId?: string;
  query?: string;
  tags?: string[];
  kinds?: GatewayKnowledgeBaseEntryKind[];
  limit?: number;
}

export interface GatewayUpsertKnowledgeBaseEntryPayload {
  apiVersion?: string;
  entryId?: string;
  name: string;
  kind: GatewayKnowledgeBaseEntryKind;
  uri: string;
  description?: string;
  tags?: string[];
  scopeType: GatewayKnowledgeBaseScopeType;
  spaceId?: string;
}

export interface GatewayDeleteKnowledgeBaseEntryPayload {
  apiVersion?: string;
  entryId: string;
}

export interface OrchestratorCommandPayload {
  apiVersion?: string;
  correlationId?: string;
  idempotencyKey?: string;
  commandType:
    | 'list_rooms'
    | 'create_room'
    | 'list_skills'
    | 'create_skill'
    | 'handoff_room'
    | 'add_agent'
    | 'share_context'
    | 'run_space_prompt';
  targetSpaceId: string;
  targetAgentId?: string;
  payload?: Record<string, unknown>;
}

export interface OrchestratorCommandEvent {
  status: 'accepted' | 'running' | 'completed' | 'failed';
  event: Record<string, unknown>;
  createdAt: string;
}

export interface OrchestratorCommandResult {
  commandId: string;
  correlationId: string;
  apiVersion: string;
  commandType: string;
  targetSpaceId: string;
  targetAgentId?: string;
  status: 'accepted' | 'running' | 'completed' | 'failed';
  result?: Record<string, unknown>;
  error?: { code: string; message: string };
  createdAt: string;
  updatedAt: string;
  events: OrchestratorCommandEvent[];
}

export interface OrchestratorSummaryParticipant {
  agentId: string;
  turnOrder: number;
  isPrimary: boolean;
  status: 'pending' | 'completed' | 'failed';
  promptTokens: number;
  completionTokens: number;
  finalMessage?: string;
  error?: string;
}

export interface OrchestratorSummaryHighlight {
  agentId: string;
  eventType: 'text_delta' | 'turn_completed' | 'error' | 'feedback_requested';
  text: string;
  timestamp: string;
}

export interface OrchestratorSummaryArtifact {
  summaryId: string;
  version: string;
  spaceId: string;
  turnId: string;
  turnModel: string;
  generatedAt: string;
  status: 'completed' | 'degraded';
  failureReason?: string;
  participants: OrchestratorSummaryParticipant[];
  highlights: OrchestratorSummaryHighlight[];
  finalSummaryText: string;
}

export interface OrchestratorEventPayload {
  commandId: string;
  correlationId: string;
  status: 'accepted' | 'running' | 'completed' | 'failed';
  event: Record<string, unknown>;
  createdAt: string;
  eventType?: string;
  spaceId?: string;
  spaceUid?: string;
  turnId?: string;
}

export type SchedulerJobStatus = 'active' | 'paused' | 'invalid';
export type SchedulerRunStatus = 'running' | 'completed' | 'failed' | 'skipped';
export type SchedulerRunTrigger = 'scheduled' | 'manual';
export type SchedulerScheduleKind = 'hourly' | 'daily' | 'weekly';
export type SchedulerActionType = 'space_prompt';

export interface SchedulerSchedulePreset {
  kind: SchedulerScheduleKind;
  intervalHours?: number;
  minute: number;
  hour?: number;
  daysOfWeek?: number[];
}

export interface SchedulerAction {
  type: SchedulerActionType;
  promptText: string;
  targetAgentId?: string;
}

export interface SchedulerLinkedSpace {
  spaceId: string;
  spaceUid: string;
  name: string;
  isPrimary: boolean;
  linkedAt: string;
}

export interface SchedulerJob {
  jobId: string;
  name: string;
  status: SchedulerJobStatus;
  enabled: boolean;
  cronExpression: string;
  schedulePreset: SchedulerSchedulePreset;
  timezone: string;
  action: SchedulerAction;
  primarySpaceId?: string;
  invalidReason?: string;
  nextRunAt?: string;
  lastRunAt?: string;
  lastRunStatus?: SchedulerRunStatus;
  lastErrorCode?: string;
  lastErrorMessage?: string;
  createdByPrincipalId: string;
  createdAt: string;
  updatedAt: string;
  linkedSpaces: SchedulerLinkedSpace[];
}

export interface SchedulerJobRun {
  runId: string;
  jobId: string;
  trigger: SchedulerRunTrigger;
  status: SchedulerRunStatus;
  commandId?: string;
  scheduledFor?: string;
  startedAt?: string;
  finishedAt?: string;
  skipReason?: string;
  errorCode?: string;
  errorMessage?: string;
  result?: Record<string, unknown>;
}

export interface SchedulerCreateJobPayload {
  apiVersion?: string;
  idempotencyKey?: string;
  name: string;
  timezone: string;
  schedulePreset: SchedulerSchedulePreset;
  action: SchedulerAction;
  primarySpaceId: string;
  relatedSpaceIds?: string[];
}

export interface SchedulerGetJobPayload {
  apiVersion?: string;
  jobId: string;
}

export interface SchedulerListJobsPayload {
  apiVersion?: string;
  statuses?: SchedulerJobStatus[];
  gatewayId?: string;
  limit?: number;
}

export interface SchedulerUpdateJobPayload {
  apiVersion?: string;
  idempotencyKey?: string;
  jobId: string;
  name?: string;
  status?: SchedulerJobStatus;
  timezone?: string;
  schedulePreset?: SchedulerSchedulePreset;
  action?: SchedulerAction;
  primarySpaceId?: string | null;
  relatedSpaceIds?: string[];
}

export interface SchedulerDeleteJobPayload {
  apiVersion?: string;
  idempotencyKey?: string;
  jobId: string;
}

export interface SchedulerDeleteJobResult {
  jobId: string;
  deleted: boolean;
}

export interface SchedulerLinkSpacePayload {
  apiVersion?: string;
  idempotencyKey?: string;
  jobId: string;
  spaceId: string;
}

export interface SchedulerUnlinkSpacePayload {
  apiVersion?: string;
  idempotencyKey?: string;
  jobId: string;
  spaceId: string;
}

export interface SchedulerListRunsPayload {
  apiVersion?: string;
  jobId: string;
  limit?: number;
  offset?: number;
}

export interface SchedulerListRunsResult {
  runs: SchedulerJobRun[];
  total: number;
  nextOffset?: number;
}

export interface SchedulerRunNowPayload {
  apiVersion?: string;
  idempotencyKey?: string;
  jobId: string;
}

export interface SchedulerRunNowResult {
  run: SchedulerJobRun;
  job: SchedulerJob;
}

export interface SpaceLinkPayload {
  apiVersion?: string;
  sourceSpaceId: string;
  targetSpaceId: string;
  mode?: string;
}

export interface SpaceLinkResult {
  sourceSpaceId: string;
  targetSpaceId: string;
  mode: string;
  createdAt: string;
  updatedAt: string;
}

export interface SpaceUnlinkPayload {
  apiVersion?: string;
  sourceSpaceId: string;
  targetSpaceId: string;
}

export interface SpaceShareContextPayload {
  apiVersion?: string;
  sourceSpaceId: string;
  targetSpaceId: string;
  artifactId: string;
}

export type SpaceShareAccessMode = 'read_only' | 'collaborator';
export type SpaceShareJoinRoute = 'direct' | 'relay_proxy';

export interface SpaceInviteLink {
  version: 'v2';
  relayInviteId: string;
  relayUrl: string;
  spaceIdHint?: string;
  spaceUidHint?: string;
  fallbackGatewayUrl?: string;
}

export interface SpaceShareInvite {
  inviteId: string;
  spaceId: string;
  issuedByPrincipalId: string;
  mode: SpaceShareAccessMode;
  status: 'active' | 'used' | 'revoked' | 'expired';
  expiresAt?: string;
  createdAt: string;
  updatedAt: string;
  inviteToken?: string;
  inviteLink?: SpaceInviteLink;
}

export interface SpaceParticipant {
  participantId: string;
  spaceId: string;
  principalId: string;
  principalType: string;
  mode: SpaceShareAccessMode;
  status: 'active' | 'revoked';
  joinedViaInviteId?: string;
  deviceId?: string;
  devicePublicKey?: string;
  joinedAt: string;
  updatedAt: string;
  revokedAt?: string;
}

export interface SpaceShareCreateInvitePayload {
  apiVersion?: string;
  spaceId: string;
  mode: SpaceShareAccessMode;
  expiresInSeconds?: number;
}

export interface SpaceShareJoinPayload {
  apiVersion?: string;
  spaceId: string;
  inviteToken: string;
  deviceId?: string;
  devicePublicKey?: string;
  identityModeHint?: 'device_key' | 'strict_apple_id';
  appleIdAssertion?: string;
  joinRoute?: SpaceShareJoinRoute;
  relaySessionToken?: string;
}

export interface SpaceShareRevokePayload {
  apiVersion?: string;
  spaceId: string;
  inviteId?: string;
  participantId?: string;
}

export interface SpaceShareRevokeResult {
  spaceId: string;
  inviteId?: string;
  participantId?: string;
  revokedInvite: boolean;
  revokedParticipant: boolean;
}

export interface SpaceShareListParticipantsPayload {
  apiVersion?: string;
  spaceId: string;
}

export type ChangeSetStatus =
  | "draft"
  | "uploaded"
  | "pending_review"
  | "approved"
  | "applied"
  | "rejected"
  | "expired";

export type ChangeSetAdapter = "filesystem" | "git";

export interface ChangeSet {
  changeSetId: string;
  spaceId: string;
  participantId?: string;
  createdByPrincipalId: string;
  status: ChangeSetStatus;
  title?: string;
  description?: string;
  adapter: ChangeSetAdapter;
  targetBranch?: string;
  workspaceBasePath?: string;
  submittedAt?: string;
  reviewedAt?: string;
  appliedAt?: string;
  expiresAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChangeSetFile {
  relativePath: string;
  stagedPath: string;
  sha256: string;
  sizeBytes: number;
  changeType: "added" | "modified" | "deleted";
  createdAt: string;
}

export interface ChangeSetReview {
  reviewId: string;
  changeSetId: string;
  reviewerPrincipalId: string;
  decision: "approved" | "rejected";
  comment?: string;
  diffSummary?: Record<string, unknown>;
  createdAt: string;
}

export interface ChangeSetApplyResult {
  changeSetId: string;
  adapter: ChangeSetAdapter;
  appliedPaths: string[];
  rollbackPath: string;
  git?: {
    attempted: boolean;
    commitMessage: string;
    commitHash?: string;
    warning?: string;
  };
}

export interface SpaceCreateChangeSetPayload {
  apiVersion?: string;
  spaceId: string;
  title?: string;
  description?: string;
  adapter?: ChangeSetAdapter;
  targetBranch?: string;
  expiresInSeconds?: number;
}

export interface SpaceListChangeSetsPayload {
  apiVersion?: string;
  spaceId: string;
  statuses?: ChangeSetStatus[];
  limit?: number;
  offset?: number;
}

export interface SpaceUploadChangeSetFileInitPayload {
  apiVersion?: string;
  spaceId: string;
  changeSetId: string;
  relativePath: string;
}

export interface SpaceUploadChangeSetFileCompletePayload {
  apiVersion?: string;
  spaceId: string;
  changeSetId: string;
  uploadId: string;
  contentBase64?: string;
  sourcePath?: string;
  expectedSha256?: string;
}

export interface SpaceSubmitChangeSetPayload {
  apiVersion?: string;
  spaceId: string;
  changeSetId: string;
}

export interface SpaceReviewChangeSetPayload {
  apiVersion?: string;
  spaceId: string;
  changeSetId: string;
  decision: "approved" | "rejected";
  comment?: string;
}

export interface SpaceApplyChangeSetPayload {
  apiVersion?: string;
  spaceId: string;
  changeSetId: string;
}

export interface SpaceChangeSetDiffPayload {
  apiVersion?: string;
  spaceId: string;
  changeSetId: string;
}

export interface SpaceChangeSetDiffResult {
  changeSetId: string;
  unifiedDiff: string;
  files: Array<{
    relativePath: string;
    changeType: string;
    sizeBytes: number;
  }>;
  generatedAt: string;
}

export interface SpaceQuotaPolicy {
  spaceId: string;
  maxStagingBytes: number;
  maxOpenChangeSets: number;
  maxAppliedChangeSetsPerMonth: number;
  tokenBudget: number;
  maxParticipantStagingBytes: number;
  maxUploadsPerDay: number;
  maxOpenChangeSetsPerParticipant: number;
  maxToolCallsPerHour: number;
  updatedBy: string;
  updatedAt: string;
}

export interface ParticipantQuotaPolicy {
  spaceId: string;
  principalId: string;
  maxStagingBytes: number;
  maxUploadsPerDay: number;
  maxOpenChangeSets: number;
  maxToolCallsPerHour: number;
  updatedBy: string;
  updatedAt: string;
}

export interface SpaceUsageSnapshot {
  spaceId: string;
  stagingBytes: number;
  openChangeSets: number;
  appliedChangeSetsPerMonth: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  tokenSpendUsd: number;
  tokenAccuracy: 'reported' | 'estimated' | 'mixed';
  usageSource: 'ledger' | 'local_scanner' | 'legacy_turns';
  updatedAt: string;
}

export interface ParticipantUsageSnapshot {
  spaceId: string;
  principalId: string;
  stagingBytes: number;
  uploadsToday: number;
  openChangeSets: number;
  toolCallsPerHour: number;
  updatedAt: string;
}

export interface SpaceGetQuotaPayload {
  apiVersion?: string;
  spaceId: string;
}

export interface SpaceUpdateQuotaPolicyPayload {
  apiVersion?: string;
  spaceId: string;
  maxStagingBytes?: number;
  maxOpenChangeSets?: number;
  maxAppliedChangeSetsPerMonth?: number;
  tokenBudget?: number;
  maxParticipantStagingBytes?: number;
  maxUploadsPerDay?: number;
  maxOpenChangeSetsPerParticipant?: number;
  maxToolCallsPerHour?: number;
}

export interface SpaceGetUsagePayload {
  apiVersion?: string;
  spaceId: string;
  includeAgentSessions?: boolean;
  includeGlobalLifetime?: boolean;
}

export interface AgentUsageSession {
  sessionId: string;
  spaceId: string;
  agentId: string;
  agentRole: string;
  status: "active" | "closed";
  startedAt: string;
  endedAt?: string;
  lastActivityAt: string;
  turnCount: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  spentUsd: number;
  tokenAccuracy: 'reported' | 'estimated' | 'mixed';
  usageSource: 'ledger' | 'local_scanner' | 'legacy_turns';
}

export interface TurnTraceEvent {
  eventId: string;
  seq: number;
  eventType: string;
  eventSubtype?: string;
  agentId?: string;
  createdAt: string;
  payload: Record<string, unknown>;
}

export interface TurnTraceToolCall {
  toolCallId: string;
  toolName?: string;
  status: "started" | "completed" | "error";
  agentId?: string;
  startedAt?: string;
  completedAt?: string;
}

export interface TurnTrace {
  spaceId: string;
  turnId: string;
  total: number;
  events: TurnTraceEvent[];
  toolCalls: TurnTraceToolCall[];
  artifactIds: string[];
}

export interface SpaceGetTurnTracePayload {
  apiVersion?: string;
  spaceId: string;
  turnId: string;
  limit?: number;
  offset?: number;
}

export interface SpaceListArtifactsPayload {
  apiVersion?: string;
  spaceId: string;
  turnId?: string;
  limit?: number;
  offset?: number;
}

export interface SpaceGetArtifactPayload {
  apiVersion?: string;
  spaceId: string;
  artifactId: string;
}

export interface SpaceArtifactSummary {
  artifactId: string;
  spaceId: string;
  turnId?: string;
  agentId?: string;
  type: string;
  title: string;
  mimeType?: string;
  sizeBytes: number;
  tags: string[];
  visibility: "shared" | "private";
  createdAt: string;
  updatedAt: string;
}

export interface SpaceArtifactDetail extends SpaceArtifactSummary {
  content: string | Record<string, unknown>;
}

export interface SpaceResetAgentUsageSessionPayload {
  apiVersion?: string;
  spaceId: string;
  agentId: string;
}

export interface ToolDenyReason {
  code: string;
  message: string;
}

export interface EffectiveToolOperation {
  operationId: string;
  capability: string;
  operation: string;
  providerIds: string[];
  allowed: boolean;
  denyReasons: ToolDenyReason[];
}

export interface EffectiveToolMatrix {
  spaceId: string;
  principalId?: string;
  deviceId?: string;
  agentId?: string;
  policyVersion: string;
  operations: EffectiveToolOperation[];
  generatedAt: string;
}

export interface SpaceGetEffectiveToolsPayload {
  apiVersion?: string;
  spaceId: string;
  agentId?: string;
}

export interface SharedContextRef {
  transferId: string;
  sourceSpaceId: string;
  targetSpaceId: string;
  artifactId: string;
  status: 'shared' | 'imported' | 'denied';
  denialReason?: string;
  createdAt: string;
  appliedAt?: string;
}

export interface SpacePullSharedContextPayload {
  apiVersion?: string;
  sourceSpaceId: string;
  targetSpaceId: string;
  limit?: number;
}

export interface SpacePullSharedContextResult {
  importedArtifacts: Array<{ sourceArtifactId: string; importedArtifactId: string }>;
  denied: Array<{ transferId: string; reason: string }>;
}

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

export interface SyncResource {
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

export interface SyncAnnouncePayload {
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

export interface SyncAnnounceResult {
  peerId: string;
  resourceId: string;
  gatewayVersion: string;
  syncEnabled: boolean;
  announcedAt: string;
  apiVersion?: string;
}

export interface SyncQueryResourcesPayload {
  apiVersion?: string;
  peerId: string;
  resourceId?: string;
  types?: string[];
  tags?: string[];
  updatedAfter?: string;
  cursor?: string;
  limit?: number;
}

export interface SyncQueryResourcesResult {
  resources: SyncResourceRef[];
  nextCursor?: string;
  apiVersion?: string;
}

export interface SyncPullResourcesPayload {
  apiVersion?: string;
  peerId: string;
  idempotencyKey: string;
  refs: SyncResourceRef[];
}

export interface SyncPullResourcesResult {
  resources: SyncResource[];
  denied: SyncResourceDenied[];
  provenance?: SyncProvenance[];
  appliedCount: number;
  skippedCount: number;
  apiVersion?: string;
}

export interface SpeechUsageMetricsPayload {
  sttSeconds: number;
  ttsChars: number;
  ttsSeconds: number;
}

export interface SpeechStartPayload {
  apiVersion?: string;
  spaceId: string;
  spaceUid: string;
  sessionId?: string;
  locale?: string;
  sourceDevice?: string;
  enableTranscription?: boolean;
  enablePlayback?: boolean;
  agentId?: string;
  autoSubmitTurns?: boolean;
  preferredSource?: 'managed' | 'byok' | 'local_model' | 'apple_speech';
  preferredProviderId?: string;
  byokProviderId?: string;
  localModelProviderId?: string;
  appleSpeechProviderId?: string;
  allowByokFallback?: boolean;
  allowLocalFallback?: boolean;
  allowAppleSpeechFallback?: boolean;
}

export interface SpeechAudioChunkPayload {
  apiVersion?: string;
  sessionId: string;
  sequenceNo?: number;
  sequence: number;
  audioBase64: string;
  sampleRateHz?: number;
  channels?: number;
  codec?: string;
  audioDurationSeconds?: number;
  ttsChars?: number;
  ttsSeconds?: number;
  transcriptText?: string;
  isFinal?: boolean;
}

export interface SpeechControlPayload {
  apiVersion?: string;
  sessionId: string;
  command: 'stop' | 'interrupt' | 'end';
  reason?: string;
}

export interface SpeechEventPayload {
  sessionId: string;
  spaceId: string;
  spaceUid: string;
  type?: string;
  message?: string;
  state: 'idle' | 'running' | 'stopped' | 'interrupted' | 'ended';
  eventType: string;
  providerSource?: 'managed' | 'byok' | 'local_model' | 'apple_speech';
  providerId?: string;
  fallbackReason?: 'default' | 'manual_override' | 'quota_fallback' | 'local_forced';
  usage?: SpeechUsageMetricsPayload;
  lockReason?: string;
  transcript?: string;
  turnId?: string;
  sequence?: number;
  sequenceNo?: number;
  reason?: string;
  emittedAt?: string;
  ts: string;
}

/**
 * Turn execution result
 */
export interface TurnResult {
  turnId: string;
  spaceId: string;
  output?: string;
  status: 'completed' | 'pending_feedback' | 'failed';
  error?: string;
}

/**
 * Capability invocation result
 */
export interface CapabilityResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

/**
 * Pending request tracker for request/response correlation
 */
interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
  timeout: ReturnType<typeof setTimeout>;
}

/**
 * Event handler type definitions
 */
export type TurnEventHandler = (event: TurnEventPayload) => void;
export type TurnStreamHandler = (stream: TurnStreamPayload) => void;
export type SpaceStateHandler = (state: SpaceStatePayload) => void;
export type SpaceAgentUpdatedHandler = (event: SpaceAgentUpdatedEventPayload) => void;
export type NotificationHandler = (notification: NotificationPayload) => void;
export type ErrorHandler = (error: ErrorPayload) => void;
export type CapabilityInvokeHandler = (
  request: AdapterCapabilityInvokePayload,
) => void | Promise<void>;
export type AgentMessageHandler = (payload: AgentMessagePayload) => void;
export type AgentPokeHandler = (payload: AgentPokePayload) => void;
export type AgentIdleHandler = (payload: AgentIdlePayload) => void;
export type TaskDependencyHandler = (payload: TaskDependencyPayload) => void;
export type TaskDependencyResolvedHandler = (payload: TaskDependencyResolvedPayload) => void;
export type OrchestratorEventHandler = (payload: OrchestratorEventPayload) => void;
export type SpeechEventHandler = (payload: SpeechEventPayload) => void;
export type UnsubscribeHandler = () => void;

/**
 * GatewayClient configuration options
 */
export interface GatewayClientOptions {
  url: string;
  clientType?: string;
  clientVersion?: string;
  deviceId?: string;
  devicePublicKey?: string;
  deviceProofSignature?: string;
  reconnect?: boolean;
  reconnectIntervalMs?: number;
  maxReconnectAttempts?: number;
  onOpen?: () => void;
  onClose?: () => void;
  onError?: (error: Error) => void;
  requestTimeoutMs?: number;
}

/**
 * Options for ensuring a "main" space exists for app bootstrap.
 */
export interface MainSpaceBootstrapOptions {
  apiVersion?: string;
  spaceId?: string;
  resourceId?: string;
  name?: string;
  goal?: string;
  createIfMissing?: boolean;
  subscribe?: boolean;
  initialAgents?: SpaceCreateInitialAgentPayload[];
}

/**
 * Result returned by main-space bootstrap helpers.
 */
export interface MainSpaceBootstrapResult {
  space: SpaceSummary;
  created: boolean;
  subscribed: boolean;
}

/**
 * Result returned by connect + bootstrap helper.
 */
export interface ConnectAndBootstrapResult extends MainSpaceBootstrapResult {
  connected: boolean;
}

/**
 * Spaceskit WebSocket client SDK
 */
export class GatewayClient {
  private url: string;
  private clientType: string;
  private clientVersion: string;
  private deviceId?: string;
  private devicePublicKey?: string;
  private deviceProofSignature?: string;
  private reconnect: boolean;
  private reconnectIntervalMs: number;
  private maxReconnectAttempts: number;
  private requestTimeoutMs: number;

  private ws: WebSocket | null = null;
  private connected: boolean = false;
  private reconnectAttempts: number = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  private pendingRequests: Map<string, PendingRequest> = new Map();
  private turnEventHandlers: TurnEventHandler[] = [];
  private turnStreamHandlers: TurnStreamHandler[] = [];
  private spaceStateHandlers: SpaceStateHandler[] = [];
  private spaceAgentUpdatedHandlers: SpaceAgentUpdatedHandler[] = [];
  private notificationHandlers: NotificationHandler[] = [];
  private errorHandlers: ErrorHandler[] = [];
  private capabilityInvokeHandlers: CapabilityInvokeHandler[] = [];
  private agentMessageHandlers: AgentMessageHandler[] = [];
  private agentPokeHandlers: AgentPokeHandler[] = [];
  private agentIdleHandlers: AgentIdleHandler[] = [];
  private taskDependencyHandlers: TaskDependencyHandler[] = [];
  private taskDependencyResolvedHandlers: TaskDependencyResolvedHandler[] = [];
  private orchestratorEventHandlers: OrchestratorEventHandler[] = [];
  private speechEventHandlers: SpeechEventHandler[] = [];

  private authKeyPair: AuthKeyPair | null = null;

  private onOpenCallback?: () => void;
  private onCloseCallback?: () => void;
  private onErrorCallback?: (error: Error) => void;

  constructor(options: GatewayClientOptions) {
    this.url = options.url;
    this.clientType = options.clientType ?? 'sdk';
    this.clientVersion = options.clientVersion ?? '1.0.0';
    this.deviceId = options.deviceId?.trim() || undefined;
    this.devicePublicKey = options.devicePublicKey?.trim() || undefined;
    this.deviceProofSignature = options.deviceProofSignature?.trim() || undefined;
    this.reconnect = options.reconnect ?? true;
    this.reconnectIntervalMs = options.reconnectIntervalMs ?? 3000;
    this.maxReconnectAttempts = options.maxReconnectAttempts ?? 10;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 30000;

    this.onOpenCallback = options.onOpen;
    this.onCloseCallback = options.onClose;
    this.onErrorCallback = options.onError;
  }

  /**
   * Connect to the Spaceskit
   */
  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.url);

        this.ws.addEventListener('open', () => {
          this.connected = true;
          this.reconnectAttempts = 0;
          this.onOpenCallback?.();
          resolve();
        });

        this.ws.addEventListener('message', (event: MessageEvent) => {
          this.handleMessage(event.data);
        });

        this.ws.addEventListener('close', () => {
          this.connected = false;
          this.onCloseCallback?.();
          this.attemptReconnect();
        });

        this.ws.addEventListener('error', (event: Event) => {
          const error = new Error('WebSocket error');
          this.onErrorCallback?.(error);
          this.errorHandlers.forEach((handler) => {
            handler({
              code: 'WS_ERROR',
              message: 'WebSocket connection error',
              details: error.message,
            });
          });
          reject(error);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Disconnect from the Spaceskit
   */
  async disconnect(): Promise<void> {
    this.reconnect = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
  }

  /**
   * Check if client is connected
   */
  get isConnected(): boolean {
    return this.connected && this.ws?.readyState === WebSocket.OPEN;
  }

  /**
   * Attempt to reconnect with exponential backoff
   */
  private attemptReconnect(): void {
    if (!this.reconnect) return;
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      const error = new Error('Max reconnection attempts reached');
      this.onErrorCallback?.(error);
      return;
    }

    this.reconnectAttempts++;
    const delay =
      this.reconnectIntervalMs * Math.pow(2, this.reconnectAttempts - 1);

    this.reconnectTimer = setTimeout(() => {
      this.connect().catch((error) => {
        this.onErrorCallback?.(error);
      });
    }, delay);
  }

  /**
   * Send a message to the gateway
   */
  private async send<T>(type: string, payload: T): Promise<string> {
    if (!this.isConnected) {
      throw new Error('WebSocket not connected');
    }

    const messageId = crypto.randomUUID();
    const message: GatewayMessage<T> = {
      type,
      id: messageId,
      ts: new Date().toISOString(),
      payload,
    };

    this.ws!.send(JSON.stringify(message));
    return messageId;
  }

  /**
   * Send a message and wait for a response
   */
  private async sendAndWaitForResponse<T, R>(
    type: string,
    payload: T,
    timeoutMs: number = this.requestTimeoutMs,
  ): Promise<R> {
    return new Promise((resolve, reject) => {
      this.send(type, payload)
        .then((messageId) => {
          const timeout = setTimeout(() => {
            this.pendingRequests.delete(messageId);
            reject(new Error(`Request timeout: ${type}`));
          }, timeoutMs);

          this.pendingRequests.set(messageId, {
            resolve: resolve as (value: unknown) => void,
            reject,
            timeout,
          });
        })
        .catch(reject);
    });
  }

  /**
   * Handle incoming messages from the gateway
   */
  private handleMessage(data: string): void {
    try {
      const message: GatewayMessage = JSON.parse(data);
      const { type, id, replyTo, payload } = message;

      // Check if this is a response to a pending request
      if (replyTo && this.pendingRequests.has(replyTo)) {
        const pending = this.pendingRequests.get(replyTo)!;
        this.pendingRequests.delete(replyTo);
        clearTimeout(pending.timeout);

        if (type === 'error') {
          pending.reject(new Error((payload as ErrorPayload).message));
        } else {
          pending.resolve(payload);
        }
        return;
      }

      // Handle unsolicited messages
      switch (type) {
        case 'auth_challenge':
          this.handleAuthChallenge(payload as AuthChallengePayload);
          break;
        case 'auth_result':
          this.handleAuthResult(payload as AuthResultPayload);
          break;
        case 'turn_event':
          this.handleTurnEvent(payload as TurnEventPayload);
          break;
        case 'turn_stream':
          this.handleTurnStream(payload as TurnStreamPayload);
          break;
        case 'capability.invoke':
          this.handleCapabilityInvoke(payload as AdapterCapabilityInvokePayload);
          break;
        case 'space_state':
          this.handleSpaceState(payload as SpaceStatePayload);
          break;
        case 'space.agent_updated':
          this.spaceAgentUpdatedHandlers.forEach((handler) => handler(payload as SpaceAgentUpdatedEventPayload));
          break;
        case 'notification':
          this.handleNotification(payload as NotificationPayload);
          break;
        case 'error':
          this.handleError(payload as ErrorPayload);
          break;
        case 'agent_message':
          this.agentMessageHandlers.forEach((handler) => handler(payload as AgentMessagePayload));
          break;
        case 'agent_poke':
          this.agentPokeHandlers.forEach((handler) => handler(payload as AgentPokePayload));
          break;
        case 'agent_idle':
          this.agentIdleHandlers.forEach((handler) => handler(payload as AgentIdlePayload));
          break;
        case 'task_dependency':
          this.taskDependencyHandlers.forEach((handler) => handler(payload as TaskDependencyPayload));
          break;
        case 'task_dependency_resolved':
          this.taskDependencyResolvedHandlers.forEach((handler) => handler(payload as TaskDependencyResolvedPayload));
          break;
        case 'orchestrator.event':
          this.orchestratorEventHandlers.forEach((handler) => handler(payload as OrchestratorEventPayload));
          break;
        case 'speech.event':
          this.speechEventHandlers.forEach((handler) => handler(payload as SpeechEventPayload));
          break;
        case 'pong':
          // Silently handle pong
          break;
        default:
          console.warn(`Unknown message type: ${type}`);
      }
    } catch (error) {
      const err = new Error(`Failed to parse message: ${error}`);
      this.onErrorCallback?.(err);
    }
  }

  /**
   * Set the authentication key pair for challenge-response auth.
   * Must be called before `connect()` if the gateway requires authentication.
   * Generate a key pair with `generateAuthKeyPair()`.
   */
  setAuthKeyPair(keyPair: AuthKeyPair): void {
    this.authKeyPair = keyPair;
  }

  /**
   * Handle authentication challenge — auto-signs if key pair is set.
   */
  private handleAuthChallenge(payload: AuthChallengePayload): void {
    if (payload.challenge && this.authKeyPair) {
      // Auto-sign the challenge and send AUTHENTICATE
      signChallenge(payload.challenge, this.authKeyPair.privateKey)
        .then((signature) => {
          // Connection may close while challenge signing is in-flight.
          // Skip authenticate send in that case to avoid unhandled rejections.
          if (!this.isConnected) return;
          return this.send<AuthenticatePayload>('authenticate', {
            publicKey: this.authKeyPair!.publicKeyBase64,
            signature,
            clientType: this.clientType,
            clientVersion: this.clientVersion,
            deviceId: this.deviceId,
            devicePublicKey: this.devicePublicKey,
            deviceProofSignature: this.deviceProofSignature,
          });
        })
        .catch((err) => {
          const error: ErrorPayload = {
            code: 'AUTH_SIGN_FAILED',
            message: `Failed to sign auth challenge: ${err}`,
          };
          this.errorHandlers.forEach((handler) => handler(error));
        });
      return;
    }

    if (!payload.success) {
      const error: ErrorPayload = {
        code: 'AUTH_CHALLENGE',
        message: payload.reason || 'Authentication challenge failed',
      };
      this.errorHandlers.forEach((handler) => handler(error));
    }
  }

  /**
   * Handle authentication result
   */
  private handleAuthResult(payload: AuthResultPayload): void {
    if (!payload.success) {
      const error: ErrorPayload = {
        code: 'AUTH_FAILED',
        message: payload.reason || 'Authentication failed',
      };
      this.errorHandlers.forEach((handler) => handler(error));
    }
  }

  /**
   * Handle turn event
   */
  private handleTurnEvent(payload: TurnEventPayload): void {
    this.turnEventHandlers.forEach((handler) => handler(payload));
  }

  /**
   * Handle turn stream
   */
  private handleTurnStream(payload: TurnStreamPayload): void {
    this.turnStreamHandlers.forEach((handler) => handler(payload));
  }

  /**
   * Handle adapter capability invocation.
   */
  private handleCapabilityInvoke(payload: AdapterCapabilityInvokePayload): void {
    this.capabilityInvokeHandlers.forEach((handler) => {
      Promise.resolve(handler(payload)).catch((err) => {
        this.handleError({
          code: 'ADAPTER_INVOKE_HANDLER_FAILED',
          message: err instanceof Error ? err.message : String(err),
        });
      });
    });
  }

  /**
   * Handle space state update
   */
  private handleSpaceState(payload: SpaceStatePayload): void {
    this.spaceStateHandlers.forEach((handler) => handler(payload));
  }

  /**
   * Handle notification
   */
  private handleNotification(payload: NotificationPayload): void {
    this.notificationHandlers.forEach((handler) => handler(payload));
  }

  /**
   * Handle error
   */
  private handleError(payload: ErrorPayload): void {
    this.errorHandlers.forEach((handler) => handler(payload));
  }

  /**
   * Execute a turn in a space
   */
  async executeTurn(
    spaceId: string,
    input: string,
    targetAgentId?: string,
  ): Promise<TurnResult> {
    const payload: ExecuteTurnPayload = {
      spaceUid: spaceId,
      input,
      targetAgentId,
    };

    const result = await this.sendAndWaitForResponse<
      ExecuteTurnPayload,
      TurnResult
    >('execute_turn', payload);
    return result;
  }

  /**
   * Ensure a main space exists and optionally subscribe to it.
   *
   * This is intended for app bootstrap flows:
   * - find main space by ID
   * - optionally create it if missing
   * - optionally subscribe to its real-time events
   */
  async ensureMainSpace(
    options: MainSpaceBootstrapOptions = {},
  ): Promise<MainSpaceBootstrapResult> {
    const spaceId = options.spaceId ?? 'main-space';
    const resourceId = options.resourceId ?? 'resource:main';
    const name = options.name ?? 'Main Space';
    const goal = options.goal ?? 'Default shared space for gateway startup and orchestrator coordination.';
    const createIfMissing = options.createIfMissing ?? true;
    const shouldSubscribe = options.subscribe ?? true;

    const spaces = await this.listSpaces({
      apiVersion: options.apiVersion,
      resourceId,
      limit: 200,
    });

    let space = spaces.find((candidate) => candidate.id === spaceId) ?? null;
    let created = false;

    if (!space && createIfMissing) {
      space = await this.createSpace({
        apiVersion: options.apiVersion,
        spaceId,
        resourceId,
        name,
        goal,
        visibility: 'shared',
        initialAgents: options.initialAgents,
      });
      created = true;
    }

    if (!space) {
      throw new Error(`Main space not found: ${spaceId}`);
    }

    let subscribed = false;
    if (shouldSubscribe) {
      await this.subscribe([space.spaceUid]);
      subscribed = true;
    }

    return {
      space,
      created,
      subscribed,
    };
  }

  /**
   * Connect (if needed), then ensure/subscribe main space.
   */
  async connectAndBootstrapMainSpace(
    options: MainSpaceBootstrapOptions = {},
  ): Promise<ConnectAndBootstrapResult> {
    let connected = false;
    if (!this.isConnected) {
      await this.connect();
      connected = true;
    }

    const result = await this.ensureMainSpace(options);
    return {
      connected,
      ...result,
    };
  }

  /**
   * Resume a turn with feedback
   */
  async resumeFeedback(
    spaceId: string,
    turnId: string,
    response: 'approve' | 'reject' | 'revise' | 'defer',
    revision?: string,
  ): Promise<void> {
    const payload: ResumeFeedbackPayload = {
      spaceUid: spaceId,
      turnId,
      response,
      revision,
    };

    await this.sendAndWaitForResponse<ResumeFeedbackPayload, void>(
      'resume_feedback',
      payload,
    );
  }

  /**
   * Subscribe to space events
   */
  async subscribe(spaceIds: string[]): Promise<SubscribeResponsePayload> {
    const payload: SubscribePayload = {
      spaceUids: spaceIds,
    };
    return await this.sendAndWaitForResponse<SubscribePayload, SubscribeResponsePayload>(
      'subscribe',
      payload,
    );
  }

  /**
   * Invoke a capability
   */
  async invokeCapability(
    capability: string,
    method: string,
    params: Record<string, unknown>,
    targetProvider?: string,
  ): Promise<CapabilityResult> {
    const payload: CapabilityInvokePayload = {
      capability,
      method,
      params,
      targetProvider,
    };

    const result = await this.sendAndWaitForResponse<
      CapabilityInvokePayload,
      CapabilityResult
    >('capability_invoke', payload);
    return result;
  }

  /**
   * Create a new space.
   */
  async createSpace(payload: SpaceCreatePayload): Promise<SpaceSummary> {
    const result = await this.sendAndWaitForResponse<
      SpaceCreatePayload,
      SpaceCreateResponsePayload
    >('space.create', payload);
    return result.space;
  }

  /**
   * Get a space by ID.
   */
  async getSpace(spaceId: string, apiVersion?: string): Promise<SpaceSummary> {
    const payload: SpaceGetPayload = { apiVersion, spaceId };
    const result = await this.sendAndWaitForResponse<
      SpaceGetPayload,
      SpaceGetResponsePayload
    >('space.get', payload);
    return result.space;
  }

  /**
   * List spaces with optional filters.
   */
  async listSpaces(payload: SpaceListPayload = {}): Promise<SpaceSummary[]> {
    const result = await this.sendAndWaitForResponse<
      SpaceListPayload,
      SpaceListResponsePayload
    >('space.list', payload);
    return result.spaces;
  }

  /**
   * Add an agent assignment to a space.
   */
  async addAgent(payload: SpaceAddAgentPayload): Promise<SpaceAddAgentResponsePayload> {
    return this.sendAndWaitForResponse<
      SpaceAddAgentPayload,
      SpaceAddAgentResponsePayload
    >('space.add_agent', payload);
  }

  /**
   * Remove an agent assignment from a space.
   */
  async removeAgent(payload: SpaceRemoveAgentPayload): Promise<SpaceRemoveAgentResponsePayload> {
    return this.sendAndWaitForResponse<
      SpaceRemoveAgentPayload,
      SpaceRemoveAgentResponsePayload
    >('space.remove_agent', payload);
  }

  /**
   * Update an existing assignment in a space.
   */
  async updateAgentAssignment(
    payload: SpaceUpdateAgentAssignmentPayload,
  ): Promise<SpaceUpdateAgentAssignmentResponsePayload> {
    return this.sendAndWaitForResponse<
      SpaceUpdateAgentAssignmentPayload,
      SpaceUpdateAgentAssignmentResponsePayload
    >('space.update_agent_assignment', payload);
  }

  /**
   * Set the orchestrator profile for a space.
   */
  async setSpaceOrchestrator(payload: SpaceSetOrchestratorPayload): Promise<SpaceSummary> {
    const result = await this.sendAndWaitForResponse<
      SpaceSetOrchestratorPayload,
      SpaceGetResponsePayload
    >('space.set_orchestrator', payload);
    return result.space;
  }

  /**
   * List all assignments for a space.
   */
  async listAgentAssignments(
    spaceId: string,
    apiVersion?: string,
  ): Promise<SpaceAgentAssignment[]> {
    const payload: SpaceListAgentAssignmentsPayload = { apiVersion, spaceId };
    const result = await this.sendAndWaitForResponse<
      SpaceListAgentAssignmentsPayload,
      SpaceListAgentAssignmentsResponsePayload
    >('space.list_agent_assignments', payload);
    return result.assignments;
  }

  /**
   * Get per-space MCP endpoint configuration.
   */
  async getSpaceMcpEndpoint(
    spaceId: string,
    apiVersion?: string,
  ): Promise<SpaceGetMcpEndpointResponsePayload> {
    const payload: SpaceGetMcpEndpointPayload = { apiVersion, spaceId };
    return this.sendAndWaitForResponse<
      SpaceGetMcpEndpointPayload,
      SpaceGetMcpEndpointResponsePayload
    >('space.get_mcp_endpoint', payload);
  }

  /**
   * Create or update per-space MCP endpoint configuration.
   */
  async setSpaceMcpEndpoint(
    payload: SpaceSetMcpEndpointPayload,
  ): Promise<SpaceMcpEndpoint> {
    const result = await this.sendAndWaitForResponse<
      SpaceSetMcpEndpointPayload,
      SpaceSetMcpEndpointResponsePayload
    >('space.set_mcp_endpoint', payload);
    return result.endpoint;
  }

  /**
   * Remove per-space MCP endpoint configuration.
   */
  async clearSpaceMcpEndpoint(
    spaceId: string,
    apiVersion?: string,
  ): Promise<boolean> {
    const payload: SpaceClearMcpEndpointPayload = { apiVersion, spaceId };
    const result = await this.sendAndWaitForResponse<
      SpaceClearMcpEndpointPayload,
      SpaceClearMcpEndpointResponsePayload
    >('space.clear_mcp_endpoint', payload);
    return result.cleared;
  }

  /**
   * Discover MCP-backed external agents available to a space.
   */
  async discoverSpaceMcpAgents(
    spaceId: string,
    apiVersion?: string,
  ): Promise<SpaceDiscoverMcpAgentsResponsePayload> {
    const payload: SpaceDiscoverMcpAgentsPayload = { apiVersion, spaceId };
    return this.sendAndWaitForResponse<
      SpaceDiscoverMcpAgentsPayload,
      SpaceDiscoverMcpAgentsResponsePayload
    >('space.discover_mcp_agents', payload);
  }

  /**
   * Approve one discovered MCP agent into a space as an external participant.
   */
  async approveSpaceMcpAgent(
    payload: SpaceApproveMcpAgentPayload,
  ): Promise<SpaceApproveMcpAgentResponsePayload> {
    return this.sendAndWaitForResponse<
      SpaceApproveMcpAgentPayload,
      SpaceApproveMcpAgentResponsePayload
    >('space.approve_mcp_agent', payload);
  }

  /**
   * Add one skill assignment to a space.
   */
  async addSkillToSpace(payload: SpaceAddSkillPayload): Promise<SpaceAddSkillResponsePayload> {
    return this.sendAndWaitForResponse<
      SpaceAddSkillPayload,
      SpaceAddSkillResponsePayload
    >("space.add_skill", payload);
  }

  /**
   * Remove one skill assignment from a space.
   */
  async removeSkillFromSpace(payload: SpaceRemoveSkillPayload): Promise<SpaceRemoveSkillResponsePayload> {
    return this.sendAndWaitForResponse<
      SpaceRemoveSkillPayload,
      SpaceRemoveSkillResponsePayload
    >("space.remove_skill", payload);
  }

  /**
   * List current skill assignments for a space.
   */
  async listSpaceSkills(spaceId: string, apiVersion?: string): Promise<string[]> {
    const payload: SpaceListSkillsPayload = { apiVersion, spaceId };
    const result = await this.sendAndWaitForResponse<
      SpaceListSkillsPayload,
      SpaceListSkillsResponsePayload
    >("space.list_skills", payload);
    return result.skills;
  }

  /**
   * Get effective workspace configuration for a space.
   */
  async getSpaceWorkspace(
    spaceId: string,
    apiVersion?: string,
  ): Promise<SpaceWorkspace> {
    const payload: SpaceGetWorkspacePayload = { apiVersion, spaceId };
    const result = await this.sendAndWaitForResponse<
      SpaceGetWorkspacePayload,
      SpaceGetWorkspaceResponsePayload
    >("space.get_workspace", payload);
    return result.workspace;
  }

  /**
   * Set or clear explicit workspace root for a space.
   */
  async setSpaceWorkspace(
    payload: SpaceSetWorkspacePayload,
  ): Promise<SpaceWorkspace> {
    const result = await this.sendAndWaitForResponse<
      SpaceSetWorkspacePayload,
      SpaceSetWorkspaceResponsePayload
    >("space.set_workspace", payload);
    return result.workspace;
  }

  /**
   * Add one resource assignment to a space.
   */
  async addSpaceResource(payload: SpaceAddResourcePayload): Promise<SpaceResource> {
    const result = await this.sendAndWaitForResponse<
      SpaceAddResourcePayload,
      SpaceAddResourceResponsePayload
    >("space.add_resource", payload);
    return result.resource;
  }

  /**
   * Remove one resource assignment from a space.
   */
  async removeSpaceResource(payload: SpaceRemoveResourcePayload): Promise<boolean> {
    const result = await this.sendAndWaitForResponse<
      SpaceRemoveResourcePayload,
      SpaceRemoveResourceResponsePayload
    >("space.remove_resource", payload);
    return result.removed;
  }

  /**
   * List resource assignments for a space.
   */
  async listSpaceResources(
    spaceId: string,
    apiVersion?: string,
  ): Promise<SpaceResource[]> {
    const payload: SpaceListResourcesPayload = { apiVersion, spaceId };
    const result = await this.sendAndWaitForResponse<
      SpaceListResourcesPayload,
      SpaceListResourcesResponsePayload
    >("space.list_resources", payload);
    return result.resources;
  }

  /**
   * List redacted orchestration journal entries for a space.
   */
  async listOrchestrationJournal(
    payload: SpaceListOrchestrationJournalPayload,
  ): Promise<SpaceListOrchestrationJournalResponsePayload> {
    return this.sendAndWaitForResponse<
      SpaceListOrchestrationJournalPayload,
      SpaceListOrchestrationJournalResponsePayload
    >("space.list_orchestration_journal", payload);
  }

  /**
   * Create a profile in gateway persistence.
   */
  async createProfile(payload: ProfileCreatePayload): Promise<ProfileCreateResponsePayload> {
    return this.sendAndWaitForResponse<
      ProfileCreatePayload,
      ProfileCreateResponsePayload
    >("profile.create", payload);
  }

  /**
   * Fetch one profile by ID.
   */
  async getProfile(profileId: string, apiVersion?: string): Promise<ProfileSummary> {
    const payload: ProfileGetPayload = { apiVersion, profileId };
    const result = await this.sendAndWaitForResponse<
      ProfileGetPayload,
      ProfileGetResponsePayload
    >("profile.get", payload);
    return result.profile;
  }

  /**
   * List profiles, optionally including archived entries.
   */
  async listProfiles(payload: ProfileListPayload = {}): Promise<ProfileSummary[]> {
    const result = await this.sendAndWaitForResponse<
      ProfileListPayload,
      ProfileListResponsePayload
    >("profile.list", payload);
    return result.profiles;
  }

  /**
   * Update a profile and create a new active revision.
   */
  async updateProfile(payload: ProfileUpdatePayload): Promise<ProfileUpdateResponsePayload> {
    return this.sendAndWaitForResponse<
      ProfileUpdatePayload,
      ProfileUpdateResponsePayload
    >("profile.update", payload);
  }

  /**
   * Archive a profile.
   */
  async archiveProfile(payload: ProfileArchivePayload): Promise<ProfileArchiveResponsePayload> {
    return this.sendAndWaitForResponse<
      ProfileArchivePayload,
      ProfileArchiveResponsePayload
    >("profile.archive", payload);
  }

  async listPresets(payload: PresetListPayload = {}): Promise<PresetSummary[]> {
    const result = await this.sendAndWaitForResponse<
      PresetListPayload,
      { presets: PresetSummary[] }
    >('preset.list', payload);
    return result.presets;
  }

  async getPreset(payload: PresetGetPayload): Promise<PresetDetail> {
    const result = await this.sendAndWaitForResponse<
      PresetGetPayload,
      { preset: PresetDetail }
    >('preset.get', payload);
    return result.preset;
  }

  async applyPresetToSpace(payload: PresetApplyToSpacePayload): Promise<PresetApplyToSpaceResult> {
    return this.sendAndWaitForResponse<
      PresetApplyToSpacePayload,
      PresetApplyToSpaceResult
    >('preset.apply_to_space', payload);
  }

  async previewTemplate(payload: SpacePreviewTemplatePayload): Promise<SpacePreviewTemplateResult> {
    return this.sendAndWaitForResponse<
      SpacePreviewTemplatePayload,
      SpacePreviewTemplateResult
    >('space.preview_template', payload);
  }

  async createSpaceFromTemplate(
    payload: SpaceCreateFromTemplatePayload,
  ): Promise<SpaceCreateFromTemplateResult> {
    return this.sendAndWaitForResponse<
      SpaceCreateFromTemplatePayload,
      SpaceCreateFromTemplateResult
    >('space.create_from_template', payload);
  }

  async saveSpaceTemplate(payload: SpaceSaveTemplatePayload): Promise<SpaceSaveTemplateResult> {
    return this.sendAndWaitForResponse<
      SpaceSaveTemplatePayload,
      SpaceSaveTemplateResult
    >('space.save_template', payload);
  }

  async registerDevice(payload: AuthRegisterDevicePayload): Promise<AuthRegisterDeviceResult> {
    return this.sendAndWaitForResponse<
      AuthRegisterDevicePayload,
      AuthRegisterDeviceResult
    >('auth.register_device', payload);
  }

  async rotateDeviceKey(payload: AuthRotateDeviceKeyPayload): Promise<AuthRotateDeviceKeyResult> {
    return this.sendAndWaitForResponse<
      AuthRotateDeviceKeyPayload,
      AuthRotateDeviceKeyResult
    >('auth.rotate_device_key', payload);
  }

  async revokeDevice(payload: AuthRevokeDevicePayload): Promise<AuthRevokeDeviceResult> {
    return this.sendAndWaitForResponse<
      AuthRevokeDevicePayload,
      AuthRevokeDeviceResult
    >('auth.revoke_device', payload);
  }

  async listDevices(payload: AuthListDevicesPayload = {}): Promise<DeviceIdentity[]> {
    const result = await this.sendAndWaitForResponse<
      AuthListDevicesPayload,
      { devices: DeviceIdentity[] }
    >('auth.list_devices', payload);
    return result.devices;
  }

  /**
   * Issue a short-lived signed bearer token for strict HTTP principal auth.
   */
  async issueHttpPrincipalToken(
    payload: AuthIssueHttpPrincipalTokenPayload = {},
  ): Promise<AuthIssueHttpPrincipalTokenResult> {
    return this.sendAndWaitForResponse<
      AuthIssueHttpPrincipalTokenPayload,
      AuthIssueHttpPrincipalTokenResult
    >('auth.issue_http_principal_token', payload);
  }

  /**
   * Get persisted usage + budget snapshot.
   */
  async getUsageSnapshot(apiVersion?: string): Promise<UsageSnapshot> {
    const result = await this.sendAndWaitForResponse<
      { apiVersion?: string },
      { snapshot: UsageSnapshot }
    >('usage.get_snapshot', { apiVersion });
    return result.snapshot;
  }

  /**
   * Destructively reset one gateway runtime after typed confirmation.
   */
  async factoryResetGateway(
    payload: GatewayFactoryResetPayload,
  ): Promise<GatewayFactoryResetResult> {
    return this.sendAndWaitForResponse<
      GatewayFactoryResetPayload,
      GatewayFactoryResetResult
    >("gateway.factory_reset", payload, Math.max(this.requestTimeoutMs, 180_000));
  }

  /**
   * Get current gateway-wide capability/skill policy.
   */
  async getGatewayPolicy(apiVersion?: string): Promise<GatewayPolicy> {
    const result = await this.sendAndWaitForResponse<
      { apiVersion?: string },
      { policy: GatewayPolicy }
    >('gateway.get_policy', { apiVersion });
    return result.policy;
  }

  /**
   * Update gateway-wide capability/skill policy.
   */
  async updateGatewayPolicy(
    payload: GatewayPolicyUpdatePayload,
  ): Promise<GatewayPolicy> {
    const result = await this.sendAndWaitForResponse<
      GatewayPolicyUpdatePayload,
      { policy: GatewayPolicy }
    >('gateway.update_policy', payload);
    return result.policy;
  }

  /**
   * List gateway knowledge base entries (global + optional space-scoped subset).
   */
  async listKnowledgeBaseEntries(
    payload: GatewayListKnowledgeBaseEntriesPayload = {},
  ): Promise<GatewayKnowledgeBaseEntry[]> {
    const result = await this.sendAndWaitForResponse<
      GatewayListKnowledgeBaseEntriesPayload,
      { entries: GatewayKnowledgeBaseEntry[] }
    >("gateway.kb_list_entries", payload);
    return result.entries;
  }

  /**
   * Create or update one gateway knowledge base entry.
   */
  async upsertKnowledgeBaseEntry(
    payload: GatewayUpsertKnowledgeBaseEntryPayload,
  ): Promise<GatewayKnowledgeBaseEntry> {
    const result = await this.sendAndWaitForResponse<
      GatewayUpsertKnowledgeBaseEntryPayload,
      { entry: GatewayKnowledgeBaseEntry }
    >("gateway.kb_upsert_entry", payload);
    return result.entry;
  }

  /**
   * Delete one gateway knowledge base entry by ID.
   */
  async deleteKnowledgeBaseEntry(
    entryId: string,
    apiVersion?: string,
  ): Promise<boolean> {
    const result = await this.sendAndWaitForResponse<
      GatewayDeleteKnowledgeBaseEntryPayload,
      { entryId: string; deleted: boolean }
    >("gateway.kb_delete_entry", { apiVersion, entryId });
    return result.deleted;
  }

  /**
   * Submit an intent-level orchestrator command.
   */
  async sendOrchestratorCommand(
    payload: OrchestratorCommandPayload,
  ): Promise<OrchestratorCommandResult> {
    const result = await this.sendAndWaitForResponse<
      OrchestratorCommandPayload,
      { command: OrchestratorCommandResult }
    >('orchestrator.command', payload);
    return result.command;
  }

  /**
   * Get command lifecycle state by command ID.
   */
  async getOrchestratorCommand(
    commandId: string,
    apiVersion?: string,
  ): Promise<OrchestratorCommandResult> {
    const result = await this.sendAndWaitForResponse<
      { apiVersion?: string; commandId: string },
      { command: OrchestratorCommandResult }
    >('orchestrator.get_command', { apiVersion, commandId });
    return result.command;
  }

  async createSchedulerJob(payload: SchedulerCreateJobPayload): Promise<SchedulerJob> {
    const result = await this.sendAndWaitForResponse<
      SchedulerCreateJobPayload,
      { job: SchedulerJob }
    >('scheduler.create_job', payload);
    return result.job;
  }

  async getSchedulerJob(jobId: string, apiVersion?: string): Promise<SchedulerJob> {
    const payload: SchedulerGetJobPayload = { apiVersion, jobId };
    const result = await this.sendAndWaitForResponse<
      SchedulerGetJobPayload,
      { job: SchedulerJob }
    >('scheduler.get_job', payload);
    return result.job;
  }

  async listSchedulerJobs(payload: SchedulerListJobsPayload = {}): Promise<SchedulerJob[]> {
    const result = await this.sendAndWaitForResponse<
      SchedulerListJobsPayload,
      { jobs: SchedulerJob[] }
    >('scheduler.list_jobs', payload);
    return result.jobs;
  }

  async updateSchedulerJob(payload: SchedulerUpdateJobPayload): Promise<SchedulerJob> {
    const result = await this.sendAndWaitForResponse<
      SchedulerUpdateJobPayload,
      { job: SchedulerJob }
    >('scheduler.update_job', payload);
    return result.job;
  }

  async deleteSchedulerJob(payload: SchedulerDeleteJobPayload): Promise<SchedulerDeleteJobResult> {
    return this.sendAndWaitForResponse<
      SchedulerDeleteJobPayload,
      SchedulerDeleteJobResult
    >('scheduler.delete_job', payload);
  }

  async linkSchedulerJobSpace(payload: SchedulerLinkSpacePayload): Promise<SchedulerJob> {
    const result = await this.sendAndWaitForResponse<
      SchedulerLinkSpacePayload,
      { job: SchedulerJob }
    >('scheduler.link_space', payload);
    return result.job;
  }

  async unlinkSchedulerJobSpace(payload: SchedulerUnlinkSpacePayload): Promise<SchedulerJob> {
    const result = await this.sendAndWaitForResponse<
      SchedulerUnlinkSpacePayload,
      { job: SchedulerJob }
    >('scheduler.unlink_space', payload);
    return result.job;
  }

  async listSchedulerJobRuns(payload: SchedulerListRunsPayload): Promise<SchedulerListRunsResult> {
    return this.sendAndWaitForResponse<
      SchedulerListRunsPayload,
      SchedulerListRunsResult
    >('scheduler.list_runs', payload);
  }

  async runSchedulerJobNow(payload: SchedulerRunNowPayload): Promise<SchedulerRunNowResult> {
    return this.sendAndWaitForResponse<
      SchedulerRunNowPayload,
      SchedulerRunNowResult
    >('scheduler.run_now', payload);
  }

  async linkSpaces(payload: SpaceLinkPayload): Promise<SpaceLinkResult> {
    const result = await this.sendAndWaitForResponse<
      SpaceLinkPayload,
      { link: SpaceLinkResult }
    >('space.link', payload);
    return result.link;
  }

  async unlinkSpaces(payload: SpaceUnlinkPayload): Promise<boolean> {
    const result = await this.sendAndWaitForResponse<
      SpaceUnlinkPayload,
      { removed: boolean }
    >('space.unlink', payload);
    return result.removed;
  }

  async shareSpaceContext(payload: SpaceShareContextPayload): Promise<SharedContextRef> {
    const result = await this.sendAndWaitForResponse<
      SpaceShareContextPayload,
      { transfer: SharedContextRef }
    >('space.share_context', payload);
    return result.transfer;
  }

  async pullSharedContext(
    payload: SpacePullSharedContextPayload,
  ): Promise<SpacePullSharedContextResult> {
    return this.sendAndWaitForResponse<
      SpacePullSharedContextPayload,
      SpacePullSharedContextResult
    >('space.pull_shared_context', payload);
  }

  async createSpaceShareInvite(payload: SpaceShareCreateInvitePayload): Promise<SpaceShareInvite> {
    const result = await this.sendAndWaitForResponse<
      SpaceShareCreateInvitePayload,
      { invite: SpaceShareInvite }
    >('space.share_create_invite', payload);
    return result.invite;
  }

  async joinSpaceShareInvite(payload: SpaceShareJoinPayload): Promise<SpaceParticipant> {
    const result = await this.sendAndWaitForResponse<
      SpaceShareJoinPayload,
      { participant: SpaceParticipant }
    >('space.share_join', payload);
    return result.participant;
  }

  async revokeSpaceShareAccess(payload: SpaceShareRevokePayload): Promise<SpaceShareRevokeResult> {
    return this.sendAndWaitForResponse<
      SpaceShareRevokePayload,
      SpaceShareRevokeResult
    >('space.share_revoke', payload);
  }

  async listSpaceParticipants(
    payload: SpaceShareListParticipantsPayload,
  ): Promise<SpaceParticipant[]> {
    const result = await this.sendAndWaitForResponse<
      SpaceShareListParticipantsPayload,
      { spaceId: string; participants: SpaceParticipant[] }
    >('space.share_list_participants', payload);
    return result.participants;
  }

  async createChangeSet(payload: SpaceCreateChangeSetPayload): Promise<ChangeSet> {
    const result = await this.sendAndWaitForResponse<
      SpaceCreateChangeSetPayload,
      { changeSet: ChangeSet }
    >("space.create_changeset", payload);
    return result.changeSet;
  }

  async listChangeSets(payload: SpaceListChangeSetsPayload): Promise<ChangeSet[]> {
    const result = await this.sendAndWaitForResponse<
      SpaceListChangeSetsPayload,
      { spaceId: string; changeSets: ChangeSet[] }
    >("space.list_changesets", payload);
    return result.changeSets;
  }

  async uploadChangeSetFileInit(payload: SpaceUploadChangeSetFileInitPayload): Promise<{
    uploadId: string;
    changeSet: ChangeSet;
    relativePath: string;
  }> {
    return this.sendAndWaitForResponse<
      SpaceUploadChangeSetFileInitPayload,
      {
        uploadId: string;
        changeSet: ChangeSet;
        relativePath: string;
      }
    >("space.upload_changeset_file_init", payload);
  }

  async uploadChangeSetFileComplete(payload: SpaceUploadChangeSetFileCompletePayload): Promise<{
    changeSet: ChangeSet;
    file: ChangeSetFile;
  }> {
    return this.sendAndWaitForResponse<
      SpaceUploadChangeSetFileCompletePayload,
      { changeSet: ChangeSet; file: ChangeSetFile }
    >("space.upload_changeset_file_complete", payload);
  }

  async submitChangeSet(payload: SpaceSubmitChangeSetPayload): Promise<ChangeSet> {
    const result = await this.sendAndWaitForResponse<
      SpaceSubmitChangeSetPayload,
      { changeSet: ChangeSet }
    >("space.submit_changeset", payload);
    return result.changeSet;
  }

  async reviewChangeSet(payload: SpaceReviewChangeSetPayload): Promise<{
    changeSet: ChangeSet;
    review: ChangeSetReview;
  }> {
    return this.sendAndWaitForResponse<
      SpaceReviewChangeSetPayload,
      { changeSet: ChangeSet; review: ChangeSetReview }
    >("space.review_changeset", payload);
  }

  async applyChangeSet(payload: SpaceApplyChangeSetPayload): Promise<{
    changeSet: ChangeSet;
    result: ChangeSetApplyResult;
  }> {
    return this.sendAndWaitForResponse<
      SpaceApplyChangeSetPayload,
      { changeSet: ChangeSet; result: ChangeSetApplyResult }
    >("space.apply_changeset", payload);
  }

  async getChangeSetDiff(payload: SpaceChangeSetDiffPayload): Promise<SpaceChangeSetDiffResult> {
    return this.sendAndWaitForResponse<
      SpaceChangeSetDiffPayload,
      SpaceChangeSetDiffResult
    >("space.get_changeset_diff", payload);
  }

  async getSpaceQuota(payload: SpaceGetQuotaPayload): Promise<{
    spacePolicy: SpaceQuotaPolicy;
    participantPolicy?: ParticipantQuotaPolicy;
  }> {
    return this.sendAndWaitForResponse<
      SpaceGetQuotaPayload,
      {
        spacePolicy: SpaceQuotaPolicy;
        participantPolicy?: ParticipantQuotaPolicy;
      }
    >("space.get_quota", payload);
  }

  async updateSpaceQuotaPolicy(payload: SpaceUpdateQuotaPolicyPayload): Promise<SpaceQuotaPolicy> {
    const result = await this.sendAndWaitForResponse<
      SpaceUpdateQuotaPolicyPayload,
      { spacePolicy: SpaceQuotaPolicy }
    >("space.update_quota_policy", payload);
    return result.spacePolicy;
  }

  async getSpaceUsage(payload: SpaceGetUsagePayload): Promise<{
    spaceUsage: SpaceUsageSnapshot;
    participantUsage?: ParticipantUsageSnapshot;
    agentSessions?: AgentUsageSession[];
    globalLifetime?: UsageWindowSummary;
  }> {
    return this.sendAndWaitForResponse<
      SpaceGetUsagePayload,
      {
        spaceUsage: SpaceUsageSnapshot;
        participantUsage?: ParticipantUsageSnapshot;
        agentSessions?: AgentUsageSession[];
        globalLifetime?: UsageWindowSummary;
      }
    >("space.get_usage", payload);
  }

  async getTurnTrace(payload: SpaceGetTurnTracePayload): Promise<TurnTrace> {
    const result = await this.sendAndWaitForResponse<
      SpaceGetTurnTracePayload,
      { trace: TurnTrace }
    >("space.get_turn_trace", payload);
    return result.trace;
  }

  async listSpaceArtifacts(payload: SpaceListArtifactsPayload): Promise<{
    artifacts: SpaceArtifactSummary[];
    total: number;
  }> {
    return this.sendAndWaitForResponse<
      SpaceListArtifactsPayload,
      { artifacts: SpaceArtifactSummary[]; total: number }
    >("space.list_artifacts", payload);
  }

  async getSpaceArtifact(payload: SpaceGetArtifactPayload): Promise<SpaceArtifactDetail> {
    const result = await this.sendAndWaitForResponse<
      SpaceGetArtifactPayload,
      { artifact: SpaceArtifactDetail }
    >("space.get_artifact", payload);
    return result.artifact;
  }

  async resetAgentUsageSession(payload: SpaceResetAgentUsageSessionPayload): Promise<{
    closedSessionId?: string;
    activeSession: AgentUsageSession;
  }> {
    return this.sendAndWaitForResponse<
      SpaceResetAgentUsageSessionPayload,
      { closedSessionId?: string; activeSession: AgentUsageSession }
    >("space.reset_agent_usage_session", payload);
  }

  async resetSpace(payload: SpaceResetPayload): Promise<SpaceResetResult> {
    return this.sendAndWaitForResponse<SpaceResetPayload, SpaceResetResult>(
      "space.reset",
      payload,
      Math.max(this.requestTimeoutMs, 180_000),
    );
  }

  async getEffectiveTools(payload: SpaceGetEffectiveToolsPayload): Promise<EffectiveToolMatrix> {
    const result = await this.sendAndWaitForResponse<
      SpaceGetEffectiveToolsPayload,
      { matrix: EffectiveToolMatrix }
    >("space.get_effective_tools", payload);
    return result.matrix;
  }

  async announceSyncPeer(payload: SyncAnnouncePayload): Promise<SyncAnnounceResult> {
    return this.sendAndWaitForResponse<
      SyncAnnouncePayload,
      SyncAnnounceResult
    >('sync.announce', payload);
  }

  async querySyncResources(
    payload: SyncQueryResourcesPayload,
  ): Promise<SyncQueryResourcesResult> {
    return this.sendAndWaitForResponse<
      SyncQueryResourcesPayload,
      SyncQueryResourcesResult
    >('sync.query_resources', payload);
  }

  async pullSyncResources(
    payload: SyncPullResourcesPayload,
  ): Promise<SyncPullResourcesResult> {
    return this.sendAndWaitForResponse<
      SyncPullResourcesPayload,
      SyncPullResourcesResult
    >('sync.pull_resources', payload);
  }

  async startSpeechSession(payload: SpeechStartPayload): Promise<SpeechEventPayload> {
    const result = await this.sendAndWaitForResponse<
      SpeechStartPayload,
      { event: SpeechEventPayload }
    >('speech.start', payload);
    return result.event;
  }

  async sendSpeechAudioChunk(payload: SpeechAudioChunkPayload): Promise<SpeechEventPayload[]> {
    const result = await this.sendAndWaitForResponse<
      SpeechAudioChunkPayload,
      { events: SpeechEventPayload[] }
    >('speech.audio_chunk', payload);
    return result.events;
  }

  async controlSpeechSession(payload: SpeechControlPayload): Promise<SpeechEventPayload> {
    const result = await this.sendAndWaitForResponse<
      SpeechControlPayload,
      { event: SpeechEventPayload }
    >('speech.control', payload);
    return result.event;
  }

  /**
   * Register native adapter providers with the gateway.
   */
  async registerCapabilities(providers: AdapterCapabilityProvider[]): Promise<void> {
    const payload: CapabilitiesRegisterPayload = { providers };
    await this.sendAndWaitForResponse<CapabilitiesRegisterPayload, void>(
      'capabilities.register',
      payload,
    );
  }

  /**
   * Deregister native adapter providers from the gateway.
   */
  async deregisterCapabilities(providerIds: string[]): Promise<void> {
    const payload: CapabilitiesDeregisterPayload = { providerIds };
    await this.sendAndWaitForResponse<CapabilitiesDeregisterPayload, void>(
      'capabilities.deregister',
      payload,
    );
  }

  /**
   * Send invocation success for a previously received `capability.invoke`.
   */
  async sendCapabilityResult(payload: AdapterCapabilityResultPayload): Promise<void> {
    await this.send<AdapterCapabilityResultPayload>('capability.result', payload);
  }

  /**
   * Send invocation failure for a previously received `capability.invoke`.
   */
  async sendCapabilityError(payload: AdapterCapabilityErrorPayload): Promise<void> {
    await this.send<AdapterCapabilityErrorPayload>('capability.error', payload);
  }

  /**
   * Send a direct message to another agent in a space
   */
  async sendAgentMessage(
    spaceId: string,
    fromAgentId: string,
    toAgentId: string,
    content: string,
    spaceUid?: string,
  ): Promise<void> {
    const payload: AgentMessagePayload = {
      spaceId,
      spaceUid: spaceUid ?? spaceId,
      fromAgentId,
      toAgentId,
      content,
    };
    await this.send('agent_message', payload);
  }

  /**
   * Poke an idle agent to resume work
   */
  async pokeAgent(
    spaceId: string,
    targetAgentId: string,
    reason: string,
    unblockedByTurnId?: string,
    spaceUid?: string,
  ): Promise<void> {
    const payload: AgentPokePayload = {
      spaceId,
      spaceUid: spaceUid ?? spaceId,
      targetAgentId,
      reason,
      unblockedByTurnId,
    };
    await this.send('agent_poke', payload);
  }

  /**
   * Declare a task dependency between turns
   */
  async declareTaskDependency(
    spaceId: string,
    blockedTurnId: string,
    dependsOnTurnId: string,
    spaceUid?: string,
  ): Promise<void> {
    const payload: TaskDependencyPayload = {
      spaceId,
      spaceUid: spaceUid ?? spaceId,
      blockedTurnId,
      dependsOnTurnId,
    };
    await this.send('task_dependency', payload);
  }

  /**
   * Send a ping to the gateway
   */
  async ping(): Promise<void> {
    await this.sendAndWaitForResponse('ping', {});
  }

  /**
   * Subscribe to turn events
   */
  onTurnEvent(handler: TurnEventHandler): UnsubscribeHandler {
    this.turnEventHandlers.push(handler);
    return () => {
      this.turnEventHandlers = this.turnEventHandlers.filter(
        (h) => h !== handler,
      );
    };
  }

  /**
   * Subscribe to turn stream events
   */
  onTurnStream(handler: TurnStreamHandler): UnsubscribeHandler {
    this.turnStreamHandlers.push(handler);
    return () => {
      this.turnStreamHandlers = this.turnStreamHandlers.filter(
        (h) => h !== handler,
      );
    };
  }

  /**
   * Subscribe to space state updates
   */
  onSpaceState(handler: SpaceStateHandler): UnsubscribeHandler {
    this.spaceStateHandlers.push(handler);
    return () => {
      this.spaceStateHandlers = this.spaceStateHandlers.filter(
        (h) => h !== handler,
      );
    };
  }

  /**
   * Subscribe to profile-swap events for space agent assignments.
   */
  onSpaceAgentUpdated(handler: SpaceAgentUpdatedHandler): UnsubscribeHandler {
    this.spaceAgentUpdatedHandlers.push(handler);
    return () => {
      this.spaceAgentUpdatedHandlers = this.spaceAgentUpdatedHandlers.filter(
        (h) => h !== handler,
      );
    };
  }

  /**
   * Subscribe to notifications
   */
  onNotification(handler: NotificationHandler): UnsubscribeHandler {
    this.notificationHandlers.push(handler);
    return () => {
      this.notificationHandlers = this.notificationHandlers.filter(
        (h) => h !== handler,
      );
    };
  }

  /**
   * Subscribe to error events
   */
  onError(handler: ErrorHandler): UnsubscribeHandler {
    this.errorHandlers.push(handler);
    return () => {
      this.errorHandlers = this.errorHandlers.filter((h) => h !== handler);
    };
  }

  /**
   * Subscribe to inter-agent messages
   */
  onAgentMessage(handler: AgentMessageHandler): UnsubscribeHandler {
    this.agentMessageHandlers.push(handler);
    return () => {
      this.agentMessageHandlers = this.agentMessageHandlers.filter((h) => h !== handler);
    };
  }

  /**
   * Subscribe to agent poke events
   */
  onAgentPoke(handler: AgentPokeHandler): UnsubscribeHandler {
    this.agentPokeHandlers.push(handler);
    return () => {
      this.agentPokeHandlers = this.agentPokeHandlers.filter((h) => h !== handler);
    };
  }

  /**
   * Subscribe to agent idle notifications
   */
  onAgentIdle(handler: AgentIdleHandler): UnsubscribeHandler {
    this.agentIdleHandlers.push(handler);
    return () => {
      this.agentIdleHandlers = this.agentIdleHandlers.filter((h) => h !== handler);
    };
  }

  /**
   * Subscribe to task dependency declarations
   */
  onTaskDependency(handler: TaskDependencyHandler): UnsubscribeHandler {
    this.taskDependencyHandlers.push(handler);
    return () => {
      this.taskDependencyHandlers = this.taskDependencyHandlers.filter((h) => h !== handler);
    };
  }

  /**
   * Subscribe to task dependency resolved notifications
   */
  onTaskDependencyResolved(handler: TaskDependencyResolvedHandler): UnsubscribeHandler {
    this.taskDependencyResolvedHandlers.push(handler);
    return () => {
      this.taskDependencyResolvedHandlers = this.taskDependencyResolvedHandlers.filter((h) => h !== handler);
    };
  }

  /**
   * Subscribe to orchestrator command lifecycle events.
   */
  onOrchestratorEvent(handler: OrchestratorEventHandler): UnsubscribeHandler {
    this.orchestratorEventHandlers.push(handler);
    return () => {
      this.orchestratorEventHandlers = this.orchestratorEventHandlers.filter((h) => h !== handler);
    };
  }

  /**
   * Subscribe to speech session events.
   */
  onSpeechEvent(handler: SpeechEventHandler): UnsubscribeHandler {
    this.speechEventHandlers.push(handler);
    return () => {
      this.speechEventHandlers = this.speechEventHandlers.filter((h) => h !== handler);
    };
  }

  /**
   * Subscribe to adapter capability invocation requests.
   */
  onCapabilityInvoke(handler: CapabilityInvokeHandler): UnsubscribeHandler {
    this.capabilityInvokeHandlers.push(handler);
    return () => {
      this.capabilityInvokeHandlers = this.capabilityInvokeHandlers.filter(
        (h) => h !== handler,
      );
    };
  }
}

export default GatewayClient;
