import {
  normalizeStringArray,
  parseTemplateConfig,
  toPresetSummary,
} from "./space-configurator-normalizers.js";
import {
  loadAgentPresetDetailRecord,
  loadReadableTemplateAccessOrThrow,
  loadTemplateDetailRecord,
} from "./space-configurator-access.js";
import {
  publicTemplateAgents,
  systemPresetCatalog,
  templateDetailFromLoaded,
  toAgentPresetDetail,
  toTemplateRecord,
  toTemplateSummary,
  userAgentPresetCatalog,
  userTemplatePresetCatalog,
  type PresenterContext,
} from "./space-configurator-presenters.js";
import {
  SpaceConfiguratorError,
  type GetTemplateInput,
  type ListPresetsInput,
  type ListTemplatesInput,
  type PresetDetail,
  type PresetSummary,
  type PreviewTemplateInput,
  type SpaceTemplatePreviewResult,
  type SpaceTemplateRecord,
} from "./space-configurator-service.js";

const USER_TEMPLATE_PRESET_PREFIX = "user.template.";
const USER_AGENT_PRESET_PREFIX = "user.agent.";

export function listSpaceConfiguratorPresets(
  ctx: PresenterContext,
  input: ListPresetsInput = {},
  principalId?: string,
): PresetSummary[] {
  const kindFilter = input.kind ?? "all";
  const sourceFilter = input.source ?? "all";
  const tagsFilter = normalizeStringArray(input.tags);

  const all: PresetSummary[] = [
    ...systemPresetCatalog(ctx).map((preset) => toPresetSummary(preset)),
    ...userTemplatePresetCatalog(ctx, principalId).map((preset) => toPresetSummary(preset)),
    ...userAgentPresetCatalog(ctx, principalId).map((preset) => toPresetSummary(preset)),
  ];

  return all.filter((preset) => {
    if (kindFilter !== "all" && preset.kind !== kindFilter) return false;
    if (sourceFilter !== "all" && preset.source !== sourceFilter) return false;
    if (tagsFilter.length > 0 && !preset.tags.some((tag) => tagsFilter.includes(tag))) return false;
    return true;
  });
}

export function listSpaceConfiguratorTemplates(
  ctx: PresenterContext,
  input: ListTemplatesInput = {},
  principalId: string,
): SpaceTemplateRecord[] {
  if (!ctx.templates) {
    throw new SpaceConfiguratorError("FAILED_PRECONDITION", "Template persistence is unavailable");
  }

  const normalizedPrincipalId = principalId.trim();
  if (!normalizedPrincipalId) {
    throw new SpaceConfiguratorError("INVALID_ARGUMENT", "principalId is required");
  }

  const includeArchived = input.includeArchived === true;
  const excludeSystem = input.includeSystem === false;
  const records: SpaceTemplateRecord[] = [];

  for (const template of ctx.templates.list({ includeArchived: true })) {
    const revision = ctx.templates.getActiveRevision(template.template_id);
    if (!revision) continue;
    const config = parseTemplateConfig(revision.space_config_json);

    const explicitOwner = template.owner_principal_id.trim();
    const isSystemTemplate = explicitOwner === "system";

    if (isSystemTemplate) {
      if (excludeSystem) continue;
    } else if (explicitOwner !== normalizedPrincipalId) {
      continue;
    }

    if (!includeArchived && template.archived === 1) {
      continue;
    }

    records.push(toTemplateRecord(ctx, template, config));
  }

  records.sort((a, b) => {
    const aSort = a.sortOrder ?? 999;
    const bSort = b.sortOrder ?? 999;
    if (a.featured !== b.featured) return a.featured ? -1 : 1;
    return aSort - bSort;
  });

  return records;
}

export function getSpaceConfiguratorTemplate(
  ctx: PresenterContext,
  input: GetTemplateInput,
  principalId: string,
): SpaceTemplateRecord {
  const loaded = loadReadableTemplateAccessOrThrow(ctx.templates, input.templateId, principalId, {
    includeArchived: true,
  });
  return toTemplateRecord(ctx, loaded.template, loaded.config);
}

export function getSpaceConfiguratorPreset(
  ctx: PresenterContext,
  presetId: string,
  principalId?: string,
): PresetDetail {
  const normalizedPresetId = presetId.trim();
  if (!normalizedPresetId) {
    throw new SpaceConfiguratorError("INVALID_ARGUMENT", "presetId is required");
  }

  const systemPreset = systemPresetCatalog(ctx).find((preset) => preset.presetId === normalizedPresetId);
  if (systemPreset) {
    return systemPreset;
  }

  if (normalizedPresetId.startsWith(USER_TEMPLATE_PRESET_PREFIX)) {
    const templateId = normalizedPresetId.slice(USER_TEMPLATE_PRESET_PREFIX.length);
    const loaded = loadTemplateDetailRecord(ctx.templates, templateId, principalId);
    if (loaded) {
      return templateDetailFromLoaded(ctx, loaded.template, loaded.revision, loaded.config);
    }
  }

  if (normalizedPresetId.startsWith(USER_AGENT_PRESET_PREFIX)) {
    const userPresetId = normalizedPresetId.slice(USER_AGENT_PRESET_PREFIX.length);
    const loaded = loadAgentPresetDetailRecord(ctx.agentPresets, userPresetId, principalId);
    if (loaded) {
      return toAgentPresetDetail(ctx, loaded.preset, loaded.revision, loaded.config);
    }
  }

  throw new SpaceConfiguratorError("NOT_FOUND", `Preset not found: ${normalizedPresetId}`);
}

export function previewSpaceConfiguratorTemplate(
  ctx: PresenterContext,
  input: PreviewTemplateInput,
  principalId: string,
): SpaceTemplatePreviewResult {
  const loaded = loadReadableTemplateAccessOrThrow(ctx.templates, input.templateId, principalId);
  const summary = toTemplateSummary(loaded.template, loaded.config);

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
      initialAgents: publicTemplateAgents(
        ctx,
        loaded.config.baseAgents,
        loaded.template.owner_principal_id,
      ),
    },
    warnings: [],
  };
}
