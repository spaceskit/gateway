// Entitlements
export { canCreateSpace, canAddAgent, TIER_DEFAULTS, UNLIMITED } from "./entitlements.js";
export type { EntitlementState, EntitlementCheckResult } from "./entitlements.js";

// Budget (canonical source: @spaceskit/core/src/policy/budget.ts; re-exported for backward compat)
export { checkBudget, estimateCostUsd } from "@spaceskit/core";
export type { BudgetPolicy, BudgetState, BudgetCheckResult } from "@spaceskit/core";

// Transport policy
export { isLoopbackHost, evaluateTransportPolicy } from "./transport-policy.js";
export type {
  GatewayTransportPosture,
  TransportPolicyDenialReason,
  TransportPolicyResult,
  TransportPolicyInput,
} from "./transport-policy.js";

// Sharing identity policy
export { evaluateSharingIdentity, DEFAULT_SHARING_IDENTITY_POLICY } from "./sharing-identity-policy.js";
export type {
  SharingIdentityMode,
  SharingPolicyDenialReason,
  SharingIdentityPolicy,
  SharingIdentityAssertionInput,
  SharingIdentityEvaluationResult,
} from "./sharing-identity-policy.js";
