import type { ProfileModelConfigPayload } from "./templates.js";

export interface AgentDefinitionSummaryPayload {
  agentDefinitionId: string;
  personaId?: string;
  name: string;
  description: string;
  instructions: string;
  defaultSkillIds: string[];
  providerHint?: string;
  modelHint?: string;
  modelConfig?: ProfileModelConfigPayload;
  isDefault: boolean;
  status: "active" | "archived";
  activeRevision: number;
  source: string;
  createdAt: string;
  updatedAt: string;
}

export interface PersonaSummaryPayload {
  personaId: string;
  name: string;
  description: string;
  tone?: string;
  style?: string;
  emotionalLayer?: string;
  constraints: string[];
  instructions: string;
  isDefault: boolean;
  status: "active" | "archived";
  activeRevision: number;
  source: string;
  createdAt: string;
  updatedAt: string;
}

export type CompiledInstructionSectionKey =
  | "system_scaffold"
  | "agent_definition"
  | "persona"
  | "skills"
  | "policy_appendices"
  | "workspace_context";

export interface CompiledInstructionSectionPayload {
  key: CompiledInstructionSectionKey;
  title: string;
  content: string;
}

export interface CompiledInstructionsPreviewPayload {
  agentDefinitionId: string;
  personaId?: string;
  sections: CompiledInstructionSectionPayload[];
  compiledText: string;
  generatedAt: string;
}

export interface IdentityListAgentDefinitionsPayload {
  apiVersion?: string;
  includeArchived?: boolean;
}

export interface IdentityListAgentDefinitionsResponsePayload {
  agentDefinitions: AgentDefinitionSummaryPayload[];
}

export interface IdentityGetAgentDefinitionPayload {
  apiVersion?: string;
  agentDefinitionId: string;
}

export interface IdentityGetAgentDefinitionResponsePayload {
  agentDefinition: AgentDefinitionSummaryPayload;
}

export interface IdentityCreateAgentDefinitionPayload {
  apiVersion?: string;
  idempotencyKey?: string;
  agentDefinitionId?: string;
  personaId?: string;
  name: string;
  description?: string;
  instructions?: string;
  defaultSkillIds?: string[];
  providerHint?: string;
  modelHint?: string;
  modelConfig?: ProfileModelConfigPayload;
  isDefault?: boolean;
}

export interface IdentityCreateAgentDefinitionResponsePayload {
  agentDefinition: AgentDefinitionSummaryPayload;
  created: boolean;
}

export interface IdentityUpdateAgentDefinitionPayload {
  apiVersion?: string;
  idempotencyKey?: string;
  agentDefinitionId: string;
  personaId?: string;
  name?: string;
  description?: string;
  instructions?: string;
  defaultSkillIds?: string[];
  providerHint?: string;
  modelHint?: string;
  modelConfig?: ProfileModelConfigPayload;
  isDefault?: boolean;
}

export interface IdentityUpdateAgentDefinitionResponsePayload {
  agentDefinition: AgentDefinitionSummaryPayload;
  newRevision: number;
}

export interface IdentityArchiveAgentDefinitionPayload {
  apiVersion?: string;
  idempotencyKey?: string;
  agentDefinitionId: string;
}

export interface IdentityArchiveAgentDefinitionResponsePayload {
  agentDefinition: AgentDefinitionSummaryPayload;
  archived: boolean;
}

export interface IdentityListPersonasPayload {
  apiVersion?: string;
  includeArchived?: boolean;
}

export interface IdentityListPersonasResponsePayload {
  personas: PersonaSummaryPayload[];
}

export interface IdentityGetPersonaPayload {
  apiVersion?: string;
  personaId: string;
}

export interface IdentityGetPersonaResponsePayload {
  persona: PersonaSummaryPayload;
}

export interface IdentityCreatePersonaPayload {
  apiVersion?: string;
  idempotencyKey?: string;
  personaId?: string;
  name: string;
  description?: string;
  tone?: string;
  style?: string;
  emotionalLayer?: string;
  constraints?: string[];
  instructions?: string;
  isDefault?: boolean;
}

