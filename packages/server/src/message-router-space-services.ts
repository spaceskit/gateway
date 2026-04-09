import type { SpaceMemoryPolicy, ThinkingCapturePolicy } from "@spaceskit/core";
import type {
  SpaceAgentNotePayload,
  ExternalAgentRuntimeBindingPayload,
  McpDiscoveredAgentPayload,
  SpaceApproveMcpAgentPayload,
  SpaceApproveMcpAgentResponsePayload,
  SpaceAssignmentSummary,
  SpaceTemplateArchivePayload,
  SpaceTemplateArchiveResponsePayload,
  SpaceCreateFromTemplatePayload,
  SpaceExperienceObservationPayload,
  SpaceExperiencePayload,
  SpaceGetQuotaResponsePayload,
  SpaceTemplateGetPayload,
  SpaceTemplateGetResponsePayload,
  SpaceGetUsagePayload,
  SpaceGetUsageResponsePayload,
  SpaceInsightPayload,
  SpaceMemoryDocumentPayload,
  SpaceMcpEndpointPayload,
  SpaceTemplateListPayload,
  SpaceTemplateListResponsePayload,
  SpacePreviewTemplatePayload,
  SpaceSaveTemplatePayload,
  SpaceShareCreateInviteResponsePayload,
  SpaceShareJoinResponsePayload,
  SpaceShareListParticipantsResponsePayload,
  SpaceSetMcpEndpointPayload,
  SpaceSummary,
  SpaceTurnPayload,
  SpaceUserProfilePayload,
  SpaceUpdateQuotaPolicyPayload,
  SpaceWorkspacePayload,
} from "./protocol.js";

export interface SpaceTemplateService {
  listTemplates: (
    input: SpaceTemplateListPayload,
    principalId: string,
  ) => SpaceTemplateListResponsePayload["templates"];
  getTemplate: (
    input: SpaceTemplateGetPayload,
    principalId: string,
  ) => SpaceTemplateGetResponsePayload["template"];
  previewTemplate: (input: SpacePreviewTemplatePayload, principalId: string) => object;
  createFromTemplate: (input: SpaceCreateFromTemplatePayload, principalId: string) => Promise<object>;
  saveTemplate: (input: SpaceSaveTemplatePayload & { principalId: string }) => Promise<object>;
  archiveTemplate: (
    input: SpaceTemplateArchivePayload,
    principalId: string,
  ) => SpaceTemplateArchiveResponsePayload;
}

export interface SpaceContextService {
  linkSpaces: (
    sourceSpaceId: string,
    targetSpaceId: string,
    mode?: string,
  ) => any;
  unlinkSpaces: (sourceSpaceId: string, targetSpaceId: string) => boolean;
  shareContext: (sourceSpaceId: string, targetSpaceId: string, artifactId: string) => any;
  pullSharedContext: (sourceSpaceId: string, targetSpaceId: string, limit?: number) => any;
}

export interface SpaceSharingService {
  evaluateAccess: (input: {
    spaceId: string;
    principalId?: string;
    action: "read" | "write";
  }) => {
    allowed: boolean;
    enforced: boolean;
    mode?: "read_only" | "collaborator";
    reason?: string;
  };
  createInvite: (input: {
    spaceId: string;
    issuedByPrincipalId: string;
    mode: "read_only" | "collaborator";
    expiresInSeconds?: number;
  }) => Omit<SpaceShareCreateInviteResponsePayload["invite"], "spaceUid">;
  joinInvite: (input: {
    spaceId: string;
    inviteToken: string;
    principalId: string;
    principalType?: string;
    deviceId?: string;
    devicePublicKey?: string;
    identityModeHint?: "device_key" | "strict_apple_id";
    appleIdAssertion?: string;
    joinRoute?: "direct" | "relay_proxy";
    relaySessionToken?: string;
  }) => Omit<SpaceShareJoinResponsePayload["participant"], "spaceUid">;
  revokeInvite: (input: { spaceId: string; inviteId: string; requestedByPrincipalId: string }) => boolean;
  revokeParticipant: (input: {
    spaceId: string;
    participantId: string;
    requestedByPrincipalId: string;
  }) => boolean;
  listParticipants: (input: {
    spaceId: string;
    requestedByPrincipalId: string;
  }) => Array<Omit<SpaceShareListParticipantsResponsePayload["participants"][number], "spaceUid">>;
  getActiveParticipant?: (
    spaceId: string,
    principalId: string,
  ) => {
    participantId: string;
    mode: "read_only" | "collaborator";
    joinedViaInviteId?: string;
  } | null;
}

