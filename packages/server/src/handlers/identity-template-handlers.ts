import { randomUUID } from "node:crypto";
import type { ErrorPayload } from "../protocol.js";
import {
  MessageTypes,
  type AgentDefinitionSummaryPayload,
  type GatewayMessage,
  type IdentityArchiveAgentDefinitionPayload,
  type IdentityArchiveAgentDefinitionResponsePayload,
  type IdentityArchivePersonaPayload,
  type IdentityArchivePersonaResponsePayload,
  type IdentityCreateAgentDefinitionPayload,
  type IdentityCreateAgentDefinitionResponsePayload,
  type IdentityCreatePersonaPayload,
  type IdentityCreatePersonaResponsePayload,
  type IdentityGetAgentDefinitionPayload,
  type IdentityGetAgentDefinitionResponsePayload,
  type IdentityGetPersonaPayload,
  type IdentityGetPersonaResponsePayload,
  type IdentityListAgentDefinitionsPayload,
  type IdentityListAgentDefinitionsResponsePayload,
  type IdentityListPersonasPayload,
  type IdentityListPersonasResponsePayload,
  type IdentityPreviewCompiledInstructionsPayload,
  type IdentityPreviewCompiledInstructionsResponsePayload,
  type IdentityPreviewRuntimeSystemPromptPayload,
  type IdentityPreviewRuntimeSystemPromptResponsePayload,
  type IdentityPreviewSystemPromptMatrixPayload,
  type IdentityPreviewSystemPromptMatrixResponsePayload,
  type IdentityUpdateAgentDefinitionPayload,
  type IdentityUpdateAgentDefinitionResponsePayload,
  type IdentityUpdatePersonaPayload,
  type IdentityUpdatePersonaResponsePayload,
  type SpaceTemplateArchivePayload,
  type SpaceTemplateArchiveResponsePayload,
  type SpaceCreateFromTemplatePayload,
  type SpaceCreateFromTemplateResponsePayload,
  type SpaceTemplateGetPayload,
  type SpaceTemplateGetResponsePayload,
  type SpaceTemplateListPayload,
  type SpaceTemplateListResponsePayload,
  type SpacePreviewTemplatePayload,
  type SpacePreviewTemplateResponsePayload,
  type SpaceSaveTemplatePayload,
  type SpaceSaveTemplateResponsePayload,
  type SpaceSummary,
} from "../protocol.js";
import type { ClientSession } from "../gateway-server.js";
import type {
  GatewayAdminService,
  GatewayIdentityService,
} from "../message-router-gateway-services.js";
import type {
  RouterSpaceDecorators,
  SpaceTemplateService,
  SpaceWorkspaceService,
} from "../message-router-space-services.js";
import { normalizeString } from "../message-router-utils.js";
import type { SpaceManager } from "@spaceskit/core";

export interface IdentityTemplateHandlerContext extends RouterSpaceDecorators {
  gatewayAdminService: GatewayAdminService | null;
  gatewayIdentityService: GatewayIdentityService | null;
  spaceTemplateService: SpaceTemplateService | null;
  spaceWorkspaceService: SpaceWorkspaceService | null;
  spaceManager: Pick<SpaceManager, "invalidateCache">;
  broadcastToSpace: (spaceUid: string, msg: GatewayMessage) => void;
  listAssignmentsByProfileId?: (profileId: string) => Array<{
    spaceId: string;
    agentId: string;
    profileId: string;
  }> | Promise<Array<{
    spaceId: string;
    agentId: string;
    profileId: string;
  }>>;
  response: (correlationId: string, type: string, payload?: unknown) => GatewayMessage;
  errorResponse: (
    correlationId: string,
    code: ErrorPayload["code"],
    message: string,
    errDetails?: unknown,
  ) => GatewayMessage;
}

