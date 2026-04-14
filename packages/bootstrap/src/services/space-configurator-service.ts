import { randomUUID } from "node:crypto";
import type {
  AddAgentInput,
  CreateSpaceInput,
  SpaceAdminService,
} from "@spaceskit/core";
import type {
  SpaceConfig,
  SpaceAgentAssignment,
  TurnModelStrategy,
} from "@spaceskit/core";
import type {
  AgentPresetRepository,
  AgentPresetRevisionRow,
  ProfileRepository,
  SpacePresetApplicationRepository,
  SpaceTemplateRepository,
  SpaceTemplateRow,
  SpaceTemplateRevisionRow,
} from "@spaceskit/persistence";

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

interface StoredTemplateConfig {
  schemaVersion: number;
  communicationMode: CommunicationMode;
  turnModel: TurnModelStrategy;
  baseAgents: TemplateAgentDefinition[];
  agentPresetIds: string[];
  tags: string[];
  metadata: {
    createdBy: string;
    source: PresetSource;
    category?: string;
    complexityTier?: string;
    icon?: string;
    featured?: boolean;
    sortOrder?: number;
  };
}

interface StoredAgentPresetConfig {
  schemaVersion: number;
  defaultAgents: TemplateAgentDefinition[];
  tags: string[];
  metadata: {
    createdBy: string;
    source: PresetSource;
  };
}

const USER_TEMPLATE_PRESET_PREFIX = "user.template.";
const USER_AGENT_PRESET_PREFIX = "user.agent.";

const COMMUNICATION_MODE_TO_TURN_MODEL: Record<CommunicationMode, TurnModelStrategy> = {
  async_notes: "sequential_all",
  chat_first: "primary_only",
  structured_handoff: "round_robin",
};

const TURN_MODEL_TO_COMMUNICATION_MODE: Record<TurnModelStrategy, CommunicationMode> = {
  sequential_all: "async_notes",
  primary_only: "chat_first",
  first_success: "chat_first",
  round_robin: "structured_handoff",
  parallel_race: "structured_handoff",
  debate_synthesis: "structured_handoff",
  adaptive_auto: "chat_first",
};

const COMMUNICATION_MODE_TO_CONVERSATION_TOPOLOGY: Record<CommunicationMode, ConversationTopology> = {
  async_notes: "shared_team_chat",
  chat_first: "direct",
  structured_handoff: "broadcast_team",
};

