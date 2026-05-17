import {
  MessageTypes,
  type GatewayDeleteSecretRefPayload,
  type GatewayDeleteSecretRefResponsePayload,
  type GatewayGetLocalUsageTelemetryPayload,
  type GatewayGetLocalUsageTelemetryResponsePayload,
  type GatewayGetProviderSettingsPayload,
  type GatewayGetProviderSettingsResponsePayload,
  type GatewayGetProviderTelemetryPayload,
  type GatewayGetProviderTelemetryResponsePayload,
  type GatewayListSecretRefsPayload,
  type GatewayListSecretRefsResponsePayload,
  type GatewayMessage,
  type GatewayProvisionLocalProfilePayload,
  type GatewayPutSecretRefPayload,
  type GatewayRemoveProviderConfigPayload,
  type GatewayRemoveProviderConfigResponsePayload,
  type GatewaySetProviderConfigPayload,
  type GatewaySetProviderConfigResponsePayload,
  type GatewayUpdateProviderSettingsPayload,
  type GatewayUpdateProviderSettingsResponsePayload,
} from "../protocol.js";
import type { ClientSession } from "../gateway-server.js";
import { normalizeString } from "../message-router-utils.js";
import type { GatewayControlHandlerContext } from "./gateway-control-handlers.js";

function validateConfiguredProviderId(
  context: GatewayControlHandlerContext,
  msg: GatewayMessage,
  providerId: string | undefined,
): GatewayMessage | null {
  if (!providerId || !context.gatewayAdminService) {
    return null;
  }

  const configuredProviders = new Set(
    context.gatewayAdminService
      .listProviderConfigs()
      .map((entry) => entry.providerId.trim().toLowerCase()),
  );
  if (!configuredProviders.has(providerId)) {
    return context.errorResponse(
      msg.id,
      "INVALID_ARGUMENT",
      `providerId is not configured: ${providerId}`,
    );
  }
  return null;
}

export async function handleGatewayGetProviderTelemetry(
  context: GatewayControlHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.gatewayAdminService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Gateway admin service unavailable");
  }

  const payload = msg.payload as GatewayGetProviderTelemetryPayload;
  const providerId = normalizeString(payload?.providerId)?.toLowerCase();
  if (payload?.providerId !== undefined && !providerId) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "providerId must be a non-empty string");
  }
  const validationError = validateConfiguredProviderId(context, msg, providerId);
  if (validationError) {
    return validationError;
  }

  const telemetry = await context.gatewayAdminService.getProviderTelemetry(
    providerId ? { providerId } : undefined,
  );
  return context.response(msg.id, MessageTypes.GATEWAY_GET_PROVIDER_TELEMETRY, {
    telemetry,
    generatedAt: new Date().toISOString(),
  } satisfies GatewayGetProviderTelemetryResponsePayload);
}

export async function handleGatewayGetLocalUsageTelemetry(
  context: GatewayControlHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.gatewayAdminService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Gateway admin service unavailable");
  }

  const payload = msg.payload as GatewayGetLocalUsageTelemetryPayload;
  const providerId = normalizeString(payload?.providerId)?.toLowerCase();
  if (payload?.providerId !== undefined && !providerId) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "providerId must be a non-empty string");
  }
  const rawProviderIds = payload?.providerIds;
  if (providerId && rawProviderIds !== undefined) {
    return context.errorResponse(
      msg.id,
      "INVALID_ARGUMENT",
      "providerId and providerIds are mutually exclusive",
    );
  }
  if (rawProviderIds !== undefined && !Array.isArray(rawProviderIds)) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "providerIds must be an array of strings");
  }
  const providerIds = rawProviderIds === undefined
    ? undefined
    : Array.from(
      new Set(rawProviderIds.map((entry) => normalizeString(entry)?.toLowerCase())),
    );
  if (providerIds?.some((entry) => !entry) || (rawProviderIds !== undefined && providerIds?.length === 0)) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "providerIds must contain non-empty strings");
  }
  for (const targetProviderId of providerIds ?? [providerId]) {
    const validationError = validateConfiguredProviderId(context, msg, targetProviderId);
    if (validationError) {
      return validationError;
    }
  }

  const telemetry = await context.gatewayAdminService.getLocalUsageTelemetry(
    providerIds ? { providerIds: providerIds as string[] } : providerId ? { providerId } : undefined,
  );
  return context.response(msg.id, MessageTypes.GATEWAY_GET_LOCAL_USAGE_TELEMETRY, {
    telemetry,
    generatedAt: new Date().toISOString(),
  } satisfies GatewayGetLocalUsageTelemetryResponsePayload);
}

