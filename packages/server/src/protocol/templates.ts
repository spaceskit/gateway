import type { SpaceSummary } from "./spaces.js";

export interface ProfileModelConfigPayload {
  preferredModels: string[];
  fallbackModels?: string[];
  constraints?: Record<string, unknown>;
}

export type CommunicationModePayload = "async_notes" | "chat_first" | "structured_handoff";
export type ConversationTopologyPayload = "direct" | "shared_team_chat" | "broadcast_team";

export interface TemplateAgentDefinitionPayload {
  agentId: string;
  profileId: string;
  role?: "participant" | "global_coordinator" | "space_moderator";
  turnOrder?: number;
  isPrimary?: boolean;
}

export interface SpaceTemplateSummaryPayload {
  templateId: string;
  title: string;
  communicationMode: CommunicationModePayload;
  conversationTopology?: ConversationTopologyPayload;
  promptPackId?: string;
  agentPresetIds: string[];
  createdBy: string;
  updatedAt: string;
}

export interface SpaceTemplateRecordPayload {
  templateId: string;
  name: string;
  description?: string;
  status: "active" | "archived";
  activeRevision: number;
  communicationMode: CommunicationModePayload;
  conversationTopology?: ConversationTopologyPayload;
  promptPackId?: string;
  turnModel: string;
  agentDefinitions: TemplateAgentDefinitionPayload[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  /** Template catalog metadata */
  category?: string;
  complexityTier?: string;
  icon?: string;
  featured?: boolean;
  sortOrder?: number;
  agentCount?: number;
}

export interface SpaceTemplateListPayload {
  apiVersion?: string;
  includeArchived?: boolean;
  includeSystem?: boolean;
}

export interface SpaceTemplateListResponsePayload {
  templates: SpaceTemplateRecordPayload[];
}

export interface SpaceTemplateGetPayload {
  apiVersion?: string;
  templateId: string;
}

export interface SpaceTemplateGetResponsePayload {
  template: SpaceTemplateRecordPayload;
}

export interface SpacePreviewTemplatePayload {
  apiVersion?: string;
  templateId: string;
  resourceId?: string;
  name?: string;
  goal?: string;
}

export interface SpacePreviewTemplateResponsePayload {
  template: SpaceTemplateSummaryPayload;
  resolved: {
    templateId: string;
    templateRevision: number;
    name: string;
    goal?: string;
    resourceId: string;
    communicationMode: CommunicationModePayload;
    conversationTopology?: ConversationTopologyPayload;
    promptPackId?: string;
    turnModel: string;
    initialAgents: TemplateAgentDefinitionPayload[];
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
  visibility?: "shared" | "private";
  workspaceRoot?: string;
}

export interface SpaceCreateFromTemplateResponsePayload {
  template: SpaceTemplateSummaryPayload;
  space: SpaceSummary;
}

export interface SpaceSaveTemplatePayload {
  apiVersion?: string;
  templateId?: string;
  title: string;
  description?: string;
  communicationMode?: CommunicationModePayload;
  baseAgents?: TemplateAgentDefinitionPayload[];
  agentPresetIds?: string[];
  sourceSpaceId?: string;
  tags?: string[];
}

export interface SpaceSaveTemplateResponsePayload {
  template: SpaceTemplateSummaryPayload;
  created: boolean;
}

export interface SpaceTemplateArchivePayload {
  apiVersion?: string;
  idempotencyKey?: string;
  templateId: string;
}

export interface SpaceTemplateArchiveResponsePayload {
  template: SpaceTemplateRecordPayload;
  archived: boolean;
}