const CONVERSATION_TOPOLOGY_TO_PROMPT_PACK_ID: Record<ConversationTopology, string> = {
  direct: "single-agent-v1",
  shared_team_chat: "shared-team-chat-v1",
  broadcast_team: "broadcast-team-v1",
};

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

  listPresets(input: ListPresetsInput = {}, principalId?: string): PresetSummary[] {
    const kindFilter = input.kind ?? "all";
    const sourceFilter = input.source ?? "all";
    const tagsFilter = normalizeStringArray(input.tags);

    const all: PresetSummary[] = [
      ...this.systemPresetCatalog().map((preset) => toPresetSummary(preset)),
      ...this.userTemplatePresetCatalog(principalId).map((preset) => toPresetSummary(preset)),
      ...this.userAgentPresetCatalog(principalId).map((preset) => toPresetSummary(preset)),
    ];

    return all.filter((preset) => {
      if (kindFilter !== "all" && preset.kind !== kindFilter) return false;
      if (sourceFilter !== "all" && preset.source !== sourceFilter) return false;
      if (tagsFilter.length > 0 && !preset.tags.some((tag) => tagsFilter.includes(tag))) return false;
      return true;
    });
  }

  listTemplates(input: ListTemplatesInput = {}, principalId: string): SpaceTemplateRecord[] {
    if (!this.templates) {
      throw new SpaceConfiguratorError("FAILED_PRECONDITION", "Template persistence is unavailable");
    }

    const normalizedPrincipalId = principalId.trim();
    if (!normalizedPrincipalId) {
      throw new SpaceConfiguratorError("INVALID_ARGUMENT", "principalId is required");
    }

    const includeArchived = input.includeArchived === true;
    const excludeSystem = input.includeSystem === false;
    const records: SpaceTemplateRecord[] = [];

    for (const template of this.templates.list({ includeArchived: true })) {
      const revision = this.templates.getActiveRevision(template.template_id);
      if (!revision) continue;
      const config = parseTemplateConfig(revision.space_config_json);

      const explicitOwner = template.owner_principal_id.trim();
      const isSystemTemplate = explicitOwner === "system";

      // System templates are included by default; exclude only if explicitly requested
      if (isSystemTemplate) {
        if (excludeSystem) continue;
      } else {
        // User-owned template: check ownership
        const legacyOwnerMatch = explicitOwner.length === 0 && config.metadata.createdBy === normalizedPrincipalId;
        if (explicitOwner !== normalizedPrincipalId && !legacyOwnerMatch) {
          continue;
        }
        if (legacyOwnerMatch) {
          this.templates.claimOwnerIfUnowned(template.template_id, normalizedPrincipalId);
        }
      }

      const refreshed = this.templates.getById(template.template_id) ?? template;
      if (!includeArchived && refreshed.archived === 1) {
        continue;
      }

      records.push(this.toTemplateRecord(refreshed, config));
    }

    // Sort: featured first (by sortOrder), then non-featured by sortOrder
    records.sort((a, b) => {
      const aSort = a.sortOrder ?? 999;
      const bSort = b.sortOrder ?? 999;
      if (a.featured !== b.featured) return a.featured ? -1 : 1;
      return aSort - bSort;
    });

    return records;
  }

  getTemplate(input: GetTemplateInput, principalId: string): SpaceTemplateRecord {
    const loaded = this.loadReadableTemplateAccessOrThrow(input.templateId, principalId, { includeArchived: true });
    return this.toTemplateRecord(loaded.template, loaded.config);
  }

  getPreset(presetId: string, principalId?: string): PresetDetail {
    const normalizedPresetId = presetId.trim();
    if (!normalizedPresetId) {
      throw new SpaceConfiguratorError("INVALID_ARGUMENT", "presetId is required");
    }

    const systemPreset = this.systemPresetCatalog().find((preset) => preset.presetId === normalizedPresetId);
    if (systemPreset) {
      return systemPreset;
    }

    if (normalizedPresetId.startsWith(USER_TEMPLATE_PRESET_PREFIX)) {
      const templateId = normalizedPresetId.slice(USER_TEMPLATE_PRESET_PREFIX.length);
      const loaded = this.loadTemplateDetail(templateId, principalId);
      if (loaded) {
        return loaded;
      }
    }

    if (normalizedPresetId.startsWith(USER_AGENT_PRESET_PREFIX)) {
      const presetId = normalizedPresetId.slice(USER_AGENT_PRESET_PREFIX.length);
      const loaded = this.loadAgentPresetDetail(presetId, principalId);
      if (loaded) {
        return loaded;
      }
    }

    throw new SpaceConfiguratorError("NOT_FOUND", `Preset not found: ${normalizedPresetId}`);
  }

  async applyPresetToSpace(input: ApplyPresetInput): Promise<PresetApplyResult> {
    const principalId = input.principalId.trim();
    if (!principalId) {
      throw new SpaceConfiguratorError("INVALID_ARGUMENT", "principalId is required");
    }

    const preset = this.getPreset(input.presetId, principalId);
    const appliedAt = this.now().toISOString();
    const applicationId = `preset-apply-${randomUUID()}`;
    let createdSpace = false;
    let appliedAgents = 0;
    let skippedAgents = 0;
    let space: SpaceConfig;

    if (preset.kind === "agent") {
      if (!input.targetSpaceId?.trim()) {
        throw new SpaceConfiguratorError(
          "INVALID_ARGUMENT",
          "targetSpaceId is required when applying an agent preset",
        );
      }

      const targetSpaceId = input.targetSpaceId.trim();
      const existingSpace = await this.spaceAdminService.getSpace(targetSpaceId);
      if (!existingSpace) {
        throw new SpaceConfiguratorError("NOT_FOUND", `Space not found: ${targetSpaceId}`);
      }

      const agentPreset = preset.agentPreset;
      if (!agentPreset || agentPreset.defaultAgents.length === 0) {
        throw new SpaceConfiguratorError(
          "FAILED_PRECONDITION",
          `Agent preset is missing default agents: ${preset.presetId}`,
        );
      }

      const existingAssignments = await this.spaceAdminService.listAgentAssignments(targetSpaceId);
      for (const definition of agentPreset.defaultAgents) {
        const alreadyAssigned = existingAssignments.some((assignment) => assignment.agentId === definition.agentId);
        if (alreadyAssigned) {
          skippedAgents += 1;
          continue;
        }

        await this.spaceAdminService.addAgent(this.toAddAgentInput({
          spaceId: targetSpaceId,
          definition,
          idempotencyKey: input.idempotencyKey,
        }));
        appliedAgents += 1;
      }

      space = (await this.spaceAdminService.getSpace(targetSpaceId)) ?? existingSpace;
    } else {
      const spacePreset = preset.spacePreset;
      if (!spacePreset) {
        throw new SpaceConfiguratorError(
          "FAILED_PRECONDITION",
          `Space preset is missing configuration: ${preset.presetId}`,
        );
      }

      if (input.targetSpaceId?.trim()) {
        const targetSpaceId = input.targetSpaceId.trim();
        const existingSpace = await this.spaceAdminService.getSpace(targetSpaceId);
        if (!existingSpace) {
          throw new SpaceConfiguratorError("NOT_FOUND", `Space not found: ${targetSpaceId}`);
        }

        const existingAssignments = await this.spaceAdminService.listAgentAssignments(targetSpaceId);
        for (const definition of spacePreset.baseAgents) {
          const alreadyAssigned = existingAssignments.some((assignment) => assignment.agentId === definition.agentId);
          if (alreadyAssigned) {
            skippedAgents += 1;
            continue;
          }

          await this.spaceAdminService.addAgent(this.toAddAgentInput({
            spaceId: targetSpaceId,
            definition,
            idempotencyKey: input.idempotencyKey,
          }));
          appliedAgents += 1;
        }

        space = (await this.spaceAdminService.getSpace(targetSpaceId)) ?? existingSpace;
      } else {
        const resourceId = input.resourceId?.trim();
        if (!resourceId) {
          throw new SpaceConfiguratorError(
            "INVALID_ARGUMENT",
            "resourceId is required when creating a new space from a preset",
          );
        }

        const createPayload: CreateSpaceInput = {
          idempotencyKey: input.idempotencyKey,
          spaceId: input.spaceId?.trim() || undefined,
          resourceId,
          spaceType: "space",
          name: (input.name?.trim() || preset.title),
          goal: input.goal?.trim() || undefined,
          turnModel: spacePreset.turnModel,
          visibility: input.visibility ?? "shared",
          initialAgents: spacePreset.baseAgents.map((definition, index) => ({
            agentId: definition.agentId,
            profileId: this.resolveProfileId(definition),
            role: definition.role,
            turnOrder: definition.turnOrder ?? index,
            isPrimary: definition.isPrimary,
          })),
        };

        space = await this.spaceAdminService.createSpace(createPayload);
        createdSpace = true;
        appliedAgents = spacePreset.baseAgents.length;
      }
    }

    this.presetApplications?.create({
      applicationId,
      spaceId: space.id,
      presetId: preset.presetId,
      presetKind: preset.kind,
      presetSource: preset.source,
      appliedBy: principalId,
      resultJson: JSON.stringify({
        createdSpace,
        appliedAgents,
        skippedAgents,
        appliedAt,
      }),
    });

    return {
      applicationId,
      presetId: preset.presetId,
      spaceId: space.id,
      createdSpace,
      appliedAgents,
      skippedAgents,
      appliedAt,
      space,
    };
  }

  previewTemplate(input: PreviewTemplateInput, principalId: string): SpaceTemplatePreviewResult {
    const loaded = this.loadTemplateOrThrow(input.templateId, principalId);
    const summary = this.toTemplateSummary(loaded.template, loaded.config);

    return {
      template: summary,
      resolved: {
        templateId: loaded.template.template_id,
        templateRevision: loaded.revision.revision,
        name: input.name?.trim() || loaded.template.name,
        goal: input.goal?.trim() || undefined,
        resourceId: input.resourceId?.trim() || "resource:preview",
        communicationMode: loaded.config.communicationMode,
        turnModel: loaded.config.turnModel,
        initialAgents: this.publicTemplateAgents(
          loaded.config.baseAgents,
          loaded.template.owner_principal_id,
        ),
      },
      warnings: [],
    };
  }

  async createFromTemplate(
    input: CreateFromTemplateInput,
    principalId: string,
  ): Promise<SpaceCreateFromTemplateResult> {
    const loaded = this.loadTemplateOrThrow(input.templateId, principalId);
    const summary = this.toTemplateSummary(loaded.template, loaded.config);

    const created = await this.spaceAdminService.createSpace({
      idempotencyKey: input.idempotencyKey,
      spaceId: input.spaceId?.trim() || undefined,
      resourceId: input.resourceId.trim(),
      spaceType: "space",
      name: input.name?.trim() || loaded.template.name,
      goal: input.goal?.trim() || undefined,
      turnModel: loaded.config.turnModel,
      templateId: loaded.template.template_id,
      templateRevision: loaded.revision.revision,
      visibility: input.visibility ?? "shared",
      initialAgents: loaded.config.baseAgents.map((definition, index) => ({
        agentId: definition.agentId,
        profileId: this.resolveProfileId(definition),
        role: definition.role,
        turnOrder: definition.turnOrder ?? index,
        isPrimary: definition.isPrimary,
      })),
    });

    return {
      template: summary,
      space: created,
    };
  }

  async saveTemplate(input: SaveTemplateInput): Promise<SaveTemplateResult> {
    if (!this.templates) {
      throw new SpaceConfiguratorError("FAILED_PRECONDITION", "Template persistence is unavailable");
    }

    const principalId = input.principalId.trim();
    if (!principalId) {
      throw new SpaceConfiguratorError("INVALID_ARGUMENT", "principalId is required");
    }

    const title = input.title.trim();
    if (!title) {
      throw new SpaceConfiguratorError("INVALID_ARGUMENT", "title is required");
    }

    const templateId = input.templateId?.trim() || `template-${randomUUID()}`;
    const description = input.description?.trim() ?? "";
    if (input.templateId?.trim()) {
      const existing = this.templates.getById(templateId);
      if (existing) {
        const explicitOwner = existing.owner_principal_id.trim();
        if (explicitOwner.length > 0 && explicitOwner !== principalId) {
          throw new SpaceConfiguratorError(
            "PERMISSION_DENIED",
            `Template is owned by another principal: ${templateId}`,
          );
        }
        if (explicitOwner.length === 0) {
          const activeRevision = this.templates.getActiveRevision(templateId);
          const config = activeRevision
            ? parseTemplateConfig(activeRevision.space_config_json)
            : null;
          const legacyOwner = config?.metadata.createdBy?.trim() ?? "";
          if (legacyOwner.length > 0 && legacyOwner !== principalId) {
            throw new SpaceConfiguratorError(
              "PERMISSION_DENIED",
              `Template is owned by another principal: ${templateId}`,
            );
          }
        }
      }
    }

    let communicationMode = input.communicationMode;
    let baseAgents = normalizeTemplateAgents(input.baseAgents ?? []);
    if (input.sourceSpaceId?.trim()) {
      const source = await this.spaceAdminService.getSpace(input.sourceSpaceId.trim());
      if (!source) {
        throw new SpaceConfiguratorError("NOT_FOUND", `Space not found: ${input.sourceSpaceId.trim()}`);
      }
      communicationMode = TURN_MODEL_TO_COMMUNICATION_MODE[source.turnModel] ?? "chat_first";
      baseAgents = source.agents.map((assignment) => ({
        agentId: assignment.agentId,
        profileId: assignment.profileId,
        role: assignment.role,
        turnOrder: assignment.turnOrder,
        isPrimary: assignment.isPrimary,
      }));
    }

    baseAgents = this.materializeTemplateAgentsForOwner(baseAgents, principalId);

    if (!communicationMode) {
      communicationMode = "chat_first";
    }

    if (baseAgents.length === 0) {
      baseAgents = [
        {
          agentId: this.defaultAgentId,
          profileId: this.defaultProfileId,
          profileBinding: "explicit",
          role: "global_coordinator",
          turnOrder: 0,
          isPrimary: true,
        },
      ];
    }

    const config: StoredTemplateConfig = {
      schemaVersion: 1,
      communicationMode,
      turnModel: COMMUNICATION_MODE_TO_TURN_MODEL[communicationMode],
      baseAgents,
      agentPresetIds: normalizeStringArray(input.agentPresetIds),
      tags: normalizeStringArray(input.tags),
      metadata: {
        createdBy: principalId,
        source: "user",
      },
    };

    const upserted = this.templates.upsertWithNewRevision({
      templateId,
      ownerPrincipalId: principalId,
      name: title,
      description,
      spaceConfigJson: JSON.stringify(config),
    });

    return {
      template: this.toTemplateSummary(upserted.template, config),
      created: upserted.created,
    };
  }

  archiveTemplate(input: ArchiveTemplateInput, principalId: string): ArchiveTemplateResult {
    if (!this.templates) {
      throw new SpaceConfiguratorError("FAILED_PRECONDITION", "Template persistence is unavailable");
    }

    const normalizedTemplateId = input.templateId.trim();
    const existing = this.loadOwnedTemplateAccessOrThrow(normalizedTemplateId, principalId, { includeArchived: true });
    const archived = existing.template.archived === 1
      ? false
      : this.templates.archive(normalizedTemplateId);
    const refreshed = this.loadOwnedTemplateAccessOrThrow(normalizedTemplateId, principalId, { includeArchived: true });

    return {
      template: this.toTemplateRecord(refreshed.template, refreshed.config),
      archived,
    };
  }

  async saveAgentPreset(input: SaveAgentPresetInput): Promise<SaveAgentPresetResult> {
    if (!this.agentPresets) {
      throw new SpaceConfiguratorError("FAILED_PRECONDITION", "Agent preset persistence is unavailable");
    }

    const principalId = input.principalId.trim();
    if (!principalId) {
      throw new SpaceConfiguratorError("INVALID_ARGUMENT", "principalId is required");
    }

    const title = input.title.trim();
    if (!title) {
      throw new SpaceConfiguratorError("INVALID_ARGUMENT", "title is required");
    }

    const presetId = input.presetId?.trim() || `agent-preset-${randomUUID()}`;
    const description = input.description?.trim() ?? "";

    if (input.presetId?.trim()) {
      const existing = this.agentPresets.getById(presetId);
      if (existing) {
        const explicitOwner = existing.owner_principal_id.trim();
        if (explicitOwner.length > 0 && explicitOwner !== principalId) {
          throw new SpaceConfiguratorError(
            "PERMISSION_DENIED",
            `Agent preset is owned by another principal: ${presetId}`,
          );
        }
        if (explicitOwner.length === 0) {
          const activeRevision = this.agentPresets.getActiveRevision(presetId);
          const config = activeRevision
            ? parseAgentPresetConfig(activeRevision.preset_config_json)
            : null;
          const legacyOwner = config?.metadata.createdBy?.trim() ?? "";
          if (legacyOwner.length > 0 && legacyOwner !== principalId) {
            throw new SpaceConfiguratorError(
              "PERMISSION_DENIED",
              `Agent preset is owned by another principal: ${presetId}`,
            );
          }
        }
      }
    }

    let defaultAgents = normalizeTemplateAgents(input.defaultAgents ?? []);
    if (defaultAgents.length === 0) {
      defaultAgents = [
        {
          agentId: this.defaultAgentId,
          profileId: this.defaultProfileId,
          profileBinding: "explicit",
          role: "global_coordinator",
          turnOrder: 0,
          isPrimary: true,
        },
      ];
    }

    const config: StoredAgentPresetConfig = {
      schemaVersion: 1,
      defaultAgents,
      tags: normalizeStringArray(input.tags),
      metadata: {
        createdBy: principalId,
        source: "user",
      },
    };

    const upserted = this.agentPresets.upsertWithNewRevision({
      presetId,
      ownerPrincipalId: principalId,
      name: title,
      description,
      presetConfigJson: JSON.stringify(config),
    });

    return {
      preset: this.toAgentPresetDetail(upserted.preset, upserted.revision, config),
      created: upserted.created,
    };
  }

  async archiveAgentPreset(input: ArchiveAgentPresetInput): Promise<ArchiveAgentPresetResult> {
    if (!this.agentPresets) {
      throw new SpaceConfiguratorError("FAILED_PRECONDITION", "Agent preset persistence is unavailable");
    }

    const principalId = input.principalId.trim();
    if (!principalId) {
      throw new SpaceConfiguratorError("INVALID_ARGUMENT", "principalId is required");
    }

    const presetId = input.presetId.trim();
    if (!presetId) {
      throw new SpaceConfiguratorError("INVALID_ARGUMENT", "presetId is required");
    }

    const existing = this.agentPresets.getById(presetId);
    if (!existing || existing.archived === 1) {
      throw new SpaceConfiguratorError("NOT_FOUND", `Agent preset not found: ${presetId}`);
    }

    const explicitOwner = existing.owner_principal_id.trim();
    if (explicitOwner.length > 0 && explicitOwner !== principalId) {
      throw new SpaceConfiguratorError(
        "PERMISSION_DENIED",
        `Agent preset is owned by another principal: ${presetId}`,
      );
    }

    if (explicitOwner.length === 0) {
      const revision = this.agentPresets.getActiveRevision(presetId);
      const config = revision ? parseAgentPresetConfig(revision.preset_config_json) : null;
      const legacyOwner = config?.metadata.createdBy?.trim() ?? "";
      if (legacyOwner.length > 0 && legacyOwner !== principalId) {
        throw new SpaceConfiguratorError(
          "PERMISSION_DENIED",
          `Agent preset is owned by another principal: ${presetId}`,
        );
      }
      this.agentPresets.claimOwnerIfUnowned(presetId, principalId);
    }

    return {
      presetId,
      archived: this.agentPresets.archive(presetId),
    };
  }

  private toAddAgentInput(input: {
    spaceId: string;
    definition: TemplateAgentDefinition;
    idempotencyKey?: string;
  }): AddAgentInput {
    return {
      idempotencyKey: input.idempotencyKey
        ? `${input.idempotencyKey}:add-agent:${input.definition.agentId}`
        : undefined,
      spaceId: input.spaceId,
      agentId: input.definition.agentId,
      profileId: this.resolveProfileId(input.definition),
      role: input.definition.role,
      turnOrder: input.definition.turnOrder,
      isPrimary: input.definition.isPrimary,
    };
  }

  private resolveProfileId(definition: TemplateAgentDefinition | string | undefined): string {
    const requestedProfileId = typeof definition === "string"
      ? definition
      : definition?.profileBinding === "gateway_default_main"
        ? this.defaultProfileId
        : definition?.profileId;
    const candidate = requestedProfileId?.trim() || this.defaultProfileId;
    if (!this.profileRepo) {
      return candidate;
    }

    const profile = this.profileRepo.getById(candidate);
    if (profile && profile.archived === 0) {
      return candidate;
    }

    return this.defaultProfileId;
  }

  private materializeTemplateAgentsForOwner(
    baseAgents: TemplateAgentDefinition[],
    ownerPrincipalId: string,
  ): TemplateAgentDefinition[] {
    if (ownerPrincipalId.trim() === "system") {
      return baseAgents;
    }

    return baseAgents.map((definition) => ({
      ...definition,
      profileId: this.resolveProfileId(definition),
      profileBinding: "explicit",
    }));
  }

  private systemPresetCatalog(): PresetDetail[] {
    const coordinatorAgent: TemplateAgentDefinition = {
      agentId: this.defaultAgentId,
      profileId: this.defaultProfileId,
      profileBinding: "explicit",
      role: "global_coordinator",
      turnOrder: 0,
      isPrimary: true,
    };

    return [
      {
        presetId: "system.space.chat_first",
        kind: "space",
        title: "Chat First Space",
        description: "Primary coordinator flow with one default agent.",
        source: "system",
        version: 1,
        tags: ["starter", "chat"],
        spacePreset: {
          communicationMode: "chat_first",
          turnModel: "primary_only",
          baseAgents: [coordinatorAgent],
          agentPresetIds: ["system.agent.coordinator"],
        },
      },
      {
        presetId: "system.space.structured_handoff",
        kind: "space",
        title: "Structured Handoff",
        description: "Round-robin collaboration starter for explicit turn-taking.",
        source: "system",
        version: 1,
        tags: ["handoff", "collaboration"],
        spacePreset: {
          communicationMode: "structured_handoff",
          turnModel: "round_robin",
          baseAgents: [coordinatorAgent],
          agentPresetIds: ["system.agent.coordinator"],
        },
      },
      {
        presetId: "system.agent.coordinator",
        kind: "agent",
        title: "Coordinator Agent",
        description: "Default coordinator assignment for existing spaces.",
        source: "system",
        version: 1,
        tags: ["agent", "coordinator"],
        agentPreset: {
          defaultAgents: [coordinatorAgent],
        },
      },
    ];
  }

  private userTemplatePresetCatalog(principalId?: string): PresetDetail[] {
    if (!this.templates) {
      return [];
    }
    const normalizedPrincipalId = principalId?.trim();
    if (!normalizedPrincipalId) {
      return [];
    }

    const presets: PresetDetail[] = [];
    for (const template of this.templates.list({
      includeArchived: false,
      ownerPrincipalId: normalizedPrincipalId,
    })) {
      const revision = this.templates.getActiveRevision(template.template_id);
      if (!revision) continue;
      const config = parseTemplateConfig(revision.space_config_json);
      presets.push({
        presetId: `${USER_TEMPLATE_PRESET_PREFIX}${template.template_id}`,
        kind: "space",
        title: template.name,
        description: template.description,
        source: "user",
        version: revision.revision,
        tags: config.tags,
        spacePreset: {
          communicationMode: config.communicationMode,
          turnModel: config.turnModel,
          baseAgents: this.publicTemplateAgents(config.baseAgents, template.owner_principal_id),
          agentPresetIds: config.agentPresetIds,
        },
      });
    }
    return presets;
  }

  private userAgentPresetCatalog(principalId?: string): PresetDetail[] {
    if (!this.agentPresets) {
      return [];
    }
    const normalizedPrincipalId = principalId?.trim();
    if (!normalizedPrincipalId) {
      return [];
    }

    const presets: PresetDetail[] = [];
    for (const preset of this.agentPresets.list({
      includeArchived: false,
      ownerPrincipalId: normalizedPrincipalId,
    })) {
      const revision = this.agentPresets.getActiveRevision(preset.preset_id);
      if (!revision) continue;
      const config = parseAgentPresetConfig(revision.preset_config_json);
      presets.push(this.toAgentPresetDetail(preset, revision, config));
    }
    return presets;
  }

  private loadTemplateOrThrow(templateId: string, principalId: string): {
    template: SpaceTemplateRow;
    revision: SpaceTemplateRevisionRow;
    config: StoredTemplateConfig;
  } {
    return this.loadReadableTemplateAccessOrThrow(templateId, principalId);
  }

  private loadReadableTemplateAccessOrThrow(
    templateId: string,
    principalId: string,
    options: { includeArchived?: boolean } = {},
  ): {
    template: SpaceTemplateRow;
    revision: SpaceTemplateRevisionRow;
    config: StoredTemplateConfig;
  } {
    const normalizedTemplateId = templateId.trim();
    if (!normalizedTemplateId) {
      throw new SpaceConfiguratorError("INVALID_ARGUMENT", "templateId is required");
    }

    if (!this.templates) {
      throw new SpaceConfiguratorError("FAILED_PRECONDITION", "Template persistence is unavailable");
    }

    const normalizedPrincipalId = principalId.trim();
    if (!normalizedPrincipalId) {
      throw new SpaceConfiguratorError("INVALID_ARGUMENT", "principalId is required");
    }

    const template = this.templates.getById(normalizedTemplateId);
    if (!template || (!options.includeArchived && template.archived === 1)) {
      throw new SpaceConfiguratorError("NOT_FOUND", `Template not found: ${normalizedTemplateId}`);
    }

    const revision = this.templates.getActiveRevision(normalizedTemplateId);
    if (!revision) {
      throw new SpaceConfiguratorError(
        "FAILED_PRECONDITION",
        `Active template revision missing: ${normalizedTemplateId}`,
      );
    }

    const config = parseTemplateConfig(revision.space_config_json);
    const ownedByPrincipal = template.owner_principal_id === normalizedPrincipalId;
    const ownerMissing = template.owner_principal_id.trim().length === 0;
    const legacyOwnerMatch = ownerMissing && config.metadata.createdBy === normalizedPrincipalId;
    const isSystemTemplate = template.owner_principal_id.trim() === "system";

    if (!ownedByPrincipal && !legacyOwnerMatch && !isSystemTemplate) {
      throw new SpaceConfiguratorError(
        "PERMISSION_DENIED",
        `Template is not accessible for principal: ${normalizedTemplateId}`,
      );
    }
    if (legacyOwnerMatch) {
      this.templates.claimOwnerIfUnowned(normalizedTemplateId, normalizedPrincipalId);
    }

    return {
      template: this.templates.getById(normalizedTemplateId) ?? template,
      revision,
      config,
    };
  }

  private loadOwnedTemplateAccessOrThrow(
    templateId: string,
    principalId: string,
    options: { includeArchived?: boolean } = {},
  ): {
    template: SpaceTemplateRow;
    revision: SpaceTemplateRevisionRow;
    config: StoredTemplateConfig;
  } {
    const loaded = this.loadReadableTemplateAccessOrThrow(templateId, principalId, options);
    const normalizedPrincipalId = principalId.trim();
    const ownedByPrincipal = loaded.template.owner_principal_id === normalizedPrincipalId;
    const ownerMissing = loaded.template.owner_principal_id.trim().length === 0;
    const legacyOwnerMatch = ownerMissing && loaded.config.metadata.createdBy === normalizedPrincipalId;

    if (!ownedByPrincipal && !legacyOwnerMatch) {
      throw new SpaceConfiguratorError(
        "PERMISSION_DENIED",
        `Template is not accessible for principal: ${loaded.template.template_id}`,
      );
    }

    return loaded;
  }

  private loadTemplateDetail(templateId: string, principalId?: string): PresetDetail | null {
    if (!this.templates) {
      return null;
    }
    const normalizedPrincipalId = principalId?.trim();
    if (!normalizedPrincipalId) {
      return null;
    }

    const template = this.templates.getById(templateId);
    if (!template || template.archived === 1) {
      return null;
    }

    const revision = this.templates.getActiveRevision(templateId);
    if (!revision) {
      return null;
    }

    const config = parseTemplateConfig(revision.space_config_json);
    if (template.owner_principal_id !== normalizedPrincipalId) {
      const ownerMissing = template.owner_principal_id.trim().length === 0;
      const legacyOwnerMatch = ownerMissing && config.metadata.createdBy === normalizedPrincipalId;
      if (!legacyOwnerMatch) {
        return null;
      }
      this.templates.claimOwnerIfUnowned(templateId, normalizedPrincipalId);
    }

    return {
      presetId: `${USER_TEMPLATE_PRESET_PREFIX}${template.template_id}`,
      kind: "space",
      title: template.name,
      description: template.description,
      source: "user",
      version: revision.revision,
      tags: config.tags,
      spacePreset: {
        communicationMode: config.communicationMode,
        turnModel: config.turnModel,
        baseAgents: this.publicTemplateAgents(config.baseAgents, template.owner_principal_id),
        agentPresetIds: config.agentPresetIds,
      },
    };
  }

  private loadAgentPresetOrThrow(presetId: string, principalId: string): {
    preset: { preset_id: string; name: string; description: string; updated_at: string };
    revision: AgentPresetRevisionRow;
    config: StoredAgentPresetConfig;
  } {
    const normalizedPresetId = presetId.trim();
    if (!normalizedPresetId) {
      throw new SpaceConfiguratorError("INVALID_ARGUMENT", "presetId is required");
    }

    if (!this.agentPresets) {
      throw new SpaceConfiguratorError("FAILED_PRECONDITION", "Agent preset persistence is unavailable");
    }

    const normalizedPrincipalId = principalId.trim();
    if (!normalizedPrincipalId) {
      throw new SpaceConfiguratorError("INVALID_ARGUMENT", "principalId is required");
    }

    const preset = this.agentPresets.getById(normalizedPresetId);
    if (!preset || preset.archived === 1) {
      throw new SpaceConfiguratorError("NOT_FOUND", `Agent preset not found: ${normalizedPresetId}`);
    }

    const revision = this.agentPresets.getActiveRevision(normalizedPresetId);
    if (!revision) {
      throw new SpaceConfiguratorError(
        "FAILED_PRECONDITION",
        `Active agent preset revision missing: ${normalizedPresetId}`,
      );
    }

    const config = parseAgentPresetConfig(revision.preset_config_json);
    const ownedByPrincipal = preset.owner_principal_id === normalizedPrincipalId;
    const ownerMissing = preset.owner_principal_id.trim().length === 0;
    const legacyOwnerMatch = ownerMissing && config.metadata.createdBy === normalizedPrincipalId;

    if (!ownedByPrincipal && !legacyOwnerMatch) {
      throw new SpaceConfiguratorError(
        "PERMISSION_DENIED",
        `Agent preset is not accessible for principal: ${normalizedPresetId}`,
      );
    }
    if (legacyOwnerMatch) {
      this.agentPresets.claimOwnerIfUnowned(normalizedPresetId, normalizedPrincipalId);
    }

    return {
      preset: this.agentPresets.getById(normalizedPresetId) ?? preset,
      revision,
      config,
    };
  }

  private loadAgentPresetDetail(presetId: string, principalId?: string): PresetDetail | null {
    if (!this.agentPresets) {
      return null;
    }

    const normalizedPrincipalId = principalId?.trim();
    if (!normalizedPrincipalId) {
      return null;
    }

    const preset = this.agentPresets.getById(presetId);
    if (!preset || preset.archived === 1) {
      return null;
    }

    const revision = this.agentPresets.getActiveRevision(presetId);
    if (!revision) {
      return null;
    }

    const config = parseAgentPresetConfig(revision.preset_config_json);
    if (preset.owner_principal_id !== normalizedPrincipalId) {
      const ownerMissing = preset.owner_principal_id.trim().length === 0;
      const legacyOwnerMatch = ownerMissing && config.metadata.createdBy === normalizedPrincipalId;
      if (!legacyOwnerMatch) {
        return null;
      }
      this.agentPresets.claimOwnerIfUnowned(presetId, normalizedPrincipalId);
    }

    return this.toAgentPresetDetail(preset, revision, config);
  }

  private toAgentPresetDetail(
    preset: { preset_id: string; name: string; description: string },
    revision: { revision: number },
    config: StoredAgentPresetConfig,
  ): PresetDetail {
    return {
      presetId: `${USER_AGENT_PRESET_PREFIX}${preset.preset_id}`,
      kind: "agent",
      title: preset.name,
      description: preset.description,
      source: "user",
      version: revision.revision,
      tags: config.tags,
      agentPreset: {
        defaultAgents: config.defaultAgents.map((definition) => ({
          ...definition,
          profileId: this.resolveProfileId(definition),
          profileBinding: "explicit",
        })),
      },
    };
  }

  private toTemplateSummary(
    template: { template_id: string; name: string; updated_at: string },
    config: StoredTemplateConfig,
  ): SpaceTemplateSummary {
    const conversationTopology = conversationTopologyForCommunicationMode(config.communicationMode);
    return {
      templateId: template.template_id,
      title: template.name,
      communicationMode: config.communicationMode,
      conversationTopology,
      promptPackId: promptPackIdForConversationTopology(conversationTopology),
      agentPresetIds: config.agentPresetIds,
      createdBy: config.metadata.createdBy,
      updatedAt: template.updated_at,
    };
  }

  private toTemplateRecord(
    template: SpaceTemplateRow,
    config: StoredTemplateConfig,
  ): SpaceTemplateRecord {
    const summary = this.toTemplateSummary(template, config);
    return {
      templateId: summary.templateId,
      name: template.name,
      description: template.description || undefined,
      status: template.archived === 1 ? "archived" : "active",
      activeRevision: template.active_revision,
      communicationMode: config.communicationMode,
      conversationTopology: summary.conversationTopology,
      promptPackId: summary.promptPackId,
      turnModel: config.turnModel,
      agentDefinitions: this.publicTemplateAgents(config.baseAgents, template.owner_principal_id),
      createdBy: config.metadata.createdBy,
      createdAt: template.created_at,
      updatedAt: template.updated_at,
      category: config.metadata.category,
      complexityTier: config.metadata.complexityTier,
      icon: config.metadata.icon,
      featured: config.metadata.featured,
      sortOrder: config.metadata.sortOrder,
      agentCount: config.baseAgents.length,
    };
  }

  private publicTemplateAgents(
    baseAgents: TemplateAgentDefinition[],
    ownerPrincipalIdRaw: string,
  ): TemplateAgentDefinition[] {
    const preserveManagedBinding = ownerPrincipalIdRaw.trim() === "system";
    return baseAgents.map((definition) => {
      const profileBinding: TemplateAgentProfileBinding = preserveManagedBinding
        && definition.profileBinding === "gateway_default_main"
        ? "gateway_default_main"
        : "explicit";
      return {
        ...definition,
        profileId: this.resolveProfileId(definition),
        profileBinding,
      };
    });
  }
}

