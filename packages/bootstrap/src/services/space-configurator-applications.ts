import { randomUUID } from "node:crypto";
import type { SpaceAdminService, SpaceConfig } from "@spaceskit/core";
import type { SpacePresetApplicationRepository } from "@spaceskit/persistence";
import { loadReadableTemplateAccessOrThrow } from "./space-configurator-access.js";
import { getSpaceConfiguratorPreset } from "./space-configurator-catalog.js";
import {
  addMissingTemplateAgentsToSpace,
  toInitialAgentInputs,
} from "./space-configurator-space-plans.js";
import {
  resolveProfileId,
  toTemplateSummary,
  type PresenterContext,
} from "./space-configurator-presenters.js";
import {
  SpaceConfiguratorError,
  type ApplyPresetInput,
  type CreateFromTemplateInput,
  type PresetApplyResult,
  type SpaceCreateFromTemplateResult,
} from "./space-configurator-service.js";

export interface SpaceConfiguratorApplicationContext extends PresenterContext {
  presetApplications: SpacePresetApplicationRepository | null;
  spaceAdminService: Pick<
    SpaceAdminService,
    "createSpace" | "getSpace" | "listAgentAssignments" | "addAgent"
  >;
  now: () => Date;
}

export async function applySpaceConfiguratorPreset(
  ctx: SpaceConfiguratorApplicationContext,
  input: ApplyPresetInput,
): Promise<PresetApplyResult> {
  const principalId = input.principalId.trim();
  if (!principalId) {
    throw new SpaceConfiguratorError("INVALID_ARGUMENT", "principalId is required");
  }

  const preset = getSpaceConfiguratorPreset(ctx, input.presetId, principalId);
  const appliedAt = ctx.now().toISOString();
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
    const existingSpace = await ctx.spaceAdminService.getSpace(targetSpaceId);
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

    const existingAssignments = await ctx.spaceAdminService.listAgentAssignments(targetSpaceId);
    const applied = await addMissingTemplateAgentsToSpace({
      spaceAdminService: ctx.spaceAdminService,
      spaceId: targetSpaceId,
      definitions: agentPreset.defaultAgents,
      existingAssignments,
      idempotencyKey: input.idempotencyKey,
      resolveProfileId: (definition) => resolveProfileId(ctx, definition),
    });
    appliedAgents += applied.appliedAgents;
    skippedAgents += applied.skippedAgents;

    space = (await ctx.spaceAdminService.getSpace(targetSpaceId)) ?? existingSpace;
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
      const existingSpace = await ctx.spaceAdminService.getSpace(targetSpaceId);
      if (!existingSpace) {
        throw new SpaceConfiguratorError("NOT_FOUND", `Space not found: ${targetSpaceId}`);
      }

      const existingAssignments = await ctx.spaceAdminService.listAgentAssignments(targetSpaceId);
      const applied = await addMissingTemplateAgentsToSpace({
        spaceAdminService: ctx.spaceAdminService,
        spaceId: targetSpaceId,
        definitions: spacePreset.baseAgents,
        existingAssignments,
        idempotencyKey: input.idempotencyKey,
        resolveProfileId: (definition) => resolveProfileId(ctx, definition),
      });
      appliedAgents += applied.appliedAgents;
      skippedAgents += applied.skippedAgents;

      space = (await ctx.spaceAdminService.getSpace(targetSpaceId)) ?? existingSpace;
    } else {
      const resourceId = input.resourceId?.trim();
      if (!resourceId) {
        throw new SpaceConfiguratorError(
          "INVALID_ARGUMENT",
          "resourceId is required when creating a new space from a preset",
        );
      }

      space = await ctx.spaceAdminService.createSpace({
        idempotencyKey: input.idempotencyKey,
        spaceId: input.spaceId?.trim() || undefined,
        resourceId,
        spaceType: "space",
        name: input.name?.trim() || preset.title,
        goal: input.goal?.trim() || undefined,
        turnModel: spacePreset.turnModel,
        visibility: input.visibility ?? "shared",
        initialAgents: toInitialAgentInputs(
          spacePreset.baseAgents,
          (definition) => resolveProfileId(ctx, definition),
        ),
      });
      createdSpace = true;
      appliedAgents = spacePreset.baseAgents.length;
    }
  }

  ctx.presetApplications?.create({
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

export async function createSpaceFromConfiguratorTemplate(
  ctx: SpaceConfiguratorApplicationContext,
  input: CreateFromTemplateInput,
  principalId: string,
): Promise<SpaceCreateFromTemplateResult> {
  const loaded = loadReadableTemplateAccessOrThrow(ctx.templates, input.templateId, principalId);
  const summary = toTemplateSummary(loaded.template, loaded.config);

  const created = await ctx.spaceAdminService.createSpace({
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
    initialAgents: toInitialAgentInputs(
      loaded.config.baseAgents,
      (definition) => resolveProfileId(ctx, definition),
    ),
  });

  return {
    template: summary,
    space: created,
  };
}
