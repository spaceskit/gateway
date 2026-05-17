import { randomUUID } from "node:crypto";
import type { SpaceAdminService } from "@spaceskit/core";
import type {
  AgentPresetRepository,
  SpaceTemplateRepository,
} from "@spaceskit/persistence";
import { loadOwnedTemplateAccessOrThrow } from "./space-configurator-access.js";
import {
  COMMUNICATION_MODE_TO_TURN_MODEL,
  TURN_MODEL_TO_COMMUNICATION_MODE,
  normalizeStringArray,
  normalizeTemplateAgents,
  type StoredAgentPresetConfig,
  type StoredTemplateConfig,
} from "./space-configurator-normalizers.js";
import {
  materializeTemplateAgentsForOwner,
  toAgentPresetDetail,
  toTemplateRecord,
  toTemplateSummary,
  type PresenterContext,
} from "./space-configurator-presenters.js";
import {
  SpaceConfiguratorError,
  type ArchiveAgentPresetInput,
  type ArchiveAgentPresetResult,
  type ArchiveTemplateInput,
  type ArchiveTemplateResult,
  type SaveAgentPresetInput,
  type SaveAgentPresetResult,
  type SaveTemplateInput,
  type SaveTemplateResult,
  type TemplateAgentDefinition,
} from "./space-configurator-service.js";

export interface SpaceConfiguratorUpdateContext extends PresenterContext {
  templates: SpaceTemplateRepository | null;
  agentPresets: AgentPresetRepository | null;
  spaceAdminService: Pick<SpaceAdminService, "getSpace">;
}

export async function saveTemplateRevision(
  ctx: SpaceConfiguratorUpdateContext,
  input: SaveTemplateInput,
): Promise<SaveTemplateResult> {
  if (!ctx.templates) {
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
    const existing = ctx.templates.getById(templateId);
    if (existing && existing.owner_principal_id.trim() !== principalId) {
      throw new SpaceConfiguratorError(
        "PERMISSION_DENIED",
        `Template is owned by another principal: ${templateId}`,
      );
    }
  }

  let communicationMode = input.communicationMode;
  let baseAgents = normalizeTemplateAgents(input.baseAgents ?? []);
  if (input.sourceSpaceId?.trim()) {
    const source = await ctx.spaceAdminService.getSpace(input.sourceSpaceId.trim());
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

  baseAgents = materializeTemplateAgentsForOwner(ctx, baseAgents, principalId);

  if (!communicationMode) {
    communicationMode = "chat_first";
  }

  if (baseAgents.length === 0) {
    baseAgents = [defaultCoordinatorAgent(ctx)];
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

  const upserted = ctx.templates.upsertWithNewRevision({
    templateId,
    ownerPrincipalId: principalId,
    name: title,
    description,
    spaceConfigJson: JSON.stringify(config),
  });

  return {
    template: toTemplateSummary(upserted.template, config),
    created: upserted.created,
  };
}

export function archiveTemplateRevision(
  ctx: SpaceConfiguratorUpdateContext,
  input: ArchiveTemplateInput,
  principalId: string,
): ArchiveTemplateResult {
  if (!ctx.templates) {
    throw new SpaceConfiguratorError("FAILED_PRECONDITION", "Template persistence is unavailable");
  }

  const normalizedTemplateId = input.templateId.trim();
  const existing = loadOwnedTemplateAccessOrThrow(ctx.templates, normalizedTemplateId, principalId, {
    includeArchived: true,
  });
  const archived = existing.template.archived === 1
    ? false
    : ctx.templates.archive(normalizedTemplateId);
  const refreshed = loadOwnedTemplateAccessOrThrow(ctx.templates, normalizedTemplateId, principalId, {
    includeArchived: true,
  });

  return {
    template: toTemplateRecord(ctx, refreshed.template, refreshed.config),
    archived,
  };
}

export async function saveAgentPresetRevision(
  ctx: SpaceConfiguratorUpdateContext,
  input: SaveAgentPresetInput,
): Promise<SaveAgentPresetResult> {
  if (!ctx.agentPresets) {
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
    const existing = ctx.agentPresets.getById(presetId);
    if (existing && existing.owner_principal_id.trim() !== principalId) {
      throw new SpaceConfiguratorError(
        "PERMISSION_DENIED",
        `Agent preset is owned by another principal: ${presetId}`,
      );
    }
  }

  let defaultAgents = normalizeTemplateAgents(input.defaultAgents ?? []);
  if (defaultAgents.length === 0) {
    defaultAgents = [defaultCoordinatorAgent(ctx)];
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

  const upserted = ctx.agentPresets.upsertWithNewRevision({
    presetId,
    ownerPrincipalId: principalId,
    name: title,
    description,
    presetConfigJson: JSON.stringify(config),
  });

  return {
    preset: toAgentPresetDetail(ctx, upserted.preset, upserted.revision, config),
    created: upserted.created,
  };
}

export async function archiveAgentPresetRevision(
  ctx: SpaceConfiguratorUpdateContext,
  input: ArchiveAgentPresetInput,
): Promise<ArchiveAgentPresetResult> {
  if (!ctx.agentPresets) {
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

  const existing = ctx.agentPresets.getById(presetId);
  if (!existing || existing.archived === 1) {
    throw new SpaceConfiguratorError("NOT_FOUND", `Agent preset not found: ${presetId}`);
  }

  const explicitOwner = existing.owner_principal_id.trim();
  if (explicitOwner !== principalId) {
    throw new SpaceConfiguratorError(
      "PERMISSION_DENIED",
      `Agent preset is owned by another principal: ${presetId}`,
    );
  }

  return {
    presetId,
    archived: ctx.agentPresets.archive(presetId),
  };
}

function defaultCoordinatorAgent(
  ctx: Pick<PresenterContext, "defaultAgentId" | "defaultProfileId">,
): TemplateAgentDefinition {
  return {
    agentId: ctx.defaultAgentId,
    profileId: ctx.defaultProfileId,
    profileBinding: "explicit",
    role: "global_coordinator",
    turnOrder: 0,
    isPrimary: true,
  };
}