function toPresetSummary(detail: PresetDetail): PresetSummary {
  return {
    presetId: detail.presetId,
    kind: detail.kind,
    title: detail.title,
    description: detail.description,
    source: detail.source,
    version: detail.version,
    tags: detail.tags,
  };
}

function normalizeStringArray(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return Array.from(
    new Set(
      input
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  );
}

function normalizeTemplateAgents(input: TemplateAgentDefinition[]): TemplateAgentDefinition[] {
  return input
    .filter((entry) => typeof entry?.agentId === "string")
    .map((entry, index) => {
      const profileBinding: TemplateAgentProfileBinding = entry.profileBinding === "gateway_default_main"
        ? "gateway_default_main"
        : "explicit";
      return {
        agentId: entry.agentId.trim(),
        profileId: (entry.profileId ?? "").trim() || undefined,
        profileBinding,
        role: entry.role ?? "participant",
        turnOrder: typeof entry.turnOrder === "number" ? entry.turnOrder : index,
        isPrimary: entry.isPrimary ?? false,
      };
    })
    .filter((entry) => entry.agentId.length > 0);
}

function conversationTopologyForCommunicationMode(mode: CommunicationMode): ConversationTopology {
  return COMMUNICATION_MODE_TO_CONVERSATION_TOPOLOGY[mode] ?? "direct";
}

function promptPackIdForConversationTopology(topology: ConversationTopology): string {
  return CONVERSATION_TOPOLOGY_TO_PROMPT_PACK_ID[topology] ?? "single-agent-v1";
}

function parseTemplateConfig(rawJson: string): StoredTemplateConfig {
  const fallback: StoredTemplateConfig = {
    schemaVersion: 1,
    communicationMode: "chat_first",
    turnModel: "primary_only",
    baseAgents: [],
    agentPresetIds: [],
    tags: [],
    metadata: {
      createdBy: "unknown",
      source: "user",
    },
  };

  try {
    const parsed = JSON.parse(rawJson) as Record<string, unknown>;
    const communicationMode = normalizeCommunicationMode(parsed.communicationMode);
    const turnModel = normalizeTurnModel(parsed.turnModel)
      ?? COMMUNICATION_MODE_TO_TURN_MODEL[communicationMode];
    const baseAgents = normalizeTemplateAgents(
      (parsed.baseAgents as TemplateAgentDefinition[] | undefined)
        ?? (parsed.agents as TemplateAgentDefinition[] | undefined)
        ?? [],
    );
    const agentPresetIds = normalizeStringArray(parsed.agentPresetIds);
    const tags = normalizeStringArray(parsed.tags);

    const metadataCandidate = parsed.metadata;
    const metadata = (typeof metadataCandidate === "object" && metadataCandidate !== null)
      ? metadataCandidate as Record<string, unknown>
      : {};

    return {
      schemaVersion: Number(parsed.schemaVersion ?? 1) || 1,
      communicationMode,
      turnModel,
      baseAgents,
      agentPresetIds,
      tags,
      metadata: {
        createdBy: typeof metadata.createdBy === "string" ? metadata.createdBy : "unknown",
        source: metadata.source === "system" ? "system" : "user",
        category: typeof metadata.category === "string" ? metadata.category : undefined,
        complexityTier: typeof metadata.complexityTier === "string" ? metadata.complexityTier : undefined,
        icon: typeof metadata.icon === "string" ? metadata.icon : undefined,
        featured: typeof metadata.featured === "boolean" ? metadata.featured : undefined,
        sortOrder: typeof metadata.sortOrder === "number" ? metadata.sortOrder : undefined,
      },
    };
  } catch {
    return fallback;
  }
}

function parseAgentPresetConfig(rawJson: string): StoredAgentPresetConfig {
  const fallback: StoredAgentPresetConfig = {
    schemaVersion: 1,
    defaultAgents: [],
    tags: [],
    metadata: {
      createdBy: "unknown",
      source: "user",
    },
  };

  try {
    const parsed = JSON.parse(rawJson) as Record<string, unknown>;
    const defaultAgents = normalizeTemplateAgents(
      (parsed.defaultAgents as TemplateAgentDefinition[] | undefined) ?? [],
    );
    const tags = normalizeStringArray(parsed.tags);

    const metadataCandidate = parsed.metadata;
    const metadata = (typeof metadataCandidate === "object" && metadataCandidate !== null)
      ? metadataCandidate as Record<string, unknown>
      : {};

    return {
      schemaVersion: Number(parsed.schemaVersion ?? 1) || 1,
      defaultAgents,
      tags,
      metadata: {
        createdBy: typeof metadata.createdBy === "string" ? metadata.createdBy : "unknown",
        source: metadata.source === "system" ? "system" : "user",
      },
    };
  } catch {
    return fallback;
  }
}

function normalizeCommunicationMode(value: unknown): CommunicationMode {
  if (value === "async_notes" || value === "chat_first" || value === "structured_handoff") {
    return value;
  }
  return "chat_first";
}

function normalizeTurnModel(value: unknown): TurnModelStrategy | null {
  if (
    value === "sequential_all"
    || value === "primary_only"
    || value === "first_success"
    || value === "round_robin"
    || value === "parallel_race"
    || value === "debate_synthesis"
    || value === "adaptive_auto"
  ) {
    return value;
  }

  return null;
}
