import { randomUUID } from "node:crypto";
import type { ErrorPayload } from "../protocol.js";
import {
  MessageTypes,
  type GatewayGetConciergeAgentPayload,
  type GatewayGetConciergeAgentResponsePayload,
  type GatewayGetMainAgentPayload,
  type GatewayGetMainAgentResponsePayload,
  type GatewayListAvailableModelsPayload,
  type GatewayListAvailableModelsResponsePayload,
  type GatewayListProviderCatalogsPayload,
  type GatewayListProviderCatalogsResponsePayload,
  type GatewayListProviderConfigsResponsePayload,
  type GatewayMessage,
  type GatewaySetConciergeAgentPayload,
  type GatewaySetConciergeAgentResponsePayload,
  type GatewaySetMainAgentPayload,
  type GatewaySetMainAgentResponsePayload,
  type SpaceAgentUpdatedEventPayload,
} from "../protocol.js";
import type { ClientSession } from "../gateway-server.js";
import type { GatewayAdminService } from "../message-router-gateway-services.js";
import type { SpaceQuotaService } from "../message-router-space-services.js";
import { normalizeString } from "../message-router-utils.js";

export interface GatewayAgentHandlerContext {
  gatewayAdminService: GatewayAdminService | null;
  spaceQuotaService: SpaceQuotaService | null;
  agentSessionReplacementEnabled: boolean;
  resolveSessionResetPrincipal: (client: ClientSession) => string;
  resolveSpaceUid: (spaceIdRaw: string) => Promise<string>;
  response: (correlationId: string, type: string, payload?: unknown) => GatewayMessage;
  errorResponse: (
    correlationId: string,
    code: ErrorPayload["code"],
    message: string,
    errDetails?: unknown,
  ) => GatewayMessage;
  broadcastToSpace: (spaceUid: string, msg: GatewayMessage) => void;
  spaceManager: { invalidateCache: (spaceId: string) => void };
}

export async function handleGatewayDiscoverLocalAgents(
  context: GatewayAgentHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.gatewayAdminService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Gateway admin service unavailable");
  }

  const agents = await context.gatewayAdminService.discoverLocalAgents();
  return context.response(msg.id, MessageTypes.GATEWAY_DISCOVER_LOCAL_AGENTS, {
    agents,
  });
}

export async function handleGatewayListProviderConfigs(
  context: GatewayAgentHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.gatewayAdminService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Gateway admin service unavailable");
  }

  const configs = context.gatewayAdminService.listProviderConfigs();
  return context.response(msg.id, MessageTypes.GATEWAY_LIST_PROVIDER_CONFIGS, {
    configs,
  } satisfies GatewayListProviderConfigsResponsePayload);
}

export async function handleGatewayGetMainAgent(
  context: GatewayAgentHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.gatewayAdminService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Gateway admin service unavailable");
  }

  const payload = (msg.payload ?? {}) as GatewayGetMainAgentPayload;
  const state = await context.gatewayAdminService.getMainAgent({
    apiVersion: normalizeString(payload.apiVersion),
    spaceId: normalizeString(payload.spaceId),
    repairIfMissing: payload.repairIfMissing === undefined ? undefined : payload.repairIfMissing === true,
  });
  if (state.repaired || state.fallbackApplied) {
    context.spaceManager.invalidateCache(state.spaceId);
  }
  return context.response(msg.id, MessageTypes.GATEWAY_GET_MAIN_AGENT, {
    state,
  } satisfies GatewayGetMainAgentResponsePayload);
}

export async function handleGatewayGetConciergeAgent(
  context: GatewayAgentHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.gatewayAdminService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Gateway admin service unavailable");
  }

  const payload = (msg.payload ?? {}) as GatewayGetConciergeAgentPayload;
  const state = await context.gatewayAdminService.getConciergeAgent({
    apiVersion: normalizeString(payload.apiVersion),
    spaceId: normalizeString(payload.spaceId),
    repairIfMissing: payload.repairIfMissing === undefined ? undefined : payload.repairIfMissing === true,
  });
  if (state.repaired || state.fallbackApplied) {
    context.spaceManager.invalidateCache(state.spaceId);
  }
  return context.response(msg.id, MessageTypes.GATEWAY_GET_CONCIERGE_AGENT, {
    state,
  } satisfies GatewayGetConciergeAgentResponsePayload);
}

