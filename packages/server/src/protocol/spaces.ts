import type { SpaceMemoryPolicy, ThinkingCapturePolicy } from "@spaceskit/core";

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
  visibility?: "shared" | "private";
  turnModelConfig?: Record<string, unknown>;
  maxTurns?: number;
  thinkingCapturePolicy?: ThinkingCapturePolicy;
  moderatorProfileId?: string;
  initialAgents?: SpaceAddAgentPayload[];
}

export interface SpaceGetPayload {
  apiVersion?: string;
  spaceId: string;
}

export interface SpaceSetThinkingCapturePolicyPayload {
  apiVersion?: string;
  idempotencyKey?: string;
  spaceId: string;
  thinkingCapturePolicy: ThinkingCapturePolicy;
}

export interface SpaceSetThinkingCapturePolicyResponsePayload {
  space: SpaceSummary;
}

export interface SpaceGetMemoryPolicyPayload {
  apiVersion?: string;
  spaceId: string;
}

export interface SpaceGetMemoryPolicyResponsePayload {
  spaceId: string;
  memoryPolicy: SpaceMemoryPolicy;
}

export interface SpaceSetMemoryPolicyPayload {
  apiVersion?: string;
  idempotencyKey?: string;
  spaceId: string;
  memoryPolicy: SpaceMemoryPolicy;
}

export interface SpaceSetMemoryPolicyResponsePayload {
  space: SpaceSummary;
}

export interface SpaceEndIncognitoSessionPayload {
  apiVersion?: string;
  spaceId: string;
}

export interface SpaceEndIncognitoSessionResponsePayload {
  space: SpaceSummary;
  ended: boolean;
  reason: string;
  purgedAt?: string;
  sessionId?: string;
}

export interface SpaceListPayload {
  apiVersion?: string;
  statuses?: string[];
  resourceId?: string;
  limit?: number;
}

export interface SpaceArchivePayload {
  apiVersion?: string;
  idempotencyKey?: string;
  spaceId: string;
}

export interface SpaceDeletePayload {
  apiVersion?: string;
  idempotencyKey?: string;
  spaceId: string;
}

export interface SpaceAddAgentPayload {
  apiVersion?: string;
  idempotencyKey?: string;
  spaceId: string;
  agentId: string;
  profileId: string;
  securityScope?: Record<string, unknown>;
  spawnContext?: string;
  contextOverrides?: Record<string, unknown>;
  role?: "participant" | "global_coordinator" | "space_moderator";
  turnOrder?: number;
  isPrimary?: boolean;
}

export interface SpaceRemoveAgentPayload {
  apiVersion?: string;
  idempotencyKey?: string;
  spaceId: string;
  agentId: string;
}

export interface SpaceUpdateAgentAssignmentPayload {
  apiVersion?: string;
  idempotencyKey?: string;
  spaceId: string;
  agentId: string;
  profileId?: string;
  securityScope?: Record<string, unknown> | null;
  spawnContext?: string | null;
  contextOverrides?: Record<string, unknown> | null;
  role?: "participant" | "global_coordinator" | "space_moderator";
  turnOrder?: number;
  isPrimary?: boolean;
  resetSession?: boolean;
}

export interface SpaceSetOrchestratorPayload {
  apiVersion?: string;
  idempotencyKey?: string;
  spaceId: string;
  profileId: string;
}

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
  transport: "sse" | "stdio";
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

export interface SpaceAddSkillPayload {
  apiVersion?: string;
  idempotencyKey?: string;
  spaceId: string;
  skillId: string;
}

export interface SpaceRemoveSkillPayload {
  apiVersion?: string;
  idempotencyKey?: string;
  spaceId: string;
  skillId: string;
}

export interface SpaceListSkillsPayload {
  apiVersion?: string;
  spaceId: string;
}

