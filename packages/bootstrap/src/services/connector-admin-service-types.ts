import type { Logger } from "@spaceskit/observability";
import type {
  AuditEventsRepository,
  ConnectorBindingRepository,
  ConnectorFamilyRepository,
  ConnectorInstanceRepository,
  ConnectorPolicyRepository,
  ConnectorPolicyScopeType,
  ConnectorSecretRefRepository,
} from "@spaceskit/persistence";
import type { CapabilityType, ConnectorAction } from "@spaceskit/core";
import type { GatewayCoreProfileId } from "@spaceskit/gateway-core";

export type ConnectorKind = "channel" | "capability" | "hybrid";
export type ConnectorRuntime = "adapter" | "connector" | "builtin";
export type ConnectorTrustClass = "embedded_safe" | "external_only";
export type ConnectorInstanceStatus = "active" | "paused" | "error";
export type ConnectorBindingType = "inbound_route" | "outbound_action" | "capability_export";
export type ConnectorBindingTarget = "main_orchestrator" | "space_orchestrator";

export interface ConnectorFamilyRecord {
  familyId: string;
  displayName: string;
  kind: ConnectorKind;
  runtime: ConnectorRuntime;
  trustClass: ConnectorTrustClass;
  embeddedEnabled: boolean;
  capabilityTypes: CapabilityType[];
  features: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ConnectorInstanceRecord {
  connectorId: string;
  familyId: string;
  displayName: string;
  accountFingerprintHash: string;
  labelSlug: string;
  status: ConnectorInstanceStatus;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ConnectorBindingRecord {
  bindingId: string;
  connectorId: string;
  bindingType: ConnectorBindingType;
  selector: Record<string, unknown>;
  targetType: ConnectorBindingTarget;
  targetSpaceId?: string;
  allowedActions: ConnectorAction[];
  capabilityTypes: CapabilityType[];
  priority: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ConnectorPolicyRecord {
  scopeType: ConnectorPolicyScopeType;
  scopeId: string;
  requestsPerMinute: number;
  burst: number;
  disabled: boolean;
  disableReason?: string;
  disabledUntil?: string;
  updatedBy: string;
  updatedAt: string;
}

export interface ConnectorSecretRefInput {
  key: string;
  ref: string;
  backend?: string;
}

export interface UpsertConnectorInput {
  connectorId?: string;
  familyId: string;
  displayName: string;
  accountFingerprint: string;
  label: string;
  status?: ConnectorInstanceStatus;
  metadata?: Record<string, unknown>;
  secretRefs?: ConnectorSecretRefInput[];
}

export interface ListConnectorsInput {
  familyId?: string;
}

export interface UpsertConnectorBindingInput {
  bindingId?: string;
  connectorId: string;
  bindingType: ConnectorBindingType;
  selector?: Record<string, unknown>;
  targetType: ConnectorBindingTarget;
  targetSpaceId?: string;
  allowedActions?: ConnectorAction[];
  capabilityTypes?: string[];
  priority?: number;
  enabled?: boolean;
}

export interface UpdateConnectorPolicyInput {
  scopeType: ConnectorPolicyScopeType;
  scopeId: string;
  requestsPerMinute?: number;
  burst?: number;
  disabled?: boolean;
  disableReason?: string;
  disabledUntil?: string;
  updatedBy: string;
}

export interface GetConnectorPolicyInput {
  scopeType: string;
  scopeId: string;
}

export interface ResolveInboundRouteInput {
  connectorId: string;
  selector?: Record<string, unknown>;
}

export interface ResolveInboundRouteResult {
  route: "binding" | "main_fallback";
  targetType: ConnectorBindingTarget;
  targetSpaceId?: string;
  bindingId?: string;
  matchedScore?: number;
}

export interface EnforceOutboundInput {
  connectorId: string;
  action: ConnectorAction;
  selector?: Record<string, unknown>;
}

export interface EnforceOutboundResult {
  allowed: boolean;
  reason?: string;
  bindingId?: string;
}

export interface ConnectorAdminServiceOptions {
  logger: Logger;
  gatewayProfile: GatewayCoreProfileId;
  auditRepo?: AuditEventsRepository | null;
  familyRepo: ConnectorFamilyRepository;
  instanceRepo: ConnectorInstanceRepository;
  bindingRepo: ConnectorBindingRepository;
  policyRepo: ConnectorPolicyRepository;
  secretRefRepo: ConnectorSecretRefRepository;
  defaultTargetSpaceId: string;
  enableWhatsappFamily?: boolean;
  enableDiscordFamily?: boolean;
}

