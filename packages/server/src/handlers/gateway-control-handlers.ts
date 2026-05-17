import type { ErrorPayload } from "../protocol.js";
import { MessageTypes, type GatewayCreateIntegrationRequestPayload, type GatewayCreateIntegrationRequestResponsePayload, type GatewayDeleteSecretRefPayload, type GatewayDeleteSecretRefResponsePayload, type GatewayFactoryResetPayload, type GatewayFactoryResetResponsePayload, type GatewayGetLocalUsageTelemetryPayload, type GatewayGetLocalUsageTelemetryResponsePayload, type GatewayGetProviderSettingsPayload, type GatewayGetProviderSettingsResponsePayload, type GatewayGetProviderTelemetryPayload, type GatewayGetProviderTelemetryResponsePayload, type GatewayGetRuntimeDefaultsPayload, type GatewayGetRuntimeDefaultsResponsePayload, type GatewayGetToolPayload, type GatewayGetToolResponsePayload, type GatewayListIntegrationRequestsPayload, type GatewayListIntegrationRequestsResponsePayload, type GatewayListInterconnectorsPayload, type GatewayListInterconnectorsResponsePayload, type GatewayListSecretRefsPayload, type GatewayListSecretRefsResponsePayload, type GatewayListToolApprovalGrantsPayload, type GatewayListToolApprovalGrantsResponsePayload, type GatewayListToolsPayload, type GatewayListToolsResponsePayload, type GatewayMessage, type GatewayProvisionLocalProfilePayload, type GatewayPutSecretRefPayload, type GatewayRegisterToolPayload, type GatewayRegisterToolResponsePayload, type GatewayRemoveProviderConfigPayload, type GatewayRemoveProviderConfigResponsePayload, type GatewayRemoveToolPayload, type GatewayRemoveToolResponsePayload, type GatewayRescanInterconnectorsPayload, type GatewayRescanInterconnectorsResponsePayload, type GatewayRevokeToolApprovalGrantPayload, type GatewayRevokeToolApprovalGrantResponsePayload, type GatewayScaffoldToolPayload, type GatewayScaffoldToolResponsePayload, type GatewaySetProviderConfigPayload, type GatewaySetProviderConfigResponsePayload, type GatewaySetRuntimeDefaultsPayload, type GatewaySetRuntimeDefaultsResponsePayload, type GatewaySetToolEnabledPayload, type GatewaySetToolEnabledResponsePayload, type GatewayUpdateProviderSettingsPayload, type GatewayUpdateProviderSettingsResponsePayload } from "../protocol.js";
import type { ClientSession } from "../gateway-server.js";
import type { GatewayAdminService, GatewayResetService } from "../message-router-gateway-services.js";
import { normalizeString } from "../message-router-utils.js";

export {
  handleGatewayDeleteSecretRef,
  handleGatewayGetLocalUsageTelemetry,
  handleGatewayGetProviderSettings,
  handleGatewayGetProviderTelemetry,
  handleGatewayListSecretRefs,
  handleGatewayProvisionLocalProfile,
  handleGatewayPutSecretRef,
  handleGatewayRemoveProviderConfig,
  handleGatewaySetProviderConfig,
  handleGatewayUpdateProviderSettings,
} from "./gateway-control-provider-handlers.js";

export interface GatewayControlHandlerContext {
  gatewayAdminService: GatewayAdminService | null;
  gatewayResetService: GatewayResetService | null;
  response: (correlationId: string, type: string, payload?: unknown) => GatewayMessage;
  errorResponse: (
    correlationId: string,
    code: ErrorPayload["code"],
    message: string,
    errDetails?: unknown,
  ) => GatewayMessage;
}

export async function handleToolList(
  context: GatewayControlHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.gatewayAdminService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Gateway admin service unavailable");
  }
  const payload = (msg.payload ?? {}) as GatewayListToolsPayload;
  const tools = context.gatewayAdminService.listTools(payload);
  return context.response(msg.id, MessageTypes.TOOL_LIST, {
    tools,
  } satisfies GatewayListToolsResponsePayload);
}

export async function handleToolGet(
  context: GatewayControlHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.gatewayAdminService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Gateway admin service unavailable");
  }
  const payload = msg.payload as GatewayGetToolPayload;
  if (!normalizeString(payload?.toolId)) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "toolId is required");
  }

  const tool = context.gatewayAdminService.getTool(payload.toolId);
  return context.response(msg.id, MessageTypes.TOOL_GET, {
    tool,
  } satisfies GatewayGetToolResponsePayload);
}

