import type {
  SpaceAdminService,
  SpaceConfig,
  TurnModelStrategy,
} from "@spaceskit/core";
import type {
  AgentPresetRepository,
  ProfileRepository,
  SpacePresetApplicationRepository,
  SpaceTemplateRepository,
} from "@spaceskit/persistence";
import {
  applySpaceConfiguratorPreset,
  createSpaceFromConfiguratorTemplate,
  type SpaceConfiguratorApplicationContext,
} from "./space-configurator-applications.js";
import {
  getSpaceConfiguratorPreset,
  getSpaceConfiguratorTemplate,
  listSpaceConfiguratorPresets,
  listSpaceConfiguratorTemplates,
  previewSpaceConfiguratorTemplate,
} from "./space-configurator-catalog.js";
import {
  archiveAgentPresetRevision,
  archiveTemplateRevision,
  saveAgentPresetRevision,
  saveTemplateRevision,
} from "./space-configurator-updates.js";

export type PresetKind = "agent" | "space";
export type PresetSource = "system" | "user";
export type CommunicationMode = "async_notes" | "chat_first" | "structured_handoff";
export type ConversationTopology = "direct" | "shared_team_chat" | "broadcast_team";
export type TemplateAgentProfileBinding = "explicit" | "gateway_default_main";

export interface TemplateAgentDefinition {
  agentId: string;
  profileId?: string;
  profileBinding?: TemplateAgentProfileBinding;
  role?: "participant" | "global_coordinator" | "space_moderator";
  turnOrder?: number;
  isPrimary?: boolean;
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

export interface SpacePresetConfig {
  communicationMode: CommunicationMode;
  turnModel: TurnModelStrategy;
  baseAgents: TemplateAgentDefinition[];
  agentPresetIds: string[];
}

export interface AgentPresetConfig {
  defaultAgents: TemplateAgentDefinition[];
}

export interface PresetDetail extends PresetSummary {
  spacePreset?: SpacePresetConfig;
  agentPreset?: AgentPresetConfig;
}

export interface PresetApplyResult {
  applicationId: string;
  presetId: string;
  spaceId: string;
  createdSpace: boolean;
  appliedAgents: number;
  skippedAgents: number;
  appliedAt: string;
  space: SpaceConfig;
}

export interface SpaceTemplateSummary {
  templateId: string;
  title: string;
  communicationMode: CommunicationMode;
  conversationTopology?: ConversationTopology;
  promptPackId?: string;
  agentPresetIds: string[];
  createdBy: string;
  updatedAt: string;
}

export interface SpaceTemplateRecord {
  templateId: string;
  name: string;
  description?: string;
  status: "active" | "archived";
  activeRevision: number;
  communicationMode: CommunicationMode;
  conversationTopology?: ConversationTopology;
  promptPackId?: string;
  turnModel: TurnModelStrategy;
  agentDefinitions: TemplateAgentDefinition[];
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

export interface ListTemplatesInput {
  includeArchived?: boolean;
  includeSystem?: boolean;
}

export interface GetTemplateInput {
  templateId: string;
}

export interface ArchiveTemplateInput {
  templateId: string;
  idempotencyKey?: string;
}

export interface SpaceTemplatePreviewResult {
  template: SpaceTemplateSummary;
  resolved: {
    templateId: string;
    templateRevision: number;
    name: string;
    goal?: string;
    resourceId: string;
    communicationMode: CommunicationMode;
    turnModel: TurnModelStrategy;
    initialAgents: TemplateAgentDefinition[];
  };
  warnings: string[];
}

export interface SpaceCreateFromTemplateResult {
  template: SpaceTemplateSummary;
  space: SpaceConfig;
}

export interface SaveTemplateResult {
  template: SpaceTemplateSummary;
  created: boolean;
}

export interface ArchiveTemplateResult {
  template: SpaceTemplateRecord;
  archived: boolean;
}

export interface SaveAgentPresetInput {
  presetId?: string;
  title: string;
  description?: string;
  defaultAgents?: TemplateAgentDefinition[];
  principalId: string;
  tags?: string[];
}

export interface SaveAgentPresetResult {
  preset: PresetDetail;
  created: boolean;
}

export interface ArchiveAgentPresetInput {
  presetId: string;
  principalId: string;
}

export interface ArchiveAgentPresetResult {
  presetId: string;
  archived: boolean;
}

export interface ListPresetsInput {
  kind?: PresetKind | "all";
  source?: PresetSource | "all";
  tags?: string[];
}

export interface ApplyPresetInput {
  presetId: string;
  principalId: string;
  targetSpaceId?: string;
  spaceId?: string;
  resourceId?: string;
  name?: string;
  goal?: string;
  visibility?: "shared" | "private";
  idempotencyKey?: string;
}

export interface PreviewTemplateInput {
  templateId: string;
  resourceId?: string;
  name?: string;
  goal?: string;
}

export interface CreateFromTemplateInput {
  templateId: string;
  spaceId?: string;
  resourceId: string;
  name?: string;
  goal?: string;
  visibility?: "shared" | "private";
  idempotencyKey?: string;
}

export interface SaveTemplateInput {
  templateId?: string;
  title: string;
  description?: string;
  communicationMode?: CommunicationMode;
  baseAgents?: TemplateAgentDefinition[];
  agentPresetIds?: string[];
  sourceSpaceId?: string;
  principalId: string;
  tags?: string[];
}

export type SpaceConfiguratorErrorCode =
  | "INVALID_ARGUMENT"
  | "NOT_FOUND"
  | "FAILED_PRECONDITION"
  | "PERMISSION_DENIED";

export class SpaceConfiguratorError extends Error {
  readonly code: SpaceConfiguratorErrorCode;

