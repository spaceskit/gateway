export type GatewayCoreProfileId = "embedded" | "external";

export type CapabilityLevel = "none" | "read" | "write" | "execute";

export type CapabilityDecision = "allow" | "prompt" | "deny";

export interface GatewayCapabilityDefinition {
  id: string;
  description: string;
}

export interface GatewayCoreProfile {
  id: GatewayCoreProfileId;
  name: string;
  description: string;
  appStoreCompatible: boolean;
  sandboxRequired: boolean;
  allowsDynamicExecutableCode: boolean;
  allowsMultiGateway: boolean;
  hardBlockedCapabilities: string[];
}

export interface GatewayCapabilityState {
  capabilityId: string;
  level: CapabilityLevel;
  source: "default" | "grant";
  reason: string;
  grantedBy?: string;
  grantedAt?: string;
  expiresAt?: string;
}

export interface GatewayCoreState {
  profile: GatewayCoreProfile;
  defaultAction: "deny";
  capabilities: Record<string, GatewayCapabilityState>;
}

export interface CreateGatewayCoreStateInput {
  profileId?: GatewayCoreProfileId;
  capabilityCatalog?: GatewayCapabilityDefinition[];
  initialGrants?: CapabilityGrantInput[];
}

export interface CapabilityGrantInput {
  capabilityId: string;
  level: Exclude<CapabilityLevel, "none">;
  grantedBy?: string;
  reason?: string;
  grantedAt?: Date;
  expiresAt?: Date;
}

export interface CapabilityRequest {
  capabilityId: string;
  level: Exclude<CapabilityLevel, "none">;
}

export interface CapabilityRequestDecision {
  capabilityId: string;
  requestedLevel: Exclude<CapabilityLevel, "none">;
  currentLevel: CapabilityLevel;
  decision: CapabilityDecision;
  reason: string;
}
