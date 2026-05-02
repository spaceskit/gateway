export interface SpaceGetToolPolicyPayload {
  spaceId: string;
}

export interface SpaceGetEffectiveToolAccessPayload {
  apiVersion?: string;
  spaceId: string;
  agentId?: string;
  accessMode?: "default" | "full_access";
}

export interface EffectiveToolAccessOperationPayload {
  operationId: string;
  capability: string;
  operation: string;
  providerIds: string[];
  selectors: string[];
  allowed: boolean;
  denialReasonCode?: string;
  denialReason?: string;
  requiredDangerousCapability?: string;
  escalationAllowed?: boolean;
}

export interface EffectiveDangerousCapabilityPayload {
  capabilityId: string;
  enabled: boolean;
  source: string;
}

export interface EffectiveToolAccessPayload {
  spaceId: string;
  agentId?: string;
  policyVersion: string;
  safetyProfileId?: string;
  operations: EffectiveToolAccessOperationPayload[];
  dangerousCapabilities: EffectiveDangerousCapabilityPayload[];
  generatedAt: string;
}

export interface SpaceGetEffectiveToolAccessResponsePayload {
  access: EffectiveToolAccessPayload;
}

export interface SpaceGetToolPolicyResponsePayload {
  policy: ToolAccessPolicyPayload;
}

export interface SpaceUpdateToolPolicyPayload {
  spaceId: string;
  rules?: ToolAccessRulePayload[];
  dangerousCapabilities?: DangerousCapabilityRulePayload[];
  guestAccessPreset?: "read_only" | "collaborator";
}

export interface SpaceUpdateToolPolicyResponsePayload {
  policy: ToolAccessPolicyPayload;
}

export interface GatewayGetToolPolicyPayload {
  apiVersion?: string;
}

export interface GatewayGetToolPolicyResponsePayload {
  policy: ToolAccessPolicyPayload;
}

export interface GatewayUpdateToolPolicyPayload {
  rules?: ToolAccessRulePayload[];
  dangerousCapabilities?: DangerousCapabilityRulePayload[];
}

export interface GatewayUpdateToolPolicyResponsePayload {
  policy: ToolAccessPolicyPayload;
}

export interface ToolAccessPolicyPayload {
  scopeType: string;
  scopeId: string;
  rules: ToolAccessRulePayload[];
  dangerousCapabilities: DangerousCapabilityRulePayload[];
  guestAccessPreset?: "read_only" | "collaborator";
  policyVersion: string;
  updatedBy?: string;
  updatedAt?: string;
}

export interface ToolAccessRulePayload {
  selectorKind: string;
  selectorId: string;
  state: string;
}

export interface DangerousCapabilityRulePayload {
  capabilityId: string;
  state: string;
}

export interface GatewayGetWorkspaceDefaultsPayload {
  apiVersion?: string;
}

export interface GatewayGetWorkspaceDefaultsResponsePayload {
  defaults: WorkspaceDefaultsPayload;
}

export interface GatewaySetWorkspaceDefaultsPayload {
  spaceHomeRoot?: string;
}

export interface GatewaySetWorkspaceDefaultsResponsePayload {
  defaults: WorkspaceDefaultsPayload;
}

export interface WorkspaceDefaultsPayload {
  spaceHomeRoot: string;
  updatedAt: string;
}

export interface GatewayGetExternalConnectivityPayload {
  apiVersion?: string;
}

export interface GatewayGetExternalConnectivityResponsePayload {
  settings: ExternalConnectivitySettingsPayload;
  status: ExternalConnectivityStatusPayload;
}

export interface GatewaySetExternalConnectivityPayload {
  mode: string;
  funnelEnabled?: boolean | null;
}

export interface GatewaySetExternalConnectivityResponsePayload {
  settings: ExternalConnectivitySettingsPayload;
  status: ExternalConnectivityStatusPayload;
}

export interface ExternalConnectivitySettingsPayload {
  mode: string;
  funnelEnabled?: boolean | null;
  updatedAt: string;
}

export interface ExternalConnectivityFunnelStatusPayload {
  state: string;
  funnelConfigured: boolean;
  funnelUrl?: string;
  exposedPaths: string[];
  summary?: string;
  remediation?: string;
}

export interface ExternalConnectivityStatusPayload {
  state: string;
  summary: string;
  remediation?: string;
  advertisedEndpoints: Array<{
    provider: string;
    label: string;
    host: string;
    port: number;
    websocketUrl: string;
    healthUrl: string;
  }>;
  funnelStatus?: ExternalConnectivityFunnelStatusPayload;
}
