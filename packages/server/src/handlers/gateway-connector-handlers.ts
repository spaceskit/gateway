import type { ErrorPayload } from "../protocol.js";
import {
  MessageTypes,
  type ConnectorInboundEventResultPayload,
  type ConnectorSubmitInboundEventPayload,
  type GatewayGetConnectorPolicyPayload,
  type GatewayGetConnectorPolicyResponsePayload,
  type GatewayListConnectorBindingsPayload,
  type GatewayListConnectorBindingsResponsePayload,
  type GatewayListConnectorFamiliesResponsePayload,
  type GatewayListConnectorsPayload,
  type GatewayListConnectorsResponsePayload,
  type GatewayMessage,
  type GatewayRemoveConnectorBindingPayload,
  type GatewayRemoveConnectorBindingResponsePayload,
  type GatewayRemoveConnectorPayload,
  type GatewayRemoveConnectorResponsePayload,
  type GatewayTestConnectorPayload,
  type GatewayTestConnectorResponsePayload,
  type GatewayUpdateConnectorPolicyPayload,
  type GatewayUpdateConnectorPolicyResponsePayload,
  type GatewayUpsertConnectorBindingPayload,
  type GatewayUpsertConnectorBindingResponsePayload,
  type GatewayUpsertConnectorPayload,
  type GatewayUpsertConnectorResponsePayload,
} from "../protocol.js";
import type { ClientSession } from "../gateway-server.js";
import type { ConnectorAdminService } from "../message-router-gateway-services.js";

export interface GatewayConnectorHandlerContext {
  connectorAdminService: ConnectorAdminService | null;
  executeConnectorTurn?: (
    spaceId: string,
    input: string,
    client: ClientSession,
  ) => Promise<{ turnId: string }>;
  getGatewayGlobalFlags?: () => Record<string, unknown> | undefined;
  response: (correlationId: string, type: string, payload?: unknown) => GatewayMessage;
  errorResponse: (
    correlationId: string,
    code: ErrorPayload["code"],
    message: string,
    errDetails?: unknown,
  ) => GatewayMessage;
}

function readAppleMailIntegrationFlags(
  globalFlags: Record<string, unknown> | undefined,
): { enabled: boolean; contentBlockerRules: unknown[]; securityMode: string } {
  const integrations = globalFlags?.integrations;
  const integrationsRecord = typeof integrations === "object" && integrations !== null
    ? integrations as Record<string, unknown>
    : null;
  const appleMailRaw = integrationsRecord?.appleMail;
  const appleMail = typeof appleMailRaw === "object" && appleMailRaw !== null
    ? appleMailRaw as Record<string, unknown>
    : null;

  const enabled = typeof appleMail?.enabled === "boolean" ? appleMail.enabled : true;
  const contentBlockerRules = Array.isArray(appleMail?.contentBlockerRules)
    ? appleMail.contentBlockerRules
    : [];
  const securityMode = typeof appleMail?.securityMode === "string" && appleMail.securityMode.trim().length > 0
    ? appleMail.securityMode.trim()
    : "pass_through";

  return { enabled, contentBlockerRules, securityMode };
}

function buildInboundEventInput(payload: ConnectorSubmitInboundEventPayload): string | undefined {
  const explicit = payload.input?.trim();
  if (explicit) {
    return explicit;
  }

  const snapshot = payload.snapshot ?? {};
  const subject = typeof snapshot.subject === "string" ? snapshot.subject.trim() : "";
  const accountId = typeof payload.selector?.accountId === "string" ? payload.selector.accountId.trim() : "";
  const mailboxId = typeof payload.selector?.mailboxId === "string" ? payload.selector.mailboxId.trim() : "";
  const eventLabel = payload.eventType.trim().replace(/[_-]+/g, " ");
  const parts = [
    `Apple Mail event: ${eventLabel || "callback"}`,
    subject ? `Subject: ${subject}` : "",
    accountId ? `Account: ${accountId}` : "",
    mailboxId ? `Mailbox: ${mailboxId}` : "",
  ].filter((part) => part.length > 0);

  return parts.length > 0 ? parts.join("\n") : undefined;
}

export async function handleGatewayListConnectorFamilies(
  context: GatewayConnectorHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.connectorAdminService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Connector admin service unavailable");
  }
  const families = context.connectorAdminService.listConnectorFamilies();
  return context.response(msg.id, MessageTypes.GATEWAY_LIST_CONNECTOR_FAMILIES, {
    families,
  } satisfies GatewayListConnectorFamiliesResponsePayload);
}

export async function handleGatewayListConnectors(
  context: GatewayConnectorHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.connectorAdminService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Connector admin service unavailable");
  }
  const payload = (msg.payload ?? {}) as GatewayListConnectorsPayload;
  const connectors = context.connectorAdminService.listConnectors(payload);
  return context.response(msg.id, MessageTypes.GATEWAY_LIST_CONNECTORS, {
    connectors,
  } satisfies GatewayListConnectorsResponsePayload);
}

export async function handleGatewayUpsertConnector(
  context: GatewayConnectorHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.connectorAdminService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Connector admin service unavailable");
  }
  const payload = msg.payload as GatewayUpsertConnectorPayload;
  if (!payload?.familyId || !payload?.displayName || !payload?.accountFingerprint || !payload?.label) {
    return context.errorResponse(
      msg.id,
      "INVALID_ARGUMENT",
      "familyId, displayName, accountFingerprint, and label are required",
    );
  }

  const connector = context.connectorAdminService.upsertConnector(payload);
  return context.response(msg.id, MessageTypes.GATEWAY_UPSERT_CONNECTOR, {
    connector,
  } satisfies GatewayUpsertConnectorResponsePayload);
}

