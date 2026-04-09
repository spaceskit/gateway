import type { ErrorPayload } from "../protocol.js";
import {
  MessageTypes,
  type GatewayGetExternalConnectivityResponsePayload,
  type GatewayGetToolPolicyResponsePayload,
  type GatewayGetWorkspaceDefaultsResponsePayload,
  type GatewayMessage,
  type GatewaySetExternalConnectivityPayload,
  type GatewaySetExternalConnectivityResponsePayload,
  type GatewaySetWorkspaceDefaultsPayload,
  type GatewaySetWorkspaceDefaultsResponsePayload,
  type SpaceGetEffectiveToolAccessPayload,
  type SpaceGetEffectiveToolAccessResponsePayload,
  type GatewayUpdateToolPolicyPayload,
  type GatewayUpdateToolPolicyResponsePayload,
  type SpaceGetEffectiveToolsPayload,
  type SpaceGetEffectiveToolsResponsePayload,
  type SpaceGetToolPolicyPayload,
  type SpaceGetToolPolicyResponsePayload,
  type SpaceResetAgentUsageSessionPayload,
  type SpaceResetAgentUsageSessionResponsePayload,
  type SpaceResetPayload,
  type SpaceResetResponsePayload,
  type SpaceUpdateToolPolicyPayload,
  type SpaceUpdateToolPolicyResponsePayload,
} from "../protocol.js";
import type { ClientSession } from "../gateway-server.js";
import type {
  GatewayExternalConnectivityService,
  GatewayResetService,
  GatewayWorkspaceDefaultsService,
  SpaceQuotaService,
  SpaceToolPolicyService,
  ToolAccessPolicyService,
} from "../message-router.js";
import { normalizeString } from "../message-router-utils.js";

export interface PolicyHandlerContext {
  gatewayResetService: GatewayResetService | null;
  spaceQuotaService: SpaceQuotaService | null;
  spaceToolPolicyService: SpaceToolPolicyService | null;
  toolAccessPolicyService: ToolAccessPolicyService | null;
  gatewayWorkspaceDefaultsService: GatewayWorkspaceDefaultsService | null;
  gatewayExternalConnectivityService: GatewayExternalConnectivityService | null;
  resolveExecutionOrigin: (
    spaceId: string,
    principalIdRaw?: string,
  ) => "owner" | "guest" | "unknown";
  response: (correlationId: string, type: string, payload?: unknown) => GatewayMessage;
  errorResponse: (
    correlationId: string,
    code: ErrorPayload["code"],
    message: string,
    errDetails?: unknown,
  ) => GatewayMessage;
}

export async function handleSpaceReset(
  context: PolicyHandlerContext,
  client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.gatewayResetService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Gateway reset service unavailable");
  }
  if (!client.publicKey) {
    return context.errorResponse(msg.id, "UNAUTHENTICATED", "Authenticated principal key is required");
  }

  const payload = msg.payload as SpaceResetPayload;
  const spaceId = normalizeString(payload?.spaceId);
  if (!spaceId) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "spaceId is required");
  }

  const result = await context.gatewayResetService.resetSpace({
    apiVersion: normalizeString(payload.apiVersion),
    spaceId,
    requestedBy: client.publicKey,
    requestedDeviceId: normalizeString(client.deviceId),
  });

  return context.response(msg.id, MessageTypes.SPACE_RESET, result satisfies SpaceResetResponsePayload);
}

export async function handleSpaceResetAgentUsageSession(
  context: PolicyHandlerContext,
  client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.spaceQuotaService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Space quota service unavailable");
  }
  if (!client.publicKey) {
    return context.errorResponse(msg.id, "UNAUTHENTICATED", "Authenticated principal key is required");
  }

  const payload = msg.payload as SpaceResetAgentUsageSessionPayload;
  if (!payload?.spaceId || !payload?.agentId) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "spaceId and agentId are required");
  }

  const result = context.spaceQuotaService.resetAgentUsageSession(
    payload.spaceId,
    payload.agentId,
    client.publicKey,
  );
  return context.response(
    msg.id,
    MessageTypes.SPACE_RESET_AGENT_USAGE_SESSION,
    result satisfies SpaceResetAgentUsageSessionResponsePayload,
  );
}

