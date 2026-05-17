import {
  MessageTypes,
  type GatewayMessage,
  type SpaceCreateFromTemplatePayload,
  type SpaceCreateFromTemplateResponsePayload,
  type SpacePreviewTemplatePayload,
  type SpacePreviewTemplateResponsePayload,
  type SpaceSaveTemplatePayload,
  type SpaceSaveTemplateResponsePayload,
  type SpaceSummary,
  type SpaceTemplateArchivePayload,
  type SpaceTemplateArchiveResponsePayload,
  type SpaceTemplateGetPayload,
  type SpaceTemplateGetResponsePayload,
  type SpaceTemplateListPayload,
  type SpaceTemplateListResponsePayload,
} from "../protocol.js";
import type { ClientSession } from "../gateway-server.js";
import type { IdentityTemplateHandlerContext } from "./identity-template-handlers.js";

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