export async function handleGatewayRemoveConnector(
  context: GatewayConnectorHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.connectorAdminService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Connector admin service unavailable");
  }
  const payload = msg.payload as GatewayRemoveConnectorPayload;
  if (!payload?.connectorId) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "connectorId is required");
  }

  const result = context.connectorAdminService.removeConnector(payload.connectorId);
  return context.response(msg.id, MessageTypes.GATEWAY_REMOVE_CONNECTOR, {
    connectorId: payload.connectorId,
    removed: result.removed,
  } satisfies GatewayRemoveConnectorResponsePayload);
}

export async function handleGatewayListConnectorBindings(
  context: GatewayConnectorHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.connectorAdminService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Connector admin service unavailable");
  }
  const payload = (msg.payload ?? {}) as GatewayListConnectorBindingsPayload;
  const bindings = context.connectorAdminService.listConnectorBindings(payload);
  return context.response(msg.id, MessageTypes.GATEWAY_LIST_CONNECTOR_BINDINGS, {
    bindings,
  } satisfies GatewayListConnectorBindingsResponsePayload);
}

export async function handleGatewayUpsertConnectorBinding(
  context: GatewayConnectorHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.connectorAdminService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Connector admin service unavailable");
  }
  const payload = msg.payload as GatewayUpsertConnectorBindingPayload;
  if (!payload?.connectorId || !payload?.bindingType || !payload?.targetType) {
    return context.errorResponse(
      msg.id,
      "INVALID_ARGUMENT",
      "connectorId, bindingType, and targetType are required",
    );
  }

  const binding = context.connectorAdminService.upsertConnectorBinding(payload);
  return context.response(msg.id, MessageTypes.GATEWAY_UPSERT_CONNECTOR_BINDING, {
    binding,
  } satisfies GatewayUpsertConnectorBindingResponsePayload);
}

export async function handleGatewayRemoveConnectorBinding(
  context: GatewayConnectorHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.connectorAdminService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Connector admin service unavailable");
  }
  const payload = msg.payload as GatewayRemoveConnectorBindingPayload;
  if (!payload?.bindingId) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "bindingId is required");
  }

  const result = context.connectorAdminService.removeConnectorBinding(payload.bindingId);
  return context.response(msg.id, MessageTypes.GATEWAY_REMOVE_CONNECTOR_BINDING, {
    bindingId: payload.bindingId,
    removed: result.removed,
  } satisfies GatewayRemoveConnectorBindingResponsePayload);
}

export async function handleGatewayGetConnectorPolicy(
  context: GatewayConnectorHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.connectorAdminService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Connector admin service unavailable");
  }
  const payload = msg.payload as GatewayGetConnectorPolicyPayload;
  if (!payload?.scopeType || !payload?.scopeId) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "scopeType and scopeId are required");
  }

  const policy = context.connectorAdminService.getConnectorPolicy(payload);
  return context.response(msg.id, MessageTypes.GATEWAY_GET_CONNECTOR_POLICY, {
    policy,
  } satisfies GatewayGetConnectorPolicyResponsePayload);
}

export async function handleGatewayUpdateConnectorPolicy(
  context: GatewayConnectorHandlerContext,
  client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.connectorAdminService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Connector admin service unavailable");
  }
  const payload = msg.payload as GatewayUpdateConnectorPolicyPayload;
  if (!payload?.scopeType || !payload?.scopeId) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "scopeType and scopeId are required");
  }

  const updatedBy = payload.updatedBy ?? client.publicKey ?? "system";
  const policy = context.connectorAdminService.updateConnectorPolicy({
    ...payload,
    updatedBy,
  });
  return context.response(msg.id, MessageTypes.GATEWAY_UPDATE_CONNECTOR_POLICY, {
    policy,
  } satisfies GatewayUpdateConnectorPolicyResponsePayload);
}

export async function handleGatewayTestConnector(
  context: GatewayConnectorHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.connectorAdminService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Connector admin service unavailable");
  }
  const payload = msg.payload as GatewayTestConnectorPayload;
  if (!payload?.connectorId) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "connectorId is required");
  }

  const result = context.connectorAdminService.testConnector(payload.connectorId);
  return context.response(msg.id, MessageTypes.GATEWAY_TEST_CONNECTOR, result satisfies GatewayTestConnectorResponsePayload);
}

export async function handleConnectorSubmitInboundEvent(
  context: GatewayConnectorHandlerContext,
  client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.connectorAdminService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Connector admin service unavailable");
  }

  const payload = msg.payload as ConnectorSubmitInboundEventPayload;
  if (!payload?.connectorId || !payload?.eventType) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "connectorId and eventType are required");
  }

  const route = context.connectorAdminService.resolveInboundRoute({
    connectorId: payload.connectorId,
    selector: payload.selector ?? {},
  });

  let turnId: string | undefined;
  const generatedInput = buildInboundEventInput(payload);
  if (generatedInput && route.targetSpaceId && context.executeConnectorTurn) {
    const turn = await context.executeConnectorTurn(route.targetSpaceId, generatedInput, client);
    turnId = turn.turnId;
  }

  const appleMailFlags = readAppleMailIntegrationFlags(context.getGatewayGlobalFlags?.());
  return context.response(msg.id, MessageTypes.CONNECTOR_INBOUND_EVENT_RESULT, {
    ok: appleMailFlags.enabled,
    route,
    turnId,
    directives: {
      integrationEnabled: appleMailFlags.enabled,
      contentBlockerRules: appleMailFlags.contentBlockerRules,
      securityMode: appleMailFlags.securityMode,
      allowSend: true,
      messageAction: null,
      additionalHeaders: {},
    },
  } satisfies ConnectorInboundEventResultPayload);
}