export async function handleIdentityListAgentDefinitions(
  context: IdentityTemplateHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.gatewayIdentityService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Gateway identity service unavailable");
  }
  const payload = (msg.payload ?? {}) as IdentityListAgentDefinitionsPayload;
  return context.response(msg.id, MessageTypes.IDENTITY_LIST_AGENT_DEFINITIONS, {
    agentDefinitions: context.gatewayIdentityService.listAgentDefinitions(payload.includeArchived),
  } satisfies IdentityListAgentDefinitionsResponsePayload);
}

export async function handleIdentityGetAgentDefinition(
  context: IdentityTemplateHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.gatewayIdentityService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Gateway identity service unavailable");
  }
  const payload = msg.payload as IdentityGetAgentDefinitionPayload;
  if (!payload?.agentDefinitionId) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "agentDefinitionId is required");
  }

  const agentDefinition = context.gatewayIdentityService.getAgentDefinition(payload.agentDefinitionId);
  if (!agentDefinition) {
    return context.errorResponse(msg.id, "NOT_FOUND", `Agent Definition not found: ${payload.agentDefinitionId}`);
  }

  return context.response(msg.id, MessageTypes.IDENTITY_GET_AGENT_DEFINITION, {
    agentDefinition,
  } satisfies IdentityGetAgentDefinitionResponsePayload);
}

export async function handleIdentityCreateAgentDefinition(
  context: IdentityTemplateHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.gatewayIdentityService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Gateway identity service unavailable");
  }
  const payload = msg.payload as IdentityCreateAgentDefinitionPayload;
  if (!payload?.name) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "name is required");
  }

  if (context.gatewayAdminService) {
    context.gatewayAdminService.validateProfileModelSelection({
      providerHint: normalizeString(payload.providerHint),
      modelHint: normalizeString(payload.modelHint),
      modelConfig: payload.modelConfig,
    });
  }

  const result = context.gatewayIdentityService.createAgentDefinition(payload);
  return context.response(msg.id, MessageTypes.IDENTITY_CREATE_AGENT_DEFINITION, result satisfies IdentityCreateAgentDefinitionResponsePayload);
}

export async function handleIdentityUpdateAgentDefinition(
  context: IdentityTemplateHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.gatewayIdentityService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Gateway identity service unavailable");
  }
  const payload = msg.payload as IdentityUpdateAgentDefinitionPayload;
  if (!payload?.agentDefinitionId) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "agentDefinitionId is required");
  }

  const existingAgentDefinition = context.gatewayIdentityService.getAgentDefinition(payload.agentDefinitionId);
  if (!existingAgentDefinition) {
    return context.errorResponse(msg.id, "NOT_FOUND", `Agent Definition not found: ${payload.agentDefinitionId}`);
  }

  const hasProviderHint = Object.prototype.hasOwnProperty.call(payload, "providerHint");
  const hasModelHint = Object.prototype.hasOwnProperty.call(payload, "modelHint");
  const hasModelConfig = Object.prototype.hasOwnProperty.call(payload, "modelConfig");
  if (context.gatewayAdminService && (hasProviderHint || hasModelHint || hasModelConfig)) {
    context.gatewayAdminService.validateProfileModelSelection({
      providerHint: hasProviderHint
        ? normalizeString(payload.providerHint)
        : normalizeString(existingAgentDefinition.providerHint),
      modelHint: hasModelHint
        ? normalizeString(payload.modelHint)
        : normalizeString(existingAgentDefinition.modelHint),
      modelConfig: hasModelConfig ? payload.modelConfig : existingAgentDefinition.modelConfig,
    });
  }

  const result = context.gatewayIdentityService.updateAgentDefinition(payload);
  if (runtimeSelectionChanged(existingAgentDefinition, result.agentDefinition)) {
    await notifyAffectedSpacesForRuntimeUpdate(
      context,
      payload.agentDefinitionId,
      result.agentDefinition.updatedAt,
    );
  }
  return context.response(msg.id, MessageTypes.IDENTITY_UPDATE_AGENT_DEFINITION, result satisfies IdentityUpdateAgentDefinitionResponsePayload);
}

