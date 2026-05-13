import type {
  AgentPresetRepository,
  ProfileRepository,
  SpaceTemplateRepository,
  SpaceTemplateRow,
} from "@spaceskit/persistence";
import {
  conversationTopologyForCommunicationMode,
  parseAgentPresetConfig,
  parseTemplateConfig,
  promptPackIdForConversationTopology,
  type StoredAgentPresetConfig,
  type StoredTemplateConfig,
} from "./space-configurator-normalizers.js";
import type {
  PresetDetail,
  SpaceTemplateRecord,
  SpaceTemplateSummary,
  TemplateAgentDefinition,
  TemplateAgentProfileBinding,
} from "./space-configurator-service.js";

const USER_TEMPLATE_PRESET_PREFIX = "user.template.";
const USER_AGENT_PRESET_PREFIX = "user.agent.";

export interface PresenterContext {
  templates: SpaceTemplateRepository | null;
  agentPresets: AgentPresetRepository | null;
  profileRepo: ProfileRepository | null;
  defaultProfileId: string;
  defaultAgentId: string;
}

export function resolveProfileId(
  ctx: Pick<PresenterContext, "profileRepo" | "defaultProfileId">,
  definition: TemplateAgentDefinition | string | undefined,
): string {
  const requestedProfileId = typeof definition === "string"
    ? definition
    : definition?.profileBinding === "gateway_default_main"
      ? ctx.defaultProfileId
      : definition?.profileId;
  const candidate = requestedProfileId?.trim() || ctx.defaultProfileId;
  if (!ctx.profileRepo) {
    return candidate;
  }

  const profile = ctx.profileRepo.getById(candidate);
  if (profile && profile.archived === 0) {
    return candidate;
  }

  return ctx.defaultProfileId;
}

export function materializeTemplateAgentsForOwner(
  ctx: Pick<PresenterContext, "profileRepo" | "defaultProfileId">,
  baseAgents: TemplateAgentDefinition[],
  ownerPrincipalId: string,
): TemplateAgentDefinition[] {
  if (ownerPrincipalId.trim() === "system") {
    return baseAgents;
  }

  return baseAgents.map((definition) => ({
    ...definition,
    profileId: resolveProfileId(ctx, definition),
    profileBinding: "explicit",
  }));
}

export function publicTemplateAgents(
  ctx: Pick<PresenterContext, "profileRepo" | "defaultProfileId">,
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
      profileId: resolveProfileId(ctx, definition),
      profileBinding,
    };
  });
}

export function toAgentPresetDetail(
  ctx: Pick<PresenterContext, "profileRepo" | "defaultProfileId">,
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
        profileId: resolveProfileId(ctx, definition),
        profileBinding: "explicit",
      })),
    },
  };
}

export function toTemplateSummary(
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

export function toTemplateRecord(
  ctx: Pick<PresenterContext, "profileRepo" | "defaultProfileId">,
  template: SpaceTemplateRow,
  config: StoredTemplateConfig,
): SpaceTemplateRecord {
  const summary = toTemplateSummary(template, config);
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
    agentDefinitions: publicTemplateAgents(ctx, config.baseAgents, template.owner_principal_id),
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

export function systemPresetCatalog(
  ctx: Pick<PresenterContext, "defaultAgentId" | "defaultProfileId">,
): PresetDetail[] {
  const coordinatorAgent: TemplateAgentDefinition = {
    agentId: ctx.defaultAgentId,
    profileId: ctx.defaultProfileId,
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

export function userTemplatePresetCatalog(
  ctx: Pick<PresenterContext, "templates" | "profileRepo" | "defaultProfileId">,
  principalId: string | undefined,
): PresetDetail[] {
  if (!ctx.templates) {
    return [];
  }
  const normalizedPrincipalId = principalId?.trim();
  if (!normalizedPrincipalId) {
    return [];
  }

  const presets: PresetDetail[] = [];
  for (const template of ctx.templates.list({
    includeArchived: false,
    ownerPrincipalId: normalizedPrincipalId,
  })) {
    const revision = ctx.templates.getActiveRevision(template.template_id);
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
        baseAgents: publicTemplateAgents(ctx, config.baseAgents, template.owner_principal_id),
        agentPresetIds: config.agentPresetIds,
      },
    });
  }
  return presets;
}

export function userAgentPresetCatalog(
  ctx: Pick<PresenterContext, "agentPresets" | "profileRepo" | "defaultProfileId">,
  principalId: string | undefined,
): PresetDetail[] {
  if (!ctx.agentPresets) {
    return [];
  }
  const normalizedPrincipalId = principalId?.trim();
  if (!normalizedPrincipalId) {
    return [];
  }

  const presets: PresetDetail[] = [];
  for (const preset of ctx.agentPresets.list({
    includeArchived: false,
    ownerPrincipalId: normalizedPrincipalId,
  })) {
    const revision = ctx.agentPresets.getActiveRevision(preset.preset_id);
    if (!revision) continue;
    const config = parseAgentPresetConfig(revision.preset_config_json);
    presets.push(toAgentPresetDetail(ctx, preset, revision, config));
  }
  return presets;
}

export function templateDetailFromLoaded(
  ctx: Pick<PresenterContext, "profileRepo" | "defaultProfileId">,
  template: SpaceTemplateRow,
  revision: { revision: number },
  config: StoredTemplateConfig,
): PresetDetail {
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
      baseAgents: publicTemplateAgents(ctx, config.baseAgents, template.owner_principal_id),
      agentPresetIds: config.agentPresetIds,
    },
  };
}