export interface TurnHistoryService {
  listSpaceTurns: (input: {
    spaceId: string;
    limit: number;
    offset: number;
    lastSeenTurnId?: string;
  }) => Promise<{ turns: SpaceTurnPayload[]; total: number }>;
}

export interface OrchestrationJournalService {
  listEntries: (input: {
    spaceId: string;
    turnId?: string;
    limit: number;
    offset: number;
  }) => Promise<{
    entries: Array<{
      eventId: string;
      spaceId: string;
      turnId?: string;
      seq: number;
      eventType: string;
      actorId: string;
      lineageId?: string;
      hopCount: number;
      payload: Record<string, unknown>;
      createdAt: string;
    }>;
    total: number;
  }>;
}

export interface SpaceMcpService {
  isExternalProfile: () => boolean;
  isConfiguredForSpace: (spaceId: string) => boolean;
  getSpaceEndpoint: (spaceId: string) => SpaceMcpEndpointPayload | null;
  setSpaceEndpoint: (input: SpaceSetMcpEndpointPayload) => Promise<SpaceMcpEndpointPayload>;
  clearSpaceEndpoint: (spaceId: string) => Promise<boolean>;
  discoverSpaceAgents: (spaceId: string) => Promise<{
    endpointId?: string;
    agents: McpDiscoveredAgentPayload[];
  }>;
  approveSpaceAgent: (input: SpaceApproveMcpAgentPayload) => Promise<{
    assignment: unknown;
    binding: ExternalAgentRuntimeBindingPayload;
  }>;
  listBindings: (spaceId: string) => ExternalAgentRuntimeBindingPayload[];
  removeBinding: (spaceId: string, agentId: string) => boolean;
}

export interface SpaceWorkspaceService {
  ensureWorkspace: (spaceId: string) => Promise<SpaceWorkspacePayload>;
  getWorkspace: (spaceId: string) => Promise<SpaceWorkspacePayload>;
  setWorkspace: (spaceId: string, workspaceRoot?: string | null) => Promise<SpaceWorkspacePayload>;
}

export interface SpaceEndIncognitoSessionOutcome {
  ended: boolean;
  purged: boolean;
  reason: "manual" | "inactivity" | "policy_change";
  sessionId?: string;
  purgedAt?: string;
}

export interface SpaceMemoryPolicyService {
  getThinkingCapturePolicy: (spaceId: string) => ThinkingCapturePolicy;
  getSpaceMemoryPolicy: (spaceId: string) => SpaceMemoryPolicy;
  setThinkingCapturePolicy: (
    spaceId: string,
    thinkingCapturePolicy: ThinkingCapturePolicy,
  ) => Promise<ThinkingCapturePolicy> | ThinkingCapturePolicy;
  setSpaceMemoryPolicy: (
    spaceId: string,
    memoryPolicy: SpaceMemoryPolicy,
  ) => Promise<SpaceEndIncognitoSessionOutcome | undefined> | SpaceEndIncognitoSessionOutcome | undefined;
  endIncognitoSession: (
    spaceId: string,
    reason?: "manual" | "inactivity" | "policy_change",
  ) => Promise<SpaceEndIncognitoSessionOutcome> | SpaceEndIncognitoSessionOutcome;
}

export interface SpaceChangeSetService {
  createChangeSet: (input: {
    spaceId: string;
    principalId: string;
    title?: string;
    description?: string;
    adapter?: "filesystem" | "git";
    targetBranch?: string;
    expiresInSeconds?: number;
  }) => Promise<any> | any;
  listChangeSets: (input: {
    spaceId: string;
    principalId: string;
    statuses?: Array<"draft" | "uploaded" | "pending_review" | "approved" | "applied" | "rejected" | "expired">;
    limit?: number;
    offset?: number;
  }) => Array<any>;
  uploadFileInit: (input: {
    spaceId: string;
    changeSetId: string;
    principalId: string;
    relativePath: string;
  }) => Promise<any> | any;
  uploadFileComplete: (input: {
    spaceId: string;
    changeSetId: string;
    principalId: string;
    uploadId: string;
    contentBase64?: string;
    sourcePath?: string;
    expectedSha256?: string;
  }) => Promise<any> | any;
  submitChangeSet: (input: { spaceId: string; changeSetId: string; principalId: string }) => any;
  reviewChangeSet: (input: {
    spaceId: string;
    changeSetId: string;
    principalId: string;
    decision: "approved" | "rejected";
    comment?: string;
  }) => Promise<any> | any;
  applyChangeSet: (input: { spaceId: string; changeSetId: string; principalId: string }) => Promise<any> | any;
  getChangeSetDiff: (spaceId: string, changeSetId: string) => Promise<any> | any;
}