export async function handleIdentityArchiveAgentDefinition(
  context: IdentityTemplateHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.gatewayIdentityService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Gateway identity service unavailable");
  }
  const payload = msg.payload as IdentityArchiveAgentDefinitionPayload;
  if (!payload?.agentDefinitionId) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "agentDefinitionId is required");
  }

  const result = context.gatewayIdentityService.archiveAgentDefinition(payload);
  return context.response(msg.id, MessageTypes.IDENTITY_ARCHIVE_AGENT_DEFINITION, result satisfies IdentityArchiveAgentDefinitionResponsePayload);
}

function runtimeSelectionChanged(
  previous: AgentDefinitionSummaryPayload | null,
  next: AgentDefinitionSummaryPayload,
): boolean {
  if (!previous) return false;

  const previousProviderHint = normalizeString(previous.providerHint);
  const nextProviderHint = normalizeString(next.providerHint);
  if (previousProviderHint !== nextProviderHint) {
    return true;
  }

  const previousModelHint = normalizeString(previous.modelHint);
  const nextModelHint = normalizeString(next.modelHint);
  if (previousModelHint !== nextModelHint) {
    return true;
  }

  return JSON.stringify(previous.modelConfig ?? null) !== JSON.stringify(next.modelConfig ?? null);
}

async function notifyAffectedSpacesForRuntimeUpdate(
  context: IdentityTemplateHandlerContext,
  agentDefinitionId: string,
  updatedAt: string,
): Promise<void> {
  const listAssignmentsByProfileId = context.listAssignmentsByProfileId;
  if (!listAssignmentsByProfileId) {
    return;
  }

  const assignments = await listAssignmentsByProfileId(agentDefinitionId);
  if (assignments.length === 0) {
    return;
  }

  const invalidatedSpaces = new Set<string>();
  for (const assignment of assignments) {
    if (!invalidatedSpaces.has(assignment.spaceId)) {
      invalidatedSpaces.add(assignment.spaceId);
      context.spaceManager.invalidateCache(assignment.spaceId);
    }

    const spaceUid = await context.resolveSpaceUid(assignment.spaceId);
    context.broadcastToSpace(spaceUid, {
      type: MessageTypes.SPACE_AGENT_UPDATED,
      id: randomUUID(),
      ts: new Date().toISOString(),
      payload: {
        spaceId: assignment.spaceId,
        spaceUid,
        agentId: assignment.agentId,
        oldProfileId: assignment.profileId,
        newProfileId: assignment.profileId,
        updatedAt: normalizeString(updatedAt) ?? new Date().toISOString(),
      },
    });
  }
}

export async function handleIdentityListPersonas(
  context: IdentityTemplateHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.gatewayIdentityService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Gateway identity service unavailable");
  }
  const payload = (msg.payload ?? {}) as IdentityListPersonasPayload;
  return context.response(msg.id, MessageTypes.IDENTITY_LIST_PERSONAS, {
    personas: context.gatewayIdentityService.listPersonas(payload.includeArchived),
  } satisfies IdentityListPersonasResponsePayload);
}

export async function handleIdentityGetPersona(
  context: IdentityTemplateHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.gatewayIdentityService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Gateway identity service unavailable");
  }
  const payload = msg.payload as IdentityGetPersonaPayload;
  if (!payload?.personaId) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "personaId is required");
  }

  const persona = context.gatewayIdentityService.getPersona(payload.personaId);
  if (!persona) {
    return context.errorResponse(msg.id, "NOT_FOUND", `Persona not found: ${payload.personaId}`);
  }

  return context.response(msg.id, MessageTypes.IDENTITY_GET_PERSONA, {
    persona,
  } satisfies IdentityGetPersonaResponsePayload);
}

