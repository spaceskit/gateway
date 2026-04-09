export type GatewaySkillStatusPayload = "active" | "archived";

export interface GatewaySkillEntryPayload {
  skillId: string;
  name: string;
  description?: string;
  contentMarkdown: string;
  sourceRef?: string;
  tags: string[];
  status: GatewaySkillStatusPayload;
  createdAt: string;
  updatedAt: string;
}

export interface GatewaySkillListPayload {
  apiVersion?: string;
  query?: string;
  tags?: string[];
  status?: GatewaySkillStatusPayload | "all";
  limit?: number;
}

export interface GatewaySkillListResponsePayload {
  skills: GatewaySkillEntryPayload[];
}

export interface GatewaySkillGetPayload {
  apiVersion?: string;
  skillId: string;
}

export interface GatewaySkillGetResponsePayload {
  skill: GatewaySkillEntryPayload;
}

export interface GatewaySkillUpsertPayload {
  apiVersion?: string;
  skillId?: string;
  name: string;
  description?: string;
  contentMarkdown: string;
  sourceRef?: string;
  tags?: string[];
  status?: GatewaySkillStatusPayload;
}

export interface GatewaySkillUpsertResponsePayload {
  skill: GatewaySkillEntryPayload;
  created: boolean;
}

export interface GatewaySkillDeletePayload {
  apiVersion?: string;
  skillId: string;
}

export interface GatewaySkillDeleteResponsePayload {
  skillId: string;
  deleted: boolean;
}

export type GatewayKnowledgeBaseEntryKindPayload = "web" | "file" | "folder";
export type GatewayKnowledgeBaseScopeTypePayload = "global" | "space";

export interface GatewayKnowledgeBaseEntryPayload {
  entryId: string;
  name: string;
  kind: GatewayKnowledgeBaseEntryKindPayload;
  uri: string;
  description?: string;
  tags: string[];
  scopeType: GatewayKnowledgeBaseScopeTypePayload;
  spaceId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface GatewayListKnowledgeBaseEntriesPayload {
  apiVersion?: string;
  spaceId?: string;
  query?: string;
  tags?: string[];
  kinds?: GatewayKnowledgeBaseEntryKindPayload[];
  limit?: number;
}

export interface GatewayListKnowledgeBaseEntriesResponsePayload {
  entries: GatewayKnowledgeBaseEntryPayload[];
}

export interface GatewayUpsertKnowledgeBaseEntryPayload {
  apiVersion?: string;
  entryId?: string;
  name: string;
  kind: GatewayKnowledgeBaseEntryKindPayload;
  uri: string;
  description?: string;
  tags?: string[];
  scopeType: GatewayKnowledgeBaseScopeTypePayload;
  spaceId?: string;
}

export interface GatewayUpsertKnowledgeBaseEntryResponsePayload {
  entry: GatewayKnowledgeBaseEntryPayload;
}

export interface GatewayDeleteKnowledgeBaseEntryPayload {
  apiVersion?: string;
  entryId: string;
}

export interface GatewayDeleteKnowledgeBaseEntryResponsePayload {
  entryId: string;
  deleted: boolean;
}

export interface GatewayCapabilityGrantPayload {
  principalId: string;
  deviceId: string;
  capabilityId: string;
  level: "read" | "write" | "execute";
  source: string;
  reason: string;
  grantedBy: string;
  grantedAt: string;
  expiresAt?: string;
  revokedAt?: string;
  updatedAt: string;
}

export interface GatewayListCapabilityGrantsPayload {
  apiVersion?: string;
  principalId?: string;
  deviceId?: string;
  includeRevoked?: boolean;
  includeExpired?: boolean;
}

export interface GatewayListCapabilityGrantsResponsePayload {
  grants: GatewayCapabilityGrantPayload[];
}

export interface GatewayGrantCapabilityPayload {
  apiVersion?: string;
  principalId?: string;
  deviceId?: string;
  capabilityId: string;
  reason?: string;
  expiresAt?: string;
}

export interface GatewayGrantCapabilityResponsePayload {
  grant: GatewayCapabilityGrantPayload;
}

export interface GatewayRevokeCapabilityPayload {
  apiVersion?: string;
  principalId?: string;
  deviceId?: string;
  capabilityId: string;
  reason?: string;
}

export interface GatewayRevokeCapabilityResponsePayload {
  revoked: boolean;
  capabilityId: string;
  principalId: string;
  deviceId: string;
  grant?: GatewayCapabilityGrantPayload;
}
