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
import {
  COMMUNICATION_MODE_TO_TURN_MODEL,
  TURN_MODEL_TO_COMMUNICATION_MODE,
  normalizeStringArray,
  normalizeTemplateAgents,
  parseAgentPresetConfig,
  parseTemplateConfig,
  toPresetSummary,
  type StoredAgentPresetConfig,
  type StoredTemplateConfig,
} from "./space-configurator-normalizers.js";
import {
  loadAgentPresetAccessOrThrow,
  loadAgentPresetDetailRecord,
  loadOwnedTemplateAccessOrThrow,
  loadReadableTemplateAccessOrThrow,
  loadTemplateDetailRecord,
} from "./space-configurator-access.js";
import {
  materializeTemplateAgentsForOwner,
  publicTemplateAgents,
  resolveProfileId,
  systemPresetCatalog,
  templateDetailFromLoaded,
  toAgentPresetDetail,
  toTemplateRecord,
  toTemplateSummary,
  userAgentPresetCatalog,
  userTemplatePresetCatalog,
  type PresenterContext,
} from "./space-configurator-presenters.js";

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

const USER_TEMPLATE_PRESET_PREFIX = "user.template.";
const USER_AGENT_PRESET_PREFIX = "user.agent.";

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

  private get presenterCtx(): PresenterContext {
    return {
      templates: this.templates,
      agentPresets: this.agentPresets,
      profileRepo: this.profileRepo,
      defaultProfileId: this.defaultProfileId,
      defaultAgentId: this.defaultAgentId,
    };
  }

  listPresets(input: ListPresetsInput = {}, principalId?: string): PresetSummary[] {
    const kindFilter = input.kind ?? "all";
    const sourceFilter = input.source ?? "all";
    const tagsFilter = normalizeStringArray(input.tags);

    const all: PresetSummary[] = [
      ...systemPresetCatalog(this.presenterCtx).map((preset) => toPresetSummary(preset)),
      ...userTemplatePresetCatalog(this.presenterCtx, principalId).map((preset) => toPresetSummary(preset)),
      ...userAgentPresetCatalog(this.presenterCtx, principalId).map((preset) => toPresetSummary(preset)),
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
    return resolveProfileId(this.presenterCtx, definition);
  }

  private materializeTemplateAgentsForOwner(
    baseAgents: TemplateAgentDefinition[],
    ownerPrincipalId: string,
  ): TemplateAgentDefinition[] {
    return materializeTemplateAgentsForOwner(this.presenterCtx, baseAgents, ownerPrincipalId);
  }

  private systemPresetCatalog(): PresetDetail[] {
    return systemPresetCatalog(this.presenterCtx);
  }

  private userTemplatePresetCatalog(principalId?: string): PresetDetail[] {
    return userTemplatePresetCatalog(this.presenterCtx, principalId);
  }

  private userAgentPresetCatalog(principalId?: string): PresetDetail[] {
    return userAgentPresetCatalog(this.presenterCtx, principalId);
  }

  private loadTemplateOrThrow(templateId: string, principalId: string): {
    template: SpaceTemplateRow;
    revision: SpaceTemplateRevisionRow;
    config: StoredTemplateConfig;
  } {
    return loadReadableTemplateAccessOrThrow(this.templates, templateId, principalId);
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
    return loadReadableTemplateAccessOrThrow(this.templates, templateId, principalId, options);
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
    return loadOwnedTemplateAccessOrThrow(this.templates, templateId, principalId, options);
  }

  private loadTemplateDetail(templateId: string, principalId?: string): PresetDetail | null {
    const loaded = loadTemplateDetailRecord(this.templates, templateId, principalId);
    if (!loaded) {
      return null;
    }
    return templateDetailFromLoaded(this.presenterCtx, loaded.template, loaded.revision, loaded.config);
  }

  private loadAgentPresetOrThrow(presetId: string, principalId: string): {
    preset: { preset_id: string; name: string; description: string; updated_at: string };
    revision: AgentPresetRevisionRow;
    config: StoredAgentPresetConfig;
  } {
    return loadAgentPresetAccessOrThrow(this.agentPresets, presetId, principalId);
  }

  private loadAgentPresetDetail(presetId: string, principalId?: string): PresetDetail | null {
    const loaded = loadAgentPresetDetailRecord(this.agentPresets, presetId, principalId);
    if (!loaded) {
      return null;
    }
    return toAgentPresetDetail(this.presenterCtx, loaded.preset, loaded.revision, loaded.config);
  }

  private toAgentPresetDetail(
    preset: { preset_id: string; name: string; description: string },
    revision: { revision: number },
    config: StoredAgentPresetConfig,
  ): PresetDetail {
    return toAgentPresetDetail(this.presenterCtx, preset, revision, config);
  }

  private toTemplateSummary(
    template: { template_id: string; name: string; updated_at: string },
    config: StoredTemplateConfig,
  ): SpaceTemplateSummary {
    return toTemplateSummary(template, config);
  }

  private toTemplateRecord(
    template: SpaceTemplateRow,
    config: StoredTemplateConfig,
  ): SpaceTemplateRecord {
    return toTemplateRecord(this.presenterCtx, template, config);
  }

  private publicTemplateAgents(
    baseAgents: TemplateAgentDefinition[],
    ownerPrincipalIdRaw: string,
  ): TemplateAgentDefinition[] {
    return publicTemplateAgents(this.presenterCtx, baseAgents, ownerPrincipalIdRaw);
  }
}