export async function handleIdentityCreatePersona(
  context: IdentityTemplateHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.gatewayIdentityService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Gateway identity service unavailable");
  }
  const payload = msg.payload as IdentityCreatePersonaPayload;
  if (!payload?.name) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "name is required");
  }

  const result = context.gatewayIdentityService.createPersona(payload);
  return context.response(msg.id, MessageTypes.IDENTITY_CREATE_PERSONA, result satisfies IdentityCreatePersonaResponsePayload);
}

export async function handleIdentityUpdatePersona(
  context: IdentityTemplateHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.gatewayIdentityService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Gateway identity service unavailable");
  }
  const payload = msg.payload as IdentityUpdatePersonaPayload;
  if (!payload?.personaId) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "personaId is required");
  }

  const result = context.gatewayIdentityService.updatePersona(payload);
  return context.response(msg.id, MessageTypes.IDENTITY_UPDATE_PERSONA, result satisfies IdentityUpdatePersonaResponsePayload);
}

export async function handleIdentityArchivePersona(
  context: IdentityTemplateHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.gatewayIdentityService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Gateway identity service unavailable");
  }
  const payload = msg.payload as IdentityArchivePersonaPayload;
  if (!payload?.personaId) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "personaId is required");
  }

  const result = context.gatewayIdentityService.archivePersona(payload);
  return context.response(msg.id, MessageTypes.IDENTITY_ARCHIVE_PERSONA, result satisfies IdentityArchivePersonaResponsePayload);
}

export async function handleIdentityPreviewCompiledInstructions(
  context: IdentityTemplateHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.gatewayIdentityService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Gateway identity service unavailable");
  }
  const payload = msg.payload as IdentityPreviewCompiledInstructionsPayload;
  if (!payload?.agentDefinitionId) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "agentDefinitionId is required");
  }

  const result = context.gatewayIdentityService.previewCompiledInstructions(payload);
  return context.response(msg.id, MessageTypes.IDENTITY_PREVIEW_COMPILED_INSTRUCTIONS, result satisfies IdentityPreviewCompiledInstructionsResponsePayload);
}

export async function handleIdentityPreviewRuntimeSystemPrompt(
  context: IdentityTemplateHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.gatewayIdentityService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Gateway identity service unavailable");
  }
  const payload = msg.payload as IdentityPreviewRuntimeSystemPromptPayload;
  if (!payload?.spaceId) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "spaceId is required");
  }

  const result = await context.gatewayIdentityService.previewRuntimeSystemPrompt(payload);
  return context.response(msg.id, MessageTypes.IDENTITY_PREVIEW_RUNTIME_SYSTEM_PROMPT, result satisfies IdentityPreviewRuntimeSystemPromptResponsePayload);
}

export async function handleIdentityPreviewSystemPromptMatrix(
  context: IdentityTemplateHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.gatewayIdentityService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Gateway identity service unavailable");
  }
  const payload = msg.payload as IdentityPreviewSystemPromptMatrixPayload;
  if (!payload?.agentDefinitionId) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "agentDefinitionId is required");
  }

  const result = await context.gatewayIdentityService.previewSystemPromptMatrix(payload);
  return context.response(msg.id, MessageTypes.IDENTITY_PREVIEW_SYSTEM_PROMPT_MATRIX, result satisfies IdentityPreviewSystemPromptMatrixResponsePayload);
}

export async function handleSpaceListTemplates(
  context: IdentityTemplateHandlerContext,
  client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.spaceTemplateService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Space template service unavailable");
  }
  if (!client.publicKey) {
    return context.errorResponse(msg.id, "UNAUTHENTICATED", "Authenticated principal key is required");
  }

  const payload = (msg.payload ?? {}) as SpaceTemplateListPayload;
  const templates = context.spaceTemplateService.listTemplates(payload, client.publicKey);
  return context.response(
    msg.id,
    MessageTypes.SPACE_LIST_TEMPLATES,
    { templates } satisfies SpaceTemplateListResponsePayload,
  );
}