export async function handleSpaceGetEffectiveTools(
  context: PolicyHandlerContext,
  client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.toolAccessPolicyService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Tool access policy service unavailable");
  }

  const payload = msg.payload as SpaceGetEffectiveToolsPayload;
  if (!payload?.spaceId) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "spaceId is required");
  }

  const access = await context.toolAccessPolicyService.getEffectiveToolAccess({
    spaceId: payload.spaceId,
    principalId: client.publicKey ?? undefined,
    deviceId: client.deviceId ?? undefined,
    executionOrigin: context.resolveExecutionOrigin(payload.spaceId, client.publicKey),
    agentId: payload.agentId,
    accessMode: payload.accessMode,
  });

  return context.response(msg.id, MessageTypes.SPACE_GET_EFFECTIVE_TOOLS, {
    matrix: legacyEffectiveToolMatrixFromAccess(access),
  } satisfies SpaceGetEffectiveToolsResponsePayload);
}

export async function handleSpaceGetEffectiveToolAccess(
  context: PolicyHandlerContext,
  client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.toolAccessPolicyService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Tool access policy service unavailable");
  }

  const payload = msg.payload as SpaceGetEffectiveToolAccessPayload;
  if (!payload?.spaceId) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "spaceId is required");
  }

  const access = await context.toolAccessPolicyService.getEffectiveToolAccess({
    spaceId: payload.spaceId,
    principalId: client.publicKey ?? undefined,
    deviceId: client.deviceId ?? undefined,
    executionOrigin: context.resolveExecutionOrigin(payload.spaceId, client.publicKey),
    agentId: payload.agentId,
    accessMode: payload.accessMode,
  });

  return context.response(msg.id, MessageTypes.SPACE_GET_EFFECTIVE_TOOL_ACCESS, {
    access,
  } satisfies SpaceGetEffectiveToolAccessResponsePayload);
}

export async function handleSpaceGetToolPolicy(
  context: PolicyHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.toolAccessPolicyService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Tool access policy service unavailable");
  }

  const payload = msg.payload as SpaceGetToolPolicyPayload;
  if (!payload?.spaceId) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "spaceId is required");
  }

  const policy = context.toolAccessPolicyService.getToolPolicy({
    scopeType: "space",
    scopeId: payload.spaceId,
  });
  return context.response(msg.id, MessageTypes.SPACE_GET_TOOL_POLICY, {
    policy,
  } satisfies SpaceGetToolPolicyResponsePayload);
}

export async function handleSpaceUpdateToolPolicy(
  context: PolicyHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.toolAccessPolicyService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Tool access policy service unavailable");
  }

  const payload = msg.payload as SpaceUpdateToolPolicyPayload;
  if (!payload?.spaceId) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "spaceId is required");
  }

  const policy = context.toolAccessPolicyService.updateToolPolicy({
    scopeType: "space",
    scopeId: payload.spaceId,
    rules: payload.rules,
    dangerousCapabilities: payload.dangerousCapabilities,
    guestAccessPreset: payload.guestAccessPreset,
  });
  return context.response(msg.id, MessageTypes.SPACE_UPDATE_TOOL_POLICY, {
    policy,
  } satisfies SpaceUpdateToolPolicyResponsePayload);
}

export async function handleGatewayGetToolPolicy(
  context: PolicyHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.toolAccessPolicyService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Tool access policy service unavailable");
  }

  const policy = context.toolAccessPolicyService.getToolPolicy({
    scopeType: "gateway",
    scopeId: "gateway",
  });
  return context.response(msg.id, MessageTypes.GATEWAY_GET_TOOL_POLICY, {
    policy,
  } satisfies GatewayGetToolPolicyResponsePayload);
}

