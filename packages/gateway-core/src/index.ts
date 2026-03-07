export {
  DEFAULT_CAPABILITY_CATALOG,
  EMBEDDED_GATEWAY_PROFILE,
  EXTERNAL_GATEWAY_PROFILE,
  getGatewayCoreProfile,
} from "./profiles.js";
export {
  createGatewayCoreState,
  evaluateCapabilityRequest,
  grantCapability,
  revokeCapability,
  pruneExpiredCapabilityGrants,
} from "./core.js";
export { capabilityRequestFromInvocation, capabilityGrantsFromIds } from "./invocation.js";
export type {
  GatewayCoreProfileId,
  CapabilityLevel,
  CapabilityDecision,
  GatewayCapabilityDefinition,
  GatewayCoreProfile,
  GatewayCapabilityState,
  GatewayCoreState,
  CreateGatewayCoreStateInput,
  CapabilityGrantInput,
  CapabilityRequest,
  CapabilityRequestDecision,
} from "./types.js";