  constructor(code: SpaceConfiguratorErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export interface SpaceConfiguratorServiceOptions {
  templates?: SpaceTemplateRepository | null;
  agentPresets?: AgentPresetRepository | null;
  presetApplications?: SpacePresetApplicationRepository | null;
  spaceAdminService: Pick<
    SpaceAdminService,
    "createSpace" | "getSpace" | "listAgentAssignments" | "addAgent"
  >;
  profileRepo?: ProfileRepository | null;
  defaultProfileId: string;
  defaultAgentId: string;
  now?: () => Date;
}

export class SpaceConfiguratorService {
  private readonly templates: SpaceTemplateRepository | null;
  private readonly agentPresets: AgentPresetRepository | null;
  private readonly presetApplications: SpacePresetApplicationRepository | null;
  private readonly spaceAdminService: Pick<
    SpaceAdminService,
    "createSpace" | "getSpace" | "listAgentAssignments" | "addAgent"
  >;
  private readonly profileRepo: ProfileRepository | null;
  private readonly defaultProfileId: string;
  private readonly defaultAgentId: string;
  private readonly now: () => Date;

  constructor(options: SpaceConfiguratorServiceOptions) {
    this.templates = options.templates ?? null;
    this.agentPresets = options.agentPresets ?? null;
    this.presetApplications = options.presetApplications ?? null;
    this.spaceAdminService = options.spaceAdminService;
    this.profileRepo = options.profileRepo ?? null;
    this.defaultProfileId = options.defaultProfileId;
    this.defaultAgentId = options.defaultAgentId;
    this.now = options.now ?? (() => new Date());
  }

  private get configuratorCtx(): SpaceConfiguratorApplicationContext {
    return {
      templates: this.templates,
      agentPresets: this.agentPresets,
      presetApplications: this.presetApplications,
      spaceAdminService: this.spaceAdminService,
      profileRepo: this.profileRepo,
      defaultProfileId: this.defaultProfileId,
      defaultAgentId: this.defaultAgentId,
      now: this.now,
    };
  }

  listPresets(input: ListPresetsInput = {}, principalId?: string): PresetSummary[] {
    return listSpaceConfiguratorPresets(this.configuratorCtx, input, principalId);
  }

  listTemplates(input: ListTemplatesInput = {}, principalId: string): SpaceTemplateRecord[] {
    return listSpaceConfiguratorTemplates(this.configuratorCtx, input, principalId);
  }

  getTemplate(input: GetTemplateInput, principalId: string): SpaceTemplateRecord {
    return getSpaceConfiguratorTemplate(this.configuratorCtx, input, principalId);
  }

  getPreset(presetId: string, principalId?: string): PresetDetail {
    return getSpaceConfiguratorPreset(this.configuratorCtx, presetId, principalId);
  }

  async applyPresetToSpace(input: ApplyPresetInput): Promise<PresetApplyResult> {
    return applySpaceConfiguratorPreset(this.configuratorCtx, input);
  }

  previewTemplate(input: PreviewTemplateInput, principalId: string): SpaceTemplatePreviewResult {
    return previewSpaceConfiguratorTemplate(this.configuratorCtx, input, principalId);
  }

  async createFromTemplate(
    input: CreateFromTemplateInput,
    principalId: string,
  ): Promise<SpaceCreateFromTemplateResult> {
    return createSpaceFromConfiguratorTemplate(this.configuratorCtx, input, principalId);
  }

  async saveTemplate(input: SaveTemplateInput): Promise<SaveTemplateResult> {
    return saveTemplateRevision({
      ...this.configuratorCtx,
      spaceAdminService: this.spaceAdminService,
    }, input);
  }

  archiveTemplate(input: ArchiveTemplateInput, principalId: string): ArchiveTemplateResult {
    return archiveTemplateRevision({
      ...this.configuratorCtx,
      spaceAdminService: this.spaceAdminService,
    }, input, principalId);
  }

  async saveAgentPreset(input: SaveAgentPresetInput): Promise<SaveAgentPresetResult> {
    return saveAgentPresetRevision({
      ...this.configuratorCtx,
      spaceAdminService: this.spaceAdminService,
    }, input);
  }

  async archiveAgentPreset(input: ArchiveAgentPresetInput): Promise<ArchiveAgentPresetResult> {
    return archiveAgentPresetRevision({
      ...this.configuratorCtx,
      spaceAdminService: this.spaceAdminService,
    }, input);
  }
}