export async function handleSpaceGetTemplate(
  context: IdentityTemplateHandlerContext,
  client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.spaceTemplateService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Space template service unavailable");
  }
  if (!client.publicKey) {
    return context.errorResponse(msg.id, "UNAUTHENTICATED", "Authenticated principal key is required");
  }

  const payload = msg.payload as SpaceTemplateGetPayload;
  if (!payload?.templateId) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "templateId is required");
  }

  const template = context.spaceTemplateService.getTemplate(payload, client.publicKey);
  return context.response(
    msg.id,
    MessageTypes.SPACE_GET_TEMPLATE,
    { template } satisfies SpaceTemplateGetResponsePayload,
  );
}

export async function handleSpacePreviewTemplate(
  context: IdentityTemplateHandlerContext,
  client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.spaceTemplateService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Space template service unavailable");
  }
  if (!client.publicKey) {
    return context.errorResponse(msg.id, "UNAUTHENTICATED", "Authenticated principal key is required");
  }

  const payload = msg.payload as SpacePreviewTemplatePayload;
  if (!payload?.templateId) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "templateId is required");
  }

  const result = context.spaceTemplateService.previewTemplate(payload, client.publicKey);
  return context.response(
    msg.id,
    MessageTypes.SPACE_PREVIEW_TEMPLATE,
    result as unknown as SpacePreviewTemplateResponsePayload,
  );
}

export async function handleSpaceCreateFromTemplate(
  context: IdentityTemplateHandlerContext,
  client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.spaceTemplateService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Space template service unavailable");
  }
  if (!client.publicKey) {
    return context.errorResponse(msg.id, "UNAUTHENTICATED", "Authenticated principal key is required");
  }

  const payload = msg.payload as SpaceCreateFromTemplatePayload;
  if (!payload?.templateId || !payload?.resourceId) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "templateId and resourceId are required");
  }

  let result = await context.spaceTemplateService.createFromTemplate(
    payload,
    client.publicKey,
  ) as unknown as SpaceCreateFromTemplateResponsePayload;
  if (context.spaceWorkspaceService && result.space) {
    if (payload.workspaceRoot !== undefined) {
      await context.spaceWorkspaceService.setWorkspace(result.space.id, payload.workspaceRoot);
    } else {
      await context.spaceWorkspaceService.ensureWorkspace(result.space.id);
    }
  }
  if (result.space) {
    result = {
      ...result,
      space: await context.decorateSpaceSummary(result.space as unknown as SpaceSummary),
    };
  }

  return context.response(msg.id, MessageTypes.SPACE_CREATE_FROM_TEMPLATE, result);
}

export async function handleSpaceSaveTemplate(
  context: IdentityTemplateHandlerContext,
  client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.spaceTemplateService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Space template service unavailable");
  }
  if (!client.publicKey) {
    return context.errorResponse(msg.id, "UNAUTHENTICATED", "Authenticated principal key is required");
  }

  const payload = msg.payload as SpaceSaveTemplatePayload;
  if (!payload?.title) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "title is required");
  }

  const result = await context.spaceTemplateService.saveTemplate({
    ...payload,
    principalId: client.publicKey,
  });
  return context.response(
    msg.id,
    MessageTypes.SPACE_SAVE_TEMPLATE,
    result as unknown as SpaceSaveTemplateResponsePayload,
  );
}

export async function handleSpaceArchiveTemplate(
  context: IdentityTemplateHandlerContext,
  client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.spaceTemplateService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Space template service unavailable");
  }
  if (!client.publicKey) {
    return context.errorResponse(msg.id, "UNAUTHENTICATED", "Authenticated principal key is required");
  }

  const payload = msg.payload as SpaceTemplateArchivePayload;
  if (!payload?.templateId) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "templateId is required");
  }

  const result = context.spaceTemplateService.archiveTemplate(payload, client.publicKey);
  return context.response(
    msg.id,
    MessageTypes.SPACE_ARCHIVE_TEMPLATE,
    result as unknown as SpaceTemplateArchiveResponsePayload,
  );
}