export async function handleGatewayGetProviderSettings(
  context: GatewayControlHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.gatewayAdminService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Gateway admin service unavailable");
  }
  const payload = msg.payload as GatewayGetProviderSettingsPayload;
  if (!payload?.providerId) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "providerId is required");
  }

  const settings = context.gatewayAdminService.getProviderSettings(payload.providerId);
  return context.response(msg.id, MessageTypes.GATEWAY_GET_PROVIDER_SETTINGS, {
    settings,
  } satisfies GatewayGetProviderSettingsResponsePayload);
}

export async function handleGatewayUpdateProviderSettings(
  context: GatewayControlHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.gatewayAdminService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Gateway admin service unavailable");
  }
  const payload = msg.payload as GatewayUpdateProviderSettingsPayload;
  if (!payload?.providerId) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "providerId is required");
  }

  const settings = context.gatewayAdminService.updateProviderSettings(payload);
  return context.response(msg.id, MessageTypes.GATEWAY_UPDATE_PROVIDER_SETTINGS, {
    settings,
  } satisfies GatewayUpdateProviderSettingsResponsePayload);
}

export async function handleGatewaySetProviderConfig(
  context: GatewayControlHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.gatewayAdminService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Gateway admin service unavailable");
  }
  const payload = msg.payload as GatewaySetProviderConfigPayload;
  if (!payload?.providerId) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "providerId is required");
  }

  const config = context.gatewayAdminService.setProviderConfig(payload);
  return context.response(msg.id, MessageTypes.GATEWAY_SET_PROVIDER_CONFIG, {
    config,
  } satisfies GatewaySetProviderConfigResponsePayload);
}

export async function handleGatewayRemoveProviderConfig(
  context: GatewayControlHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.gatewayAdminService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Gateway admin service unavailable");
  }
  const payload = msg.payload as GatewayRemoveProviderConfigPayload;
  if (!payload?.providerId) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "providerId is required");
  }

  context.gatewayAdminService.removeProviderConfig(payload.providerId);
  return context.response(msg.id, MessageTypes.GATEWAY_REMOVE_PROVIDER_CONFIG, {
    providerId: payload.providerId,
  } satisfies GatewayRemoveProviderConfigResponsePayload);
}

export async function handleGatewayProvisionLocalProfile(
  context: GatewayControlHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.gatewayAdminService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Gateway admin service unavailable");
  }
  const payload = msg.payload as GatewayProvisionLocalProfilePayload;
  if (!payload?.localClientId) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "localClientId is required");
  }

  const result = await context.gatewayAdminService.provisionLocalProfile(payload);
  return context.response(msg.id, MessageTypes.GATEWAY_PROVISION_LOCAL_PROFILE, result);
}

export async function handleGatewayPutSecretRef(
  context: GatewayControlHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.gatewayAdminService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Gateway admin service unavailable");
  }
  const payload = msg.payload as GatewayPutSecretRefPayload;
  if (!payload?.providerId || !payload?.secret) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "providerId and secret are required");
  }

  const result = context.gatewayAdminService.putSecretRef(payload);
  return context.response(msg.id, MessageTypes.GATEWAY_PUT_SECRET_REF, result);
}

export async function handleGatewayListSecretRefs(
  context: GatewayControlHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.gatewayAdminService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Gateway admin service unavailable");
  }
  const payload = (msg.payload ?? {}) as GatewayListSecretRefsPayload;
  const secretRefs = context.gatewayAdminService.listSecretRefs(normalizeString(payload.providerId));
  return context.response(msg.id, MessageTypes.GATEWAY_LIST_SECRET_REFS, {
    secretRefs,
  } satisfies GatewayListSecretRefsResponsePayload);
}

export async function handleGatewayDeleteSecretRef(
  context: GatewayControlHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.gatewayAdminService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Gateway admin service unavailable");
  }
  const payload = msg.payload as GatewayDeleteSecretRefPayload;
  if (!payload?.secretRef) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "secretRef is required");
  }

  const deleted = context.gatewayAdminService.deleteSecretRef(payload.secretRef);
  return context.response(msg.id, MessageTypes.GATEWAY_DELETE_SECRET_REF, {
    secretRef: payload.secretRef,
    deleted,
  } satisfies GatewayDeleteSecretRefResponsePayload);
}
