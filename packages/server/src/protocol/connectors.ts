export type ConnectorKindPayload = "channel" | "capability" | "hybrid";
export type ConnectorRuntimePayload = "adapter" | "connector" | "builtin";
export type ConnectorTrustClassPayload = "embedded_safe" | "external_only";
export type ConnectorInstanceStatusPayload = "active" | "paused" | "error";
export type ConnectorBindingTypePayload = "inbound_route" | "outbound_action" | "capability_export";
export type ConnectorBindingTargetPayload = "main_orchestrator" | "space_orchestrator";
export type ConnectorActionPayload = "notify" | "send_message" | "send_media" | "send_reaction";

export interface ConnectorSubmitInboundEventPayload {
  apiVersion?: string;
  connectorId: string;
  eventType: string;
  selector?: Record<string, unknown>;
  snapshot?: Record<string, unknown>;
  input?: string;
}

export interface ConnectorInboundEventResultPayload {
  ok: boolean;
  route: {
    route: "binding" | "main_fallback";
    targetType: ConnectorBindingTargetPayload;
    targetSpaceId?: string;
    bindingId?: string;
    matchedScore?: number;
  };
  turnId?: string;
  directives: Record<string, unknown>;
}

export interface GatewayListConnectorFamiliesPayload {
  apiVersion?: string;
}

export interface GatewayConnectorFamilyPayload {
  familyId: string;
  displayName: string;
  kind: ConnectorKindPayload;
  runtime: ConnectorRuntimePayload;
  trustClass: ConnectorTrustClassPayload;
  embeddedEnabled: boolean;
  capabilityTypes: string[];
  features: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface GatewayListConnectorFamiliesResponsePayload {
  families: GatewayConnectorFamilyPayload[];
}

export interface GatewayListConnectorsPayload {
  apiVersion?: string;
  familyId?: string;
}

export interface GatewayConnectorSecretRefPayload {
  key: string;
  ref: string;
  backend?: string;
}

export interface GatewayUpsertConnectorPayload {
  apiVersion?: string;
  connectorId?: string;
  familyId: string;
  displayName: string;
  accountFingerprint: string;
  label: string;
  status?: ConnectorInstanceStatusPayload;
  metadata?: Record<string, unknown>;
  secretRefs?: GatewayConnectorSecretRefPayload[];
}

export interface GatewayConnectorPayload {
  connectorId: string;
  familyId: string;
  displayName: string;
  accountFingerprintHash: string;
  labelSlug: string;
  status: ConnectorInstanceStatusPayload;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface GatewayListConnectorsResponsePayload {
  connectors: GatewayConnectorPayload[];
}

export interface GatewayUpsertConnectorResponsePayload {
  connector: GatewayConnectorPayload;
}

export interface GatewayRemoveConnectorPayload {
  apiVersion?: string;
  connectorId: string;
}

export interface GatewayRemoveConnectorResponsePayload {
  connectorId: string;
  removed: boolean;
}

export interface GatewayListConnectorBindingsPayload {
  apiVersion?: string;
  connectorId?: string;
}

export interface GatewayUpsertConnectorBindingPayload {
  apiVersion?: string;
  bindingId?: string;
  connectorId: string;
  bindingType: ConnectorBindingTypePayload;
  selector?: Record<string, unknown>;
  targetType: ConnectorBindingTargetPayload;
  targetSpaceId?: string;
  allowedActions?: ConnectorActionPayload[];
  capabilityTypes?: string[];
  priority?: number;
  enabled?: boolean;
}

export interface GatewayConnectorBindingPayload {
  bindingId: string;
  connectorId: string;
  bindingType: ConnectorBindingTypePayload;
  selector: Record<string, unknown>;
  targetType: ConnectorBindingTargetPayload;
  targetSpaceId?: string;
  allowedActions: ConnectorActionPayload[];
  capabilityTypes: string[];
  priority: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface GatewayListConnectorBindingsResponsePayload {
  bindings: GatewayConnectorBindingPayload[];
}

export interface GatewayUpsertConnectorBindingResponsePayload {
  binding: GatewayConnectorBindingPayload;
}

export interface GatewayRemoveConnectorBindingPayload {
  apiVersion?: string;
  bindingId: string;
}

export interface GatewayRemoveConnectorBindingResponsePayload {
  bindingId: string;
  removed: boolean;
}

export interface GatewayConnectorPolicyPayload {
  scopeType: "global" | "family" | "instance";
  scopeId: string;
  requestsPerMinute: number;
  burst: number;
  disabled: boolean;
  disableReason?: string;
  disabledUntil?: string;
  updatedBy: string;
  updatedAt: string;
}

export interface GatewayGetConnectorPolicyPayload {
  apiVersion?: string;
  scopeType: "global" | "family" | "instance";
  scopeId: string;
}

export interface GatewayGetConnectorPolicyResponsePayload {
  policy: GatewayConnectorPolicyPayload;
}

export interface GatewayUpdateConnectorPolicyPayload {
  apiVersion?: string;
  scopeType: "global" | "family" | "instance";
  scopeId: string;
  requestsPerMinute?: number;
  burst?: number;
  disabled?: boolean;
  disableReason?: string;
  disabledUntil?: string;
  updatedBy: string;
}

export interface GatewayUpdateConnectorPolicyResponsePayload {
  policy: GatewayConnectorPolicyPayload;
}

export interface GatewayTestConnectorPayload {
  apiVersion?: string;
  connectorId: string;
}

export interface GatewayTestConnectorResponsePayload {
  ok: boolean;
  reason?: string;
  connector?: GatewayConnectorPayload;
  inboundRoute?: {
    route: "binding" | "main_fallback";
    targetType: ConnectorBindingTargetPayload;
    targetSpaceId?: string;
    bindingId?: string;
    matchedScore?: number;
  };
  policy?: GatewayConnectorPolicyPayload;
}