export async function handleGatewayListInterconnectors(
  context: GatewayControlHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.gatewayAdminService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Gateway admin service unavailable");
  }

  const payload = (msg.payload ?? {}) as GatewayListInterconnectorsPayload;
  const interconnectors = context.gatewayAdminService.listInterconnectors(payload);
  return context.response(msg.id, MessageTypes.GATEWAY_LIST_INTERCONNECTORS, {
    interconnectors,
    generatedAt: new Date().toISOString(),
  } satisfies GatewayListInterconnectorsResponsePayload);
}

export async function handleGatewayGetRuntimeDefaults(
  context: GatewayControlHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.gatewayAdminService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Gateway admin service unavailable");
  }

  const payload = (msg.payload ?? {}) as GatewayGetRuntimeDefaultsPayload;
  const defaults = await context.gatewayAdminService.getRuntimeDefaults(payload);
  return context.response(msg.id, MessageTypes.GATEWAY_GET_RUNTIME_DEFAULTS, {
    defaults,
  } satisfies GatewayGetRuntimeDefaultsResponsePayload);
}

export async function handleGatewaySetRuntimeDefaults(
  context: GatewayControlHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.gatewayAdminService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Gateway admin service unavailable");
  }

  const payload = (msg.payload ?? {}) as GatewaySetRuntimeDefaultsPayload;
  const updated = await context.gatewayAdminService.setRuntimeDefaults(payload);
  return context.response(
    msg.id,
    MessageTypes.GATEWAY_SET_RUNTIME_DEFAULTS,
    updated satisfies GatewaySetRuntimeDefaultsResponsePayload,
  );
}

export async function handleGatewayRescanInterconnectors(
  context: GatewayControlHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.gatewayAdminService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Gateway admin service unavailable");
  }

  const payload = (msg.payload ?? {}) as GatewayRescanInterconnectorsPayload;
  const interconnectors = await context.gatewayAdminService.rescanInterconnectors(payload);
  return context.response(msg.id, MessageTypes.GATEWAY_RESCAN_INTERCONNECTORS, {
    interconnectors,
    generatedAt: new Date().toISOString(),
  } satisfies GatewayRescanInterconnectorsResponsePayload);
}

export async function handleToolScaffold(
  context: GatewayControlHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.gatewayAdminService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Gateway admin service unavailable");
  }
  const payload = msg.payload as GatewayScaffoldToolPayload;
  if (
    !normalizeString(payload?.id)
    || !normalizeString(payload?.displayName)
    || !normalizeString(payload?.description)
    || !normalizeString(payload?.outputMode)
  ) {
    return context.errorResponse(
      msg.id,
      "INVALID_ARGUMENT",
      "id, displayName, description, and outputMode are required",
    );
  }

  const scaffolded = context.gatewayAdminService.scaffoldTool(payload);
  return context.response(msg.id, MessageTypes.TOOL_SCAFFOLD, scaffolded satisfies GatewayScaffoldToolResponsePayload);
}

export async function handleToolRegister(
  context: GatewayControlHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.gatewayAdminService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Gateway admin service unavailable");
  }
  const payload = msg.payload as GatewayRegisterToolPayload;
  if (
    !normalizeString(payload?.id)
    || !normalizeString(payload?.displayName)
    || !normalizeString(payload?.description)
    || !normalizeString(payload?.executable)
    || !Array.isArray(payload?.argsTemplate)
  ) {
    return context.errorResponse(
      msg.id,
      "INVALID_ARGUMENT",
      "id, displayName, description, executable, and argsTemplate are required",
    );
  }

  const tool = await context.gatewayAdminService.registerTool(payload);
  return context.response(msg.id, MessageTypes.TOOL_REGISTER, {
    tool,
  } satisfies GatewayRegisterToolResponsePayload);
}

export async function handleToolRemove(
  context: GatewayControlHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.gatewayAdminService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Gateway admin service unavailable");
  }
  const payload = msg.payload as GatewayRemoveToolPayload;
  if (!normalizeString(payload?.toolId)) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "toolId is required");
  }

  const result = await context.gatewayAdminService.removeTool(payload.toolId);
  return context.response(msg.id, MessageTypes.TOOL_REMOVE, result satisfies GatewayRemoveToolResponsePayload);
}

