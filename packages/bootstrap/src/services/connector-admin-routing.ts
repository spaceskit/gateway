import type { ConnectorBindingRow } from "@spaceskit/persistence";
import type { ConnectorAction } from "@spaceskit/core";
import {
  ConnectorAdminError,
  VALID_ACTIONS,
  normalizeAction,
  normalizeRequired,
  safeParseObject,
  safeParseStringArray,
  selectorMatchScore,
} from "./connector-admin-normalizers.js";
import type {
  ConnectorAdminServiceOptions,
  ConnectorPolicyRecord,
  EnforceOutboundInput,
  EnforceOutboundResult,
  ResolveInboundRouteInput,
  ResolveInboundRouteResult,
} from "./connector-admin-service-types.js";

interface ConnectorRoutingContext {
  options: ConnectorAdminServiceOptions;
  enforceConnectorEnabled(familyId: string, connectorId: string): EnforceOutboundResult;
  resolveEffectivePolicy(familyId: string, connectorId: string): ConnectorPolicyRecord;
  consumeRateToken(key: string, requestsPerMinute: number, burst: number): boolean;
  recordAudit(eventType: string, actor: string, payload: Record<string, unknown>): void;
}

export function resolveConnectorInboundRoute(
  context: ConnectorRoutingContext,
  input: ResolveInboundRouteInput,
): ResolveInboundRouteResult {
  const connectorId = normalizeRequired(input.connectorId, "connectorId");
  const connector = context.options.instanceRepo.get(connectorId);
  if (!connector) {
    throw new ConnectorAdminError("NOT_FOUND", `Connector not found: ${connectorId}`);
  }

  const allowed = context.enforceConnectorEnabled(connector.family_id, connectorId);
  if (!allowed.allowed) {
    throw new ConnectorAdminError("PERMISSION_DENIED", allowed.reason ?? "Connector disabled by policy");
  }

  const selector = input.selector ?? {};
  const bindings = context.options.bindingRepo.listByConnector(connectorId)
    .filter((row) => row.binding_type === "inbound_route" && row.enabled === 1)
    .sort((lhs, rhs) => lhs.priority - rhs.priority);

  let best: { row: ConnectorBindingRow; score: number } | null = null;
  for (const row of bindings) {
    const bindingSelector = safeParseObject(row.selector_json);
    const score = selectorMatchScore(selector, bindingSelector);
    if (score < 0) continue;
    if (!best || score > best.score || (score === best.score && row.priority < best.row.priority)) {
      best = { row, score };
    }
  }

  if (best) {
    return {
      route: "binding",
      targetType: best.row.target_type,
      targetSpaceId: best.row.target_space_id || undefined,
      bindingId: best.row.binding_id,
      matchedScore: best.score,
    };
  }

  return {
    route: "main_fallback",
    targetType: "main_orchestrator",
    targetSpaceId: context.options.defaultTargetSpaceId,
  };
}

export function enforceConnectorOutbound(
  context: ConnectorRoutingContext,
  input: EnforceOutboundInput,
): EnforceOutboundResult {
  const connectorId = normalizeRequired(input.connectorId, "connectorId");
  const action = normalizeAction(input.action);

  const connector = context.options.instanceRepo.get(connectorId);
  if (!connector) {
    throw new ConnectorAdminError("NOT_FOUND", `Connector not found: ${connectorId}`);
  }

  const enabled = context.enforceConnectorEnabled(connector.family_id, connectorId);
  if (!enabled.allowed) {
    context.recordAudit("connector.outbound.denied", `connector:${connectorId}`, {
      connectorId,
      familyId: connector.family_id,
      action,
      reason: enabled.reason ?? "Connector disabled by policy",
    });
    return enabled;
  }

  const policy = context.resolveEffectivePolicy(connector.family_id, connectorId);
  if (!context.consumeRateToken(connectorId, policy.requestsPerMinute, policy.burst)) {
    context.recordAudit("connector.outbound.rate_limited", `connector:${connectorId}`, {
      connectorId,
      familyId: connector.family_id,
      action,
      requestsPerMinute: policy.requestsPerMinute,
      burst: policy.burst,
    });
    throw new ConnectorAdminError("RATE_LIMITED", `Connector rate limit exceeded: ${connectorId}`);
  }

  const selector = input.selector ?? {};
  const outboundBindings = context.options.bindingRepo.listByConnector(connectorId)
    .filter((row) => row.binding_type === "outbound_action" && row.enabled === 1)
    .sort((lhs, rhs) => lhs.priority - rhs.priority);

  for (const row of outboundBindings) {
    const bindingSelector = safeParseObject(row.selector_json);
    if (selectorMatchScore(selector, bindingSelector) < 0) {
      continue;
    }
    const actions = safeParseStringArray(row.allowed_actions_json)
      .filter((entry): entry is ConnectorAction => VALID_ACTIONS.has(entry as ConnectorAction));
    if (!actions.includes(action)) {
      continue;
    }

    context.recordAudit("connector.outbound.allowed", `connector:${connectorId}`, {
      connectorId,
      familyId: connector.family_id,
      action,
      bindingId: row.binding_id,
    });
    return {
      allowed: true,
      bindingId: row.binding_id,
    };
  }

  context.recordAudit("connector.outbound.denied", `connector:${connectorId}`, {
    connectorId,
    familyId: connector.family_id,
    action,
    reason: `Action not allowed by connector binding: ${action}`,
  });
  return {
    allowed: false,
    reason: `Action not allowed by connector binding: ${action}`,
  };
}