export interface SpaceWorkspacePayload {
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

export interface SpaceSetWorkspacePayload {
  apiVersion?: string;
  spaceId: string;
  workspaceRoot?: string | null;
}

export interface SpaceGetWorkspacePayload {
  apiVersion?: string;
  spaceId: string;
}

export interface SpaceGetWorkspaceResponsePayload {
  workspace: SpaceWorkspacePayload;
}

export interface SpaceSetWorkspaceResponsePayload {
  workspace: SpaceWorkspacePayload;
}

export interface SpaceResourcePayload {
  resourceId: string;
  spaceId: string;
  spaceUid: string;
  uri: string;
  type: "folder" | "url";
  label?: string;
  addedAt: string;
}

export interface SpaceAddResourcePayload {
  apiVersion?: string;
  idempotencyKey?: string;
  resourceId?: string;
  spaceId: string;
  uri: string;
  type: "folder" | "url";
  label?: string;
}

export interface SpaceAddResourceResponsePayload {
  resource: SpaceResourcePayload;
}

export interface SpaceRemoveResourcePayload {
  apiVersion?: string;
  idempotencyKey?: string;
  spaceId: string;
  resourceId: string;
}

export interface SpaceRemoveResourceResponsePayload {
  removed: boolean;
  spaceId: string;
  spaceUid: string;
  resourceId: string;
}

export interface SpaceListResourcesPayload {
  apiVersion?: string;
  spaceId: string;
}

export interface SpaceListResourcesResponsePayload {
  spaceId: string;
  spaceUid: string;
  resources: SpaceResourcePayload[];
}

export interface SpaceListTurnsPayload {
  apiVersion?: string;
  spaceId?: string;
  spaceUid?: string;
  limit?: number;
  offset?: number;
  lastSeenTurnId?: string;
}

export interface SpaceTurnPayload {
  turnId: string;
  agentId: string;
  status: string;
  inputText?: string;
  outputText?: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  createdAt: string;
  completedAt?: string;
  replyToTurnId?: string;
}

export interface SpaceListTurnsResponsePayload {
  spaceId: string;
  spaceUid: string;
  turns: SpaceTurnPayload[];
  total: number;
  nextOffset?: number;
}

export interface SpaceListOrchestrationJournalPayload {
  apiVersion?: string;
  spaceId?: string;
  spaceUid?: string;
  turnId?: string;
  limit?: number;
  offset?: number;
}

export interface OrchestrationJournalEntryPayload {
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
  entries: OrchestrationJournalEntryPayload[];
  total: number;
  nextOffset?: number;
}

export interface SpaceAddSkillResponsePayload {
  spaceId: string;
  spaceUid: string;
  skillId: string;
  skills: string[];
  space?: unknown;
}

export interface SpaceRemoveSkillResponsePayload {
  removed: boolean;
  spaceId: string;
  spaceUid: string;
  skillId: string;
  skills: string[];
  space?: unknown;
}

export interface SpaceListSkillsResponsePayload {
  spaceId: string;
  spaceUid: string;
  skills: string[];
}

export interface SpaceAssignmentSummary {
  spaceId: string;
  agentId: string;
  profileId: string;
  securityScope?: Record<string, unknown>;
  spawnContext?: string;
  contextOverrides?: Record<string, unknown>;
  role: "participant" | "global_coordinator" | "space_moderator";
  turnOrder: number;
  isPrimary: boolean;
  assignedAt: string | Date;
  runtimeKind?: "local" | "external_mcp";
  endpointId?: string;
  remoteAgentId?: string;
  displayName?: string;
}

export interface SpaceMcpEndpointPayload {
  endpointId: string;
  spaceId: string;
  transport: "sse" | "stdio";
  endpoint: string;
  args: string[];
  secretRef?: string;
  enabled: boolean;
  healthStatus: "unknown" | "ok" | "degraded" | "error";
  healthMessage?: string;
  lastConnectedAt?: string;
  lastErrorAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SpaceGetMcpEndpointResponsePayload {
  spaceId: string;
  endpoint?: SpaceMcpEndpointPayload;
  fallbackEnabled: boolean;
}

export interface SpaceSetMcpEndpointResponsePayload {
  endpoint: SpaceMcpEndpointPayload;
}

export interface SpaceClearMcpEndpointResponsePayload {
  spaceId: string;
  cleared: boolean;
}

export interface McpDiscoveredAgentPayload {
  remoteAgentId: string;
  displayName: string;
  description?: string;
  metadata?: Record<string, unknown>;
}

export interface SpaceDiscoverMcpAgentsResponsePayload {
  spaceId: string;
  endpointId?: string;
  agents: McpDiscoveredAgentPayload[];
}

export interface ExternalAgentRuntimeBindingPayload {
  runtimeKind: "external_mcp";
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
  assignment: SpaceAssignmentSummary;
  binding: ExternalAgentRuntimeBindingPayload;
}

export interface SpaceSummary {
  id: string;
  spaceUid: string;
  workspace?: SpaceWorkspacePayload;
  status?: string;
  resourceId: string;
  name: string;
  goal?: string;
  orchestratorProfileId?: string;
  templateId?: string;
  turnModel: string;
  turnModelConfig?: Record<string, unknown>;
  thinkingCapturePolicy?: ThinkingCapturePolicy;
  memoryPolicy?: SpaceMemoryPolicy;
  skillIds?: string[];
  agents: SpaceAssignmentSummary[];
  capabilities: string[];
  capabilityOverrides: Record<string, string>;
  maxTurns?: number;
  visibility: "shared" | "private";
  moderatorProfileId?: string;
  archivedAt?: string | Date;
  deletedAt?: string | Date;
  createdAt: string | Date;
  updatedAt: string | Date;
}

export interface SpaceArchiveResponsePayload {
  space: SpaceSummary;
  archived: boolean;
}

export interface SpaceDeleteResponsePayload {
  spaceId: string;
  spaceUid: string;
  deleted: boolean;
  space?: SpaceSummary | null;
}