export async function handleGatewaySetMainAgent(
  context: GatewayAgentHandlerContext,
  client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.gatewayAdminService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Gateway admin service unavailable");
  }

  const payload = (msg.payload ?? {}) as GatewaySetMainAgentPayload;
  const selectionMode = normalizeString(payload.selectionMode);
  if (selectionMode !== "provider_model" && selectionMode !== "agent_definition") {
    return context.errorResponse(
      msg.id,
      "INVALID_ARGUMENT",
      "selectionMode must be either provider_model or agent_definition",
    );
  }

  if (selectionMode === "provider_model") {
    if (!normalizeString(payload.providerId) || !normalizeString(payload.modelId)) {
      return context.errorResponse(
        msg.id,
        "INVALID_ARGUMENT",
        "providerId and modelId are required for provider_model selection",
      );
    }
  } else if (!normalizeString(payload.sourceAgentDefinitionId)) {
    return context.errorResponse(
      msg.id,
      "INVALID_ARGUMENT",
      "sourceAgentDefinitionId is required for agent_definition selection",
    );
  }

  const normalizedSpaceId = normalizeString(payload.spaceId);
  let previousState: GatewayGetMainAgentResponsePayload["state"] | null = null;
  if (context.agentSessionReplacementEnabled) {
    try {
      previousState = await context.gatewayAdminService.getMainAgent({
        apiVersion: normalizeString(payload.apiVersion),
        spaceId: normalizedSpaceId,
        repairIfMissing: false,
      });
    } catch {
      // Best-effort.
    }
  }

  const state = await context.gatewayAdminService.setMainAgent({
    apiVersion: normalizeString(payload.apiVersion),
    spaceId: normalizedSpaceId,
    selectionMode,
    providerId: normalizeString(payload.providerId),
    modelId: normalizeString(payload.modelId),
    sourceAgentDefinitionId: normalizeString(payload.sourceAgentDefinitionId),
    applyPersonaInstructions: payload.applyPersonaInstructions === undefined
      ? true
      : payload.applyPersonaInstructions === true,
  });
  context.spaceManager.invalidateCache(state.spaceId);

  if (context.agentSessionReplacementEnabled) {
    if (context.spaceQuotaService) {
      try {
        const resetPrincipalId = context.resolveSessionResetPrincipal(client);
        context.spaceQuotaService.resetAgentUsageSession(
          state.spaceId,
          state.mainAgentId,
          resetPrincipalId,
        );
      } catch {
        // Non-fatal.
      }
    }

    const spaceUid = normalizeString(state.spaceUid) ?? await context.resolveSpaceUid(state.spaceId);
    context.broadcastToSpace(spaceUid, {
      type: MessageTypes.SPACE_AGENT_UPDATED,
      id: randomUUID(),
      ts: new Date().toISOString(),
      payload: {
        spaceId: state.spaceId,
        spaceUid,
        agentId: state.mainAgentId,
        oldProfileId: previousState?.mainProfileId ?? state.mainProfileId,
        newProfileId: state.mainProfileId,
        updatedAt: new Date().toISOString(),
      } satisfies SpaceAgentUpdatedEventPayload,
    });
  }

  return context.response(msg.id, MessageTypes.GATEWAY_SET_MAIN_AGENT, {
    state,
  } satisfies GatewaySetMainAgentResponsePayload);
}

