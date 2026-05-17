import type {
  AddAgentInput,
  CreateSpaceInput,
  SpaceAdminService,
  SpaceAgentAssignment,
} from "@spaceskit/core";
import type { TemplateAgentDefinition } from "./space-configurator-service.js";

export type ResolveTemplateProfileId = (definition: TemplateAgentDefinition | string | undefined) => string;

export interface TemplateAgentApplicationResult {
  appliedAgents: number;
  skippedAgents: number;
}

export function toTemplateAddAgentInput(input: {
  spaceId: string;
  definition: TemplateAgentDefinition;
  idempotencyKey?: string;
  resolveProfileId: ResolveTemplateProfileId;
}): AddAgentInput {
  return {
    idempotencyKey: input.idempotencyKey
      ? `${input.idempotencyKey}:add-agent:${input.definition.agentId}`
      : undefined,
    spaceId: input.spaceId,
    agentId: input.definition.agentId,
    profileId: input.resolveProfileId(input.definition),
    role: input.definition.role,
    turnOrder: input.definition.turnOrder,
    isPrimary: input.definition.isPrimary,
  };
}

export function toInitialAgentInputs(
  definitions: TemplateAgentDefinition[],
  resolveProfileId: ResolveTemplateProfileId,
): NonNullable<CreateSpaceInput["initialAgents"]> {
  return definitions.map((definition, index) => ({
    agentId: definition.agentId,
    profileId: resolveProfileId(definition),
    role: definition.role,
    turnOrder: definition.turnOrder ?? index,
    isPrimary: definition.isPrimary,
  }));
}

export async function addMissingTemplateAgentsToSpace(input: {
  spaceAdminService: Pick<SpaceAdminService, "addAgent">;
  spaceId: string;
  definitions: TemplateAgentDefinition[];
  existingAssignments: SpaceAgentAssignment[];
  idempotencyKey?: string;
  resolveProfileId: ResolveTemplateProfileId;
}): Promise<TemplateAgentApplicationResult> {
  let appliedAgents = 0;
  let skippedAgents = 0;

  for (const definition of input.definitions) {
    const alreadyAssigned = input.existingAssignments.some((assignment) => assignment.agentId === definition.agentId);
    if (alreadyAssigned) {
      skippedAgents += 1;
      continue;
    }

    await input.spaceAdminService.addAgent(toTemplateAddAgentInput({
      spaceId: input.spaceId,
      definition,
      idempotencyKey: input.idempotencyKey,
      resolveProfileId: input.resolveProfileId,
    }));
    appliedAgents += 1;
  }

  return { appliedAgents, skippedAgents };
}