export interface IdentityCreatePersonaResponsePayload {
  persona: PersonaSummaryPayload;
  created: boolean;
}

export interface IdentityUpdatePersonaPayload {
  apiVersion?: string;
  idempotencyKey?: string;
  personaId: string;
  name?: string;
  description?: string;
  tone?: string;
  style?: string;
  emotionalLayer?: string;
  constraints?: string[];
  instructions?: string;
  isDefault?: boolean;
}

export interface IdentityUpdatePersonaResponsePayload {
  persona: PersonaSummaryPayload;
  newRevision: number;
}

export interface IdentityArchivePersonaPayload {
  apiVersion?: string;
  idempotencyKey?: string;
  personaId: string;
}

export interface IdentityArchivePersonaResponsePayload {
  persona: PersonaSummaryPayload;
  archived: boolean;
}

export interface IdentityPreviewCompiledInstructionsPayload {
  apiVersion?: string;
  agentDefinitionId: string;
  workspaceContext?: string;
}

export interface IdentityPreviewCompiledInstructionsResponsePayload {
  preview: CompiledInstructionsPreviewPayload;
}

export interface IdentityPreviewRuntimeSystemPromptPayload {
  apiVersion?: string;
  spaceId: string;
  agentId?: string;
  profileId?: string;
}

export interface RuntimeSystemPromptSectionPayload {
  key:
    | "agent_definition"
    | "persona"
    | "active_skill_context"
    | "workspace_context"
    | "conversation_prompt"
    | "assignment_context";
  title: string;
  content: string;
}

export interface IdentityPreviewRuntimeSystemPromptResponsePayload {
  preview: {
    spaceId: string;
    agentId?: string;
    profileId: string;
    personaId?: string;
    targetKind: "agent_assignment" | "space_profile";
    conversationTopology?: "direct" | "shared_team_chat" | "broadcast_team";
    promptPackId?: string;
    sections: RuntimeSystemPromptSectionPayload[];
    compiledText: string;
    generatedAt: string;
  };
}

export type PromptBudgetClassPayload = "full" | "compact" | "minimal" | "cli";

export interface SystemPromptVariantPayload {
  budgetClass: PromptBudgetClassPayload;
  label: string;
  tokenEstimate: number;
  sections: CompiledInstructionSectionPayload[];
  compiledText: string;
}

export interface IdentityPreviewSystemPromptMatrixPayload {
  apiVersion?: string;
  agentDefinitionId: string;
  spaceId?: string;
  agentId?: string;
}

export interface IdentityPreviewSystemPromptMatrixResponsePayload {
  matrix: {
    agentDefinitionId: string;
    personaId?: string;
    generatedAt: string;
    variants: SystemPromptVariantPayload[];
  };
}

export interface DeviceIdentityPayload {
  deviceId: string;
  principalId: string;
  publicKey: string;
  platform?: string;
  keyVersion: string;
  status: "active" | "revoked" | "rotated";
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

export interface AuthRegisterDeviceResponsePayload {
  device: DeviceIdentityPayload;
  created: boolean;
}

export interface AuthRotateDeviceKeyPayload {
  apiVersion?: string;
  deviceId: string;
  nextPublicKey: string;
  platform?: string;
}

export interface AuthRotateDeviceKeyResponsePayload {
  device: DeviceIdentityPayload;
}

export interface AuthRevokeDevicePayload {
  apiVersion?: string;
  deviceId: string;
}

export interface AuthRevokeDeviceResponsePayload {
  deviceId: string;
  revoked: boolean;
  device?: DeviceIdentityPayload;
}

export interface AuthListDevicesPayload {
  apiVersion?: string;
  includeRevoked?: boolean;
}

export interface AuthListDevicesResponsePayload {
  devices: DeviceIdentityPayload[];
}

export interface AuthIssueHttpPrincipalTokenPayload {
  apiVersion?: string;
  ttlSeconds?: number;
}

export interface AuthIssueHttpPrincipalTokenResponsePayload {
  token: string;
  tokenType: "Bearer";
  principalId: string;
  deviceId?: string;
  issuedAt: string;
  expiresAt: string;
  ttlSeconds: number;
}