export async function handleGatewaySetConciergeAgent(
  context: GatewayAgentHandlerContext,
  client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.gatewayAdminService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Gateway admin service unavailable");
  }

  const payload = (msg.payload ?? {}) as GatewaySetConciergeAgentPayload;
  const selectionMode = normalizeString(payload.selectionMode);
  if (selectionMode !== "provider_model" && selectionMode !== "agent_definition") {
    return context.errorResponse(
      msg.id,
      "INVALID_ARGUMENT",
      "selectionMode must be either provider_model or agent_definition",
    );
  }

  if (selectionMode === "provider_model") {
    if (!normalizeString(payload.providerId) || !normalizeString(payload.modelId)) {
      return context.errorResponse(
        msg.id,
        "INVALID_ARGUMENT",
        "providerId and modelId are required for provider_model selection",
      );
    }
  } else if (!normalizeString(payload.sourceAgentDefinitionId)) {
    return context.errorResponse(
      msg.id,
      "INVALID_ARGUMENT",
      "sourceAgentDefinitionId is required for agent_definition selection",
    );
  }

  const normalizedSpaceId = normalizeString(payload.spaceId);
  let previousState: GatewayGetConciergeAgentResponsePayload["state"] | null = null;
  if (context.agentSessionReplacementEnabled) {
    try {
      previousState = await context.gatewayAdminService.getConciergeAgent({
        apiVersion: normalizeString(payload.apiVersion),
        spaceId: normalizedSpaceId,
        repairIfMissing: false,
      });
    } catch {
      // Best-effort.
    }
  }

  const state = await context.gatewayAdminService.setConciergeAgent({
    apiVersion: normalizeString(payload.apiVersion),
    spaceId: normalizedSpaceId,
    selectionMode,
    providerId: normalizeString(payload.providerId),
    modelId: normalizeString(payload.modelId),
    sourceAgentDefinitionId: normalizeString(payload.sourceAgentDefinitionId),
    applyPersonaInstructions: payload.applyPersonaInstructions === undefined
      ? true
      : payload.applyPersonaInstructions === true,
  });
  context.spaceManager.invalidateCache(state.spaceId);

  if (context.agentSessionReplacementEnabled) {
    if (context.spaceQuotaService) {
      try {
        const resetPrincipalId = context.resolveSessionResetPrincipal(client);
        context.spaceQuotaService.resetAgentUsageSession(
          state.spaceId,
          state.conciergeAgentId,
          resetPrincipalId,
        );
      } catch {
        // Non-fatal.
      }
    }

    const spaceUid = normalizeString(state.spaceUid) ?? await context.resolveSpaceUid(state.spaceId);
    context.broadcastToSpace(spaceUid, {
      type: MessageTypes.SPACE_AGENT_UPDATED,
      id: randomUUID(),
      ts: new Date().toISOString(),
      payload: {
        spaceId: state.spaceId,
        spaceUid,
        agentId: state.conciergeAgentId,
        oldProfileId: previousState?.conciergeProfileId ?? state.conciergeProfileId,
        newProfileId: state.conciergeProfileId,
        updatedAt: new Date().toISOString(),
      } satisfies SpaceAgentUpdatedEventPayload,
    });
  }

  return context.response(msg.id, MessageTypes.GATEWAY_SET_CONCIERGE_AGENT, {
    state,
  } satisfies GatewaySetConciergeAgentResponsePayload);
}

export async function handleGatewayListAvailableModels(
  context: GatewayAgentHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.gatewayAdminService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Gateway admin service unavailable");
  }

  const payload = msg.payload as GatewayListAvailableModelsPayload;
  const providers = await context.gatewayAdminService.listAvailableModels({
    providerId: normalizeString(payload?.providerId),
    refresh: payload?.refresh === true,
  });
  return context.response(msg.id, MessageTypes.GATEWAY_LIST_AVAILABLE_MODELS, {
    providers,
    generatedAt: new Date().toISOString(),
  } satisfies GatewayListAvailableModelsResponsePayload);
}

export async function handleGatewayListProviderCatalogs(
  context: GatewayAgentHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.gatewayAdminService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Gateway admin service unavailable");
  }

  const payload = msg.payload as GatewayListProviderCatalogsPayload;
  const providers = await context.gatewayAdminService.listProviderCatalogs({
    providerId: normalizeString(payload?.providerId),
    refresh: payload?.refresh === true,
  });
  return context.response(msg.id, MessageTypes.GATEWAY_LIST_PROVIDER_CATALOGS, {
    providers,
    generatedAt: new Date().toISOString(),
  } satisfies GatewayListProviderCatalogsResponsePayload);
}
