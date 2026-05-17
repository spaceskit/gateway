import type {
  AgentPresetRepository,
  AgentPresetRevisionRow,
  SpaceTemplateRepository,
  SpaceTemplateRow,
  SpaceTemplateRevisionRow,
} from "@spaceskit/persistence";
import {
  parseAgentPresetConfig,
  parseTemplateConfig,
  type StoredAgentPresetConfig,
  type StoredTemplateConfig,
} from "./space-configurator-normalizers.js";
import { SpaceConfiguratorError } from "./space-configurator-service.js";

export interface LoadedTemplate {
  template: SpaceTemplateRow;
  revision: SpaceTemplateRevisionRow;
  config: StoredTemplateConfig;
}

export interface LoadedAgentPreset {
  preset: { preset_id: string; name: string; description: string; updated_at: string };
  revision: AgentPresetRevisionRow;
  config: StoredAgentPresetConfig;
}

export function loadReadableTemplateAccessOrThrow(
  templates: SpaceTemplateRepository | null,
  templateId: string,
  principalId: string,
  options: { includeArchived?: boolean } = {},
): LoadedTemplate {
  const normalizedTemplateId = templateId.trim();
  if (!normalizedTemplateId) {
    throw new SpaceConfiguratorError("INVALID_ARGUMENT", "templateId is required");
  }

  if (!templates) {
    throw new SpaceConfiguratorError("FAILED_PRECONDITION", "Template persistence is unavailable");
  }

  const normalizedPrincipalId = principalId.trim();
  if (!normalizedPrincipalId) {
    throw new SpaceConfiguratorError("INVALID_ARGUMENT", "principalId is required");
  }

  const template = templates.getById(normalizedTemplateId);
  if (!template || (!options.includeArchived && template.archived === 1)) {
    throw new SpaceConfiguratorError("NOT_FOUND", `Template not found: ${normalizedTemplateId}`);
  }

  const revision = templates.getActiveRevision(normalizedTemplateId);
  if (!revision) {
    throw new SpaceConfiguratorError(
      "FAILED_PRECONDITION",
      `Active template revision missing: ${normalizedTemplateId}`,
    );
  }

  const config = parseTemplateConfig(revision.space_config_json);
  const ownedByPrincipal = template.owner_principal_id === normalizedPrincipalId;
  const isSystemTemplate = template.owner_principal_id.trim() === "system";

  if (!ownedByPrincipal && !isSystemTemplate) {
    throw new SpaceConfiguratorError(
      "PERMISSION_DENIED",
      `Template is not accessible for principal: ${normalizedTemplateId}`,
    );
  }

  return {
    template,
    revision,
    config,
  };
}

export function loadOwnedTemplateAccessOrThrow(
  templates: SpaceTemplateRepository | null,
  templateId: string,
  principalId: string,
  options: { includeArchived?: boolean } = {},
): LoadedTemplate {
  const loaded = loadReadableTemplateAccessOrThrow(templates, templateId, principalId, options);
  const normalizedPrincipalId = principalId.trim();
  const ownedByPrincipal = loaded.template.owner_principal_id === normalizedPrincipalId;

  if (!ownedByPrincipal) {
    throw new SpaceConfiguratorError(
      "PERMISSION_DENIED",
      `Template is not accessible for principal: ${loaded.template.template_id}`,
    );
  }

  return loaded;
}

export function loadTemplateDetailRecord(
  templates: SpaceTemplateRepository | null,
  templateId: string,
  principalId: string | undefined,
): LoadedTemplate | null {
  if (!templates) {
    return null;
  }
  const normalizedPrincipalId = principalId?.trim();
  if (!normalizedPrincipalId) {
    return null;
  }

  const template = templates.getById(templateId);
  if (!template || template.archived === 1) {
    return null;
  }

  const revision = templates.getActiveRevision(templateId);
  if (!revision) {
    return null;
  }

  const config = parseTemplateConfig(revision.space_config_json);
  if (template.owner_principal_id !== normalizedPrincipalId) {
    return null;
  }

  return { template, revision, config };
}

export function loadAgentPresetAccessOrThrow(
  agentPresets: AgentPresetRepository | null,
  presetId: string,
  principalId: string,
): LoadedAgentPreset {
  const normalizedPresetId = presetId.trim();
  if (!normalizedPresetId) {
    throw new SpaceConfiguratorError("INVALID_ARGUMENT", "presetId is required");
  }

  if (!agentPresets) {
    throw new SpaceConfiguratorError("FAILED_PRECONDITION", "Agent preset persistence is unavailable");
  }

  const normalizedPrincipalId = principalId.trim();
  if (!normalizedPrincipalId) {
    throw new SpaceConfiguratorError("INVALID_ARGUMENT", "principalId is required");
  }

  const preset = agentPresets.getById(normalizedPresetId);
  if (!preset || preset.archived === 1) {
    throw new SpaceConfiguratorError("NOT_FOUND", `Agent preset not found: ${normalizedPresetId}`);
  }

  const revision = agentPresets.getActiveRevision(normalizedPresetId);
  if (!revision) {
    throw new SpaceConfiguratorError(
      "FAILED_PRECONDITION",
      `Active agent preset revision missing: ${normalizedPresetId}`,
    );
  }

  const config = parseAgentPresetConfig(revision.preset_config_json);
  const ownedByPrincipal = preset.owner_principal_id === normalizedPrincipalId;

  if (!ownedByPrincipal) {
    throw new SpaceConfiguratorError(
      "PERMISSION_DENIED",
      `Agent preset is not accessible for principal: ${normalizedPresetId}`,
    );
  }

  return {
    preset,
    revision,
    config,
  };
}

export interface LoadedAgentPresetDetail {
  preset: { preset_id: string; name: string; description: string };
  revision: AgentPresetRevisionRow;
  config: StoredAgentPresetConfig;
}

export function loadAgentPresetDetailRecord(
  agentPresets: AgentPresetRepository | null,
  presetId: string,
  principalId: string | undefined,
): LoadedAgentPresetDetail | null {
  if (!agentPresets) {
    return null;
  }

  const normalizedPrincipalId = principalId?.trim();
  if (!normalizedPrincipalId) {
    return null;
  }

  const preset = agentPresets.getById(presetId);
  if (!preset || preset.archived === 1) {
    return null;
  }

  const revision = agentPresets.getActiveRevision(presetId);
  if (!revision) {
    return null;
  }

  const config = parseAgentPresetConfig(revision.preset_config_json);
  if (preset.owner_principal_id !== normalizedPrincipalId) {
    return null;
  }

  return { preset, revision, config };
}