export interface SpaceQuotaService {
  getQuota: (spaceId: string, principalId?: string) => SpaceGetQuotaResponsePayload;
  updateQuotaPolicy: (input: SpaceUpdateQuotaPolicyPayload & { updatedBy: string }) => any;
  getUsage: (
    spaceId: string,
    principalId?: string,
    options?: { includeAgentSessions?: boolean; includeGlobalLifetime?: boolean },
  ) => SpaceGetUsageResponsePayload;
  resetAgentUsageSession: (spaceId: string, agentId: string, principalId: string) => any;
}

export interface SpaceTurnTraceService {
  getTurnTrace: (input: {
    spaceId: string;
    turnId: string;
    limit?: number;
    offset?: number;
  }) => Promise<any> | any;
  listActivityLog: (input: {
    spaceId: string;
    turnId?: string;
    limit?: number;
    offset?: number;
    includeSystem?: boolean;
  }) => Promise<any> | any;
}

export interface SpaceArtifactReaderService {
  listArtifacts: (input: {
    spaceId: string;
    turnId?: string;
    limit?: number;
    offset?: number;
  }) => Promise<any> | any;
  getArtifact: (input: { spaceId: string; artifactId: string }) => Promise<any> | any;
  getDebugArtifact: (input: { spaceId: string; artifactId: string }) => Promise<any> | any;
}

export interface SpaceToolPolicyService {
  getEffectiveTools: (input: {
    spaceId: string;
    principalId?: string;
    deviceId?: string;
    agentId?: string;
    accessMode?: "default" | "full_access";
  }) => Promise<any> | any;
}

export interface MemoryLifecycleService {
  listExperiences: (input: {
    spaceId: string;
    limit?: number;
    offset?: number;
  }) => {
    experiences: SpaceExperiencePayload[];
    total: number;
    nextOffset?: number;
  };
  getExperience: (input: { spaceId: string; experienceId: string }) => {
    experience?: SpaceExperiencePayload;
    observations: SpaceExperienceObservationPayload[];
  };
  listInsights: (input: {
    spaceId: string;
    status?: string;
    limit?: number;
    offset?: number;
  }) => {
    insights: SpaceInsightPayload[];
    total: number;
    nextOffset?: number;
  };
  getInsight: (insightId: string) => SpaceInsightPayload | undefined;
  acceptInsight: (insightId: string) => SpaceInsightPayload | undefined;
  rejectInsight: (insightId: string) => SpaceInsightPayload | undefined;
  dismissInsight: (insightId: string) => SpaceInsightPayload | undefined;
  getSpaceAgentNotes: (input: { spaceId: string; agentId?: string }) => {
    note?: SpaceAgentNotePayload;
    notes: SpaceAgentNotePayload[];
  };
  updateSpaceAgentNotes: (input: { spaceId: string; agentId: string; notes: string }) => SpaceAgentNotePayload | undefined;
  getUserProfile: (principalId?: string) => SpaceUserProfilePayload;
  updateUserProfile: (input: { principalId?: string; profile: Record<string, unknown> }) => SpaceUserProfilePayload;
  listMemories: (input: {
    principalId?: string;
    spaceId?: string;
    agentId?: string;
    type?: "episodic" | "semantic" | "procedural" | "observation";
    limit?: number;
    offset?: number;
  }) => Promise<{
    memories: SpaceMemoryDocumentPayload[];
    total: number;
    nextOffset?: number;
  }> | {
    memories: SpaceMemoryDocumentPayload[];
    total: number;
    nextOffset?: number;
  };
  deleteMemory: (memoryId: string) => Promise<{ deleted: boolean }> | { deleted: boolean };
  updateMemoryImportance: (
    memoryId: string,
    importance: number,
  ) => Promise<SpaceMemoryDocumentPayload | undefined> | SpaceMemoryDocumentPayload | undefined;
}

export interface RouterSpaceDecorators {
  decorateAssignments: (spaceId: string, assignments: SpaceAssignmentSummary[]) => SpaceAssignmentSummary[];
  decorateSpaceSummary: (space: SpaceSummary) => Promise<SpaceSummary>;
  decorateSpaceListSummaries: (spaces: SpaceSummary[]) => Promise<SpaceSummary[]>;
  resolveSpaceId: (spaceUidRaw: string) => Promise<string | null>;
  resolveSpaceUid: (spaceIdRaw: string) => Promise<string>;
}