export async function handleGatewayUpdateToolPolicy(
  context: PolicyHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.toolAccessPolicyService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Tool access policy service unavailable");
  }

  const payload = (msg.payload ?? {}) as GatewayUpdateToolPolicyPayload;
  const policy = context.toolAccessPolicyService.updateToolPolicy({
    scopeType: "gateway",
    scopeId: "gateway",
    rules: payload.rules,
    dangerousCapabilities: payload.dangerousCapabilities,
  });
  return context.response(msg.id, MessageTypes.GATEWAY_UPDATE_TOOL_POLICY, {
    policy,
  } satisfies GatewayUpdateToolPolicyResponsePayload);
}

export async function handleGatewayGetWorkspaceDefaults(
  context: PolicyHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.gatewayWorkspaceDefaultsService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Workspace defaults service unavailable");
  }

  const row = context.gatewayWorkspaceDefaultsService.get();
  return context.response(msg.id, MessageTypes.GATEWAY_GET_WORKSPACE_DEFAULTS, {
    defaults: {
      spaceHomeRoot: row.space_home_root,
      updatedAt: row.updated_at,
    },
  } satisfies GatewayGetWorkspaceDefaultsResponsePayload);
}

export async function handleGatewaySetWorkspaceDefaults(
  context: PolicyHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.gatewayWorkspaceDefaultsService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Workspace defaults service unavailable");
  }

  const payload = (msg.payload ?? {}) as GatewaySetWorkspaceDefaultsPayload;
  const row = context.gatewayWorkspaceDefaultsService.set({
    spaceHomeRoot: payload.spaceHomeRoot ?? "",
  });
  return context.response(msg.id, MessageTypes.GATEWAY_SET_WORKSPACE_DEFAULTS, {
    defaults: {
      spaceHomeRoot: row.space_home_root,
      updatedAt: row.updated_at,
    },
  } satisfies GatewaySetWorkspaceDefaultsResponsePayload);
}

function legacyEffectiveToolMatrixFromAccess(access: {
  spaceId: string;
  agentId?: string;
  policyVersion: string;
  generatedAt: string;
  operations: Array<{
    operationId: string;
    capability: string;
    operation: string;
    providerIds: string[];
    allowed: boolean;
    denialReasonCode?: string;
    denialReason?: string;
    escalationAllowed?: boolean;
  }>;
}) {
  return {
    spaceId: access.spaceId,
    agentId: access.agentId,
    policyVersion: access.policyVersion,
    generatedAt: access.generatedAt,
    operations: access.operations.map((operation) => ({
      operationId: operation.operationId,
      capability: operation.capability,
      operation: operation.operation,
      providerIds: operation.providerIds,
      allowed: operation.allowed,
      denyReasons: operation.allowed
        ? []
        : [{
          code: operation.denialReasonCode ?? (
            operation.escalationAllowed ? "policy_escalation_required" : "access_denied"
          ),
          message: operation.denialReason ?? (
            operation.escalationAllowed
              ? "This operation requires approval before it can continue."
              : "This operation is blocked by the unified tool access policy."
          ),
        }],
    })),
  };
}

export async function handleGatewayGetExternalConnectivity(
  context: PolicyHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.gatewayExternalConnectivityService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "External connectivity service unavailable");
  }

  const snapshot = await context.gatewayExternalConnectivityService.getSnapshot();
  return context.response(msg.id, MessageTypes.GATEWAY_GET_EXTERNAL_CONNECTIVITY, {
    settings: snapshot.settings,
    status: snapshot.status,
  } satisfies GatewayGetExternalConnectivityResponsePayload);
}

export async function handleGatewaySetExternalConnectivity(
  context: PolicyHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!context.gatewayExternalConnectivityService) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "External connectivity service unavailable");
  }

  const payload = (msg.payload ?? {}) as GatewaySetExternalConnectivityPayload;
  if (!payload.mode) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "mode is required");
  }

  const snapshot = await context.gatewayExternalConnectivityService.setMode(payload.mode);
  return context.response(msg.id, MessageTypes.GATEWAY_SET_EXTERNAL_CONNECTIVITY, {
    settings: snapshot.settings,
    status: snapshot.status,
  } satisfies GatewaySetExternalConnectivityResponsePayload);
}