export async function handleToolSetEnabled(
  context: GatewayControlHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.gatewayAdminService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Gateway admin service unavailable");
  }
  const payload = msg.payload as GatewaySetToolEnabledPayload;
  if (!normalizeString(payload?.toolId) || typeof payload?.enabled !== "boolean") {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "toolId and enabled are required");
  }

  const result = await context.gatewayAdminService.setToolEnabled(payload);
  return context.response(msg.id, MessageTypes.TOOL_SET_ENABLED, result satisfies GatewaySetToolEnabledResponsePayload);
}

export async function handleToolListGrants(
  context: GatewayControlHandlerContext,
  client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.gatewayAdminService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Gateway admin service unavailable");
  }
  if (!client.publicKey) {
    return context.errorResponse(msg.id, "UNAUTHENTICATED", "Authenticated principal key is required");
  }

  const payload = (msg.payload ?? {}) as GatewayListToolApprovalGrantsPayload;
  const grants = context.gatewayAdminService.listToolApprovalGrants(
    payload,
    client.publicKey,
    client.deviceId ?? undefined,
  );
  return context.response(msg.id, MessageTypes.TOOL_LIST_GRANTS, {
    grants,
  } satisfies GatewayListToolApprovalGrantsResponsePayload);
}

export async function handleToolRevokeGrant(
  context: GatewayControlHandlerContext,
  client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.gatewayAdminService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Gateway admin service unavailable");
  }
  if (!client.publicKey) {
    return context.errorResponse(msg.id, "UNAUTHENTICATED", "Authenticated principal key is required");
  }

  const payload = msg.payload as GatewayRevokeToolApprovalGrantPayload;
  if (!normalizeString(payload?.spaceId) || !normalizeString(payload?.toolId)) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "spaceId and toolId are required");
  }

  const result = context.gatewayAdminService.revokeToolApprovalGrant(
    payload,
    client.publicKey,
    client.deviceId ?? undefined,
  );
  return context.response(
    msg.id,
    MessageTypes.TOOL_REVOKE_GRANT,
    result satisfies GatewayRevokeToolApprovalGrantResponsePayload,
  );
}

export async function handleGatewayCreateIntegrationRequest(
  context: GatewayControlHandlerContext,
  client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.gatewayAdminService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Gateway admin service unavailable");
  }
  const payload = msg.payload as GatewayCreateIntegrationRequestPayload;
  if (!payload?.integrationClass || !normalizeString(payload?.requestedName)) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "integrationClass and requestedName are required");
  }

  const request = context.gatewayAdminService.createIntegrationRequest(
    payload,
    client.publicKey ?? undefined,
    client.deviceId ?? undefined,
  );
  return context.response(msg.id, MessageTypes.GATEWAY_CREATE_INTEGRATION_REQUEST, {
    request,
  } satisfies GatewayCreateIntegrationRequestResponsePayload);
}

export async function handleGatewayListIntegrationRequests(
  context: GatewayControlHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.gatewayAdminService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Gateway admin service unavailable");
  }

  const payload = msg.payload as GatewayListIntegrationRequestsPayload;
  const requests = context.gatewayAdminService.listIntegrationRequests({
    integrationClass: payload?.integrationClass,
    limit: payload?.limit,
  });
  return context.response(msg.id, MessageTypes.GATEWAY_LIST_INTEGRATION_REQUESTS, {
    requests,
  } satisfies GatewayListIntegrationRequestsResponsePayload);
}

export async function handleGatewayFactoryReset(
  context: GatewayControlHandlerContext,
  client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.gatewayResetService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Gateway reset service unavailable");
  }

  const requestedBy = normalizeString(client.publicKey);
  if (!requestedBy) {
    return context.errorResponse(msg.id, "UNAUTHENTICATED", "Authenticated principal key is required");
  }

  const payload = (msg.payload ?? {}) as GatewayFactoryResetPayload;
  if (typeof payload.confirmation !== "string" || payload.confirmation.trim().length === 0) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "confirmation is required");
  }

  const result = await context.gatewayResetService.factoryResetGateway({
    apiVersion: normalizeString(payload.apiVersion),
    confirmation: payload.confirmation,
    requestedBy,
    requestedDeviceId: normalizeString(client.deviceId),
  });
  return context.response(msg.id, MessageTypes.GATEWAY_FACTORY_RESET, result satisfies GatewayFactoryResetResponsePayload);
}
