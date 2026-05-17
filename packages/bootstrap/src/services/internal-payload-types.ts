export interface ProfileModelConfigPayload {
  preferredModels: string[];
  fallbackModels?: string[];
  constraints?: Record<string, unknown>;
}

export interface AgentDefinitionSummaryPayload {
  agentDefinitionId: string;
  personaId?: string;
  name: string;
  description: string;
  instructions: string;
  defaultSkillIds: string[];
  providerHint?: string;
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

export interface IdentityPreviewSystemPromptMatrixPayload {
  apiVersion?: string;
  agentDefinitionId: string;
  spaceId?: string;
  agentId?: string;
}

export type PromptBudgetClassPayload = "full" | "compact" | "minimal" | "cli";

export interface SystemPromptVariantPayload {
  budgetClass: PromptBudgetClassPayload;
  label: string;
  tokenEstimate: number;
  sections: CompiledInstructionSectionPayload[];
  compiledText: string;
}

export interface IdentityPreviewSystemPromptMatrixResponsePayload {
  matrix: {
    agentDefinitionId: string;
    personaId?: string;
    generatedAt: string;
    variants: SystemPromptVariantPayload[];
  };
}

export type LibrarySourceKind = "installed" | "scanned" | "linked" | "verified" | "system";
export type LibraryEntryStatus = "enabled" | "disabled" | "archived";
export type LibraryEntrySyncState = "ready" | "missing" | "parse_error";

export interface LibraryEntryPayload {
  entryId: string;
  skillId?: string;
  name: string;
  description?: string;
  contentMarkdown?: string;
  sourceKind: LibrarySourceKind;
  sourceRef?: string;
  syncState?: LibraryEntrySyncState;
  provenance: Record<string, unknown>;
  tags: string[];
  status: LibraryEntryStatus;
  importable: boolean;
  importedSkillId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface LibraryListEntriesPayload {
  apiVersion?: string;
  query?: string;
  sourceKinds?: LibrarySourceKind[];
  includeArchived?: boolean;
  includeContent?: boolean;
  limit?: number;
  status?: LibraryEntryStatus | "all";
  tags?: string[];
}

export interface LibraryListEntriesResponsePayload {
  entries: LibraryEntryPayload[];
}

export interface LibraryGetEntryResponsePayload {
  entry: LibraryEntryPayload;
}

export interface LibrarySaveSkillPayload {
  apiVersion?: string;
  idempotencyKey?: string;
  entryId?: string;
  skillId?: string;
  name: string;
  description?: string;
  contentMarkdown: string;
  tags?: string[];
  sourceKind?: LibrarySourceKind;
  sourceRef?: string;
  enabled?: boolean;
  status?: LibraryEntryStatus;
}

export interface LibrarySaveSkillResponsePayload {
  entry: LibraryEntryPayload;
  created: boolean;
}

export interface LibraryImportEntryPayload {
  apiVersion?: string;
  idempotencyKey?: string;
  entryId: string;
  skillId?: string;
  name?: string;
}

export interface LibraryImportEntryResponsePayload {
  entry: LibraryEntryPayload;
  created: boolean;
}

export interface LibraryArchiveEntryPayload {
  apiVersion?: string;
  idempotencyKey?: string;
  entryId: string;
}

export interface LibraryArchiveEntryResponsePayload {
  entry: LibraryEntryPayload;
  archived: boolean;
}

export interface LibrarySetEntryEnabledPayload {
  apiVersion?: string;
  idempotencyKey?: string;
  entryId: string;
  enabled: boolean;
}

export interface LibrarySetEntryEnabledResponsePayload {
  entry: LibraryEntryPayload;
}

export interface LibraryDeleteEntryPayload {
  apiVersion?: string;
  idempotencyKey?: string;
  entryId: string;
}

export interface LibraryDeleteEntryResponsePayload {
  entryId: string;
  deleted: boolean;
}

export interface LibraryScanEntriesResponsePayload {
  entries: LibraryEntryPayload[];
  scannedAt: string;
}

export interface SkillDraftPayload {
  draftId: string;
  name: string;
  description?: string;
  requestPrompt: string;
  contentMarkdown: string;
  createdAt: string;
  updatedAt: string;
}

export interface LibraryListSkillDraftsResponsePayload {
  drafts: SkillDraftPayload[];
}

export interface LibraryGetSkillDraftResponsePayload {
  draft: SkillDraftPayload;
}

export interface LibraryCreateSkillDraftPayload {
  apiVersion?: string;
  idempotencyKey?: string;
  draftId?: string;
  name?: string;
  description?: string;
  requestPrompt: string;
}

export interface LibraryCreateSkillDraftResponsePayload {
  draft: SkillDraftPayload;
  created: boolean;
}

export interface LibraryDeleteSkillDraftPayload {
  apiVersion?: string;
  idempotencyKey?: string;
  draftId: string;
}

export interface LibraryDeleteSkillDraftResponsePayload {
  draftId: string;
  deleted: boolean;
}

// Concierge types — canonical source is @spaceskit/core
export type {
  ConciergeCallTtsModePayload,
  ConciergeCallStartPayload,
  ConciergeCallAnswerPayload,
  ConciergeCallEndPayload,
  ConciergeCallSetMutedPayload,
  ConciergeCallHandoffPreparePayload,
  ConciergeCallHandoffTokenPayload,
  ConciergeCallHandoffPrepareResponsePayload,
  ConciergeCallHandoffAcceptPayload,
  ConciergeCallRegisterPushPayload,
  ConciergeVoipPushRegistrationPayload,
  ConciergeCallMetricsPayload,
  ConciergeCallEventPayload,
} from "@spaceskit/core";

export interface SchedulerExecutionTargetPayload {
  mode: "existing_space" | "new_space";
}

export interface SchedulerCalendarBindingPayload {
  providerId: string;
  calendarId: string;
  eventId?: string;
  syncStatus: "pending" | "synced" | "error";
  driftStatus: "none" | "drifted";
  driftMessage?: string;
  lastSyncedAt?: string;
}
