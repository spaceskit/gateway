import type {
  CapabilityExecutionOrigin,
  CapabilityProvider,
  CapabilityType,
  DangerousCapabilityId,
  EffectiveToolAccessOperation,
  ToolAccessEvaluation,
  ToolAccessPolicy,
  ToolAccessPolicyScopeType,
  TurnRequestAccessMode,
} from "@spaceskit/core";
import type { AccessGrantRepository } from "@spaceskit/persistence";
import type {
  GatewayCapabilityAccessDecision,
  GatewayCapabilityAccessEvaluatorInput,
} from "./gateway-capability-access-evaluator.js";
import type {
  DangerousCapabilityAccessEvaluationInput,
} from "./tool-access-policy-dangerous.js";
import {
  capitalize,
  normalizeOptional,
  normalizeRequired,
} from "./tool-access-policy-normalizers.js";
import type { ToolAccessCandidateOperation } from "./tool-access-policy-selectors.js";
import { findMatchingRule } from "./tool-access-policy-selectors.js";

export type ToolAccessSelectorDecision = ToolAccessEvaluation & { selectors: string[] };

export interface ToolSelectorAvailabilityInput {
  spaceId: string;
  agentId?: string;
  principalId?: string;
  deviceId?: string;
  capability: CapabilityType;
  operation: string;
  provider: CapabilityProvider;
}

export interface SelectorPolicyEvaluationDeps {
  getToolPolicy: (input: {
    scopeType: ToolAccessPolicyScopeType;
    scopeId: string;
  }) => ToolAccessPolicy;
  resolveAgentPolicy: (spaceId: string, agentId: string) => Promise<ToolAccessPolicy>;
  accessGrants: Pick<AccessGrantRepository, "listEffective">;
}

export interface ToolSelectorAvailabilityDeps extends SelectorPolicyEvaluationDeps {
  buildSelectorIds: (input: {
    capability: CapabilityType;
    operation: string;
    provider: CapabilityProvider;
  }) => string[];
}

export async function evaluateSelectorAvailability(
  deps: ToolSelectorAvailabilityDeps,
  input: ToolSelectorAvailabilityInput,
): Promise<ToolAccessSelectorDecision> {
  const selectors = deps.buildSelectorIds(input);
  return evaluateSelectorsAgainstPolicies(deps, {
    spaceId: input.spaceId,
    agentId: input.agentId,
    principalId: normalizeOptional(input.principalId),
    deviceId: normalizeOptional(input.deviceId),
    selectors,
    toolName: `${input.capability}.${input.operation}`,
  });
}

export async function evaluateSelectorsAgainstPolicies(
  deps: SelectorPolicyEvaluationDeps,
  input: {
    spaceId: string;
    agentId?: string;
    principalId?: string;
    deviceId?: string;
    selectors: string[];
    toolName: string;
  },
): Promise<ToolAccessSelectorDecision> {
  const gatewayPolicy = deps.getToolPolicy({ scopeType: "gateway", scopeId: "gateway" });
  const spacePolicy = deps.getToolPolicy({ scopeType: "space", scopeId: input.spaceId });
  const agentPolicy = input.agentId
    ? await deps.resolveAgentPolicy(input.spaceId, input.agentId)
    : {
      scopeType: "agent_override" as const,
      scopeId: `${input.spaceId}:*`,
      rules: [],
      dangerousCapabilities: [],
      policyVersion: "tool_access_policy_v1",
    };

  const policies: Array<{ scope: string; policy: ToolAccessPolicy }> = [
    { scope: "gateway", policy: gatewayPolicy },
    { scope: "space", policy: spacePolicy },
    { scope: "agent", policy: agentPolicy },
  ];

  for (const { scope, policy } of policies) {
    const matchingRule = findMatchingRule(policy.rules, input.selectors);
    if (matchingRule?.state === "disabled") {
      const targetId = `${matchingRule.selectorKind}:${matchingRule.selectorId}`;
      const grants = deps.accessGrants.listEffective({
        principalId: normalizeOptional(input.principalId),
        deviceId: normalizeOptional(input.deviceId),
        spaceId: input.spaceId,
        targetIds: [targetId, ...input.selectors],
      });
      if (grants.length > 0) {
        return { allowed: true, selectors: input.selectors };
      }
      if (scope === "space") {
        return {
          allowed: false,
          requiresApproval: true,
          reasonCode: "policy_escalation_required",
          reason: `Space policy disabled ${matchingRule.selectorKind}:${matchingRule.selectorId}`,
          approvalContext: {
            kind: "policy_escalation",
            targetKind: "tool_selector",
            targetId: `tool_operation:${input.toolName}`,
            toolName: input.toolName,
            requestedCapability: input.toolName,
            selectorKind: matchingRule.selectorKind,
            selectorId: matchingRule.selectorId,
            selectorIds: input.selectors,
            blockingScope: "space_policy",
            persistentApprovalSupported: true,
            approvalModes: ["once", "time_window", "durable"],
            defaultTtlSeconds: 900,
          },
          selectors: input.selectors,
        };
      }
      return {
        allowed: false,
        reasonCode: scope === "gateway"
          ? "gateway_disabled"
          : scope === "space"
            ? "space_disabled"
            : "agent_disabled",
        reason: `${capitalize(scope)} policy disabled ${matchingRule.selectorKind}:${matchingRule.selectorId}`,
        selectors: input.selectors,
      };
    }
  }

  return { allowed: true, selectors: input.selectors };
}

export async function resolveToolProviderVisibilityDecision(
  deps: {
    resolveProviders: (capability: CapabilityType, spaceId: string) => CapabilityProvider[];
    evaluateSelectorAvailability: (input: ToolSelectorAvailabilityInput) => Promise<ToolAccessSelectorDecision>;
  },
  input: {
    spaceId: string;
    agentId?: string;
    capability: CapabilityType;
    operation: string;
    targetProvider?: string;
  },
): Promise<{
  visibleProviderIds: string[];
  deniedProviderIds: string[];
  denyReasonCode?: string;
  denyReason?: string;
}> {
  const spaceId = normalizeRequired(input.spaceId, "spaceId");
  const providers = deps.resolveProviders(input.capability, spaceId)
    .filter((provider) => provider.operations.includes(input.operation));
  const candidates = normalizeOptional(input.targetProvider)
    ? providers.filter((provider) => provider.id === input.targetProvider)
    : providers;
  const allowedProviders: string[] = [];
  const deniedProviders: string[] = [];
  let firstReasonCode: string | undefined;
  let firstReason: string | undefined;

  for (const provider of candidates) {
    const evaluation = await deps.evaluateSelectorAvailability({
      spaceId,
      agentId: normalizeOptional(input.agentId),
      capability: input.capability,
      operation: input.operation,
      provider,
    });
    if (evaluation.allowed) {
      allowedProviders.push(provider.id);
    } else {
      deniedProviders.push(provider.id);
      firstReasonCode ??= evaluation.reasonCode;
      firstReason ??= evaluation.reason;
    }
  }

  return {
    visibleProviderIds: allowedProviders,
    deniedProviderIds: deniedProviders,
    denyReasonCode: allowedProviders.length === 0 ? firstReasonCode : undefined,
    denyReason: allowedProviders.length === 0 ? firstReason : undefined,
  };
}

export async function buildEffectiveToolAccessOperation(
  deps: {
    evaluateSelectorAvailability: (input: ToolSelectorAvailabilityInput) => Promise<ToolAccessSelectorDecision>;
    resolveGatewayCapabilityAccess: (input: GatewayCapabilityAccessEvaluatorInput) => GatewayCapabilityAccessDecision;
    requiredDangerousCapability: (capability: CapabilityType, operation: string) => DangerousCapabilityId | undefined;
    isManagedCliTool: (capability: CapabilityType, operation: string) => boolean;
    evaluateDangerousCapability: (input: DangerousCapabilityAccessEvaluationInput) => Promise<ToolAccessEvaluation>;
  },
  input: {
    spaceId: string;
    agentId?: string;
    principalId?: string;
    deviceId?: string;
    executionOrigin?: CapabilityExecutionOrigin;
    accessMode?: TurnRequestAccessMode;
    candidate: ToolAccessCandidateOperation;
  },
): Promise<EffectiveToolAccessOperation> {
  const candidate = input.candidate;
  const selectorDecision = await deps.evaluateSelectorAvailability({
    spaceId: input.spaceId,
    agentId: input.agentId,
    principalId: normalizeOptional(input.principalId),
    deviceId: normalizeOptional(input.deviceId),
    capability: candidate.capability,
    operation: candidate.operation,
    provider: candidate.providers[0]!,
  });
  const gatewayCapabilityDecision = selectorDecision.allowed
    ? deps.resolveGatewayCapabilityAccess({
      spaceId: input.spaceId,
      principalId: normalizeOptional(input.principalId),
      deviceId: normalizeOptional(input.deviceId),
      executionOrigin: input.executionOrigin,
      accessMode: input.accessMode,
      capability: candidate.capability,
      operation: candidate.operation,
    })
    : null;
  const gatewayBlockedButApprovable = gatewayCapabilityDecision != null
    && !gatewayCapabilityDecision.allowed
    && gatewayCapabilityDecision.reasonCode === "gateway_capability_blocked"
    && deps.isManagedCliTool(candidate.capability, candidate.operation);

  const effectiveGatewayAllowed = gatewayCapabilityDecision?.allowed ?? true;
  const gatewayAllowedOrApprovable = effectiveGatewayAllowed || gatewayBlockedButApprovable;
  const requiredDangerousCapability = deps.requiredDangerousCapability(candidate.capability, candidate.operation);
  const dangerousEvaluation = selectorDecision.allowed && gatewayAllowedOrApprovable && requiredDangerousCapability
    ? await deps.evaluateDangerousCapability({
      spaceId: input.spaceId,
      agentId: input.agentId,
      principalId: normalizeOptional(input.principalId),
      executionOrigin: input.executionOrigin,
      accessMode: input.accessMode,
      dangerousCapabilityId: requiredDangerousCapability,
    })
    : null;

  const denialReasonCode = !selectorDecision.allowed
    ? selectorDecision.requiresApproval
      ? undefined
      : selectorDecision.reasonCode
    : gatewayCapabilityDecision && !gatewayCapabilityDecision.allowed && !gatewayBlockedButApprovable
      ? gatewayCapabilityDecision.reasonCode
      : dangerousEvaluation && !dangerousEvaluation.allowed && !dangerousEvaluation.requiresApproval
        ? dangerousEvaluation.reasonCode
        : undefined;
  const denialReason = !selectorDecision.allowed
    ? selectorDecision.requiresApproval
      ? undefined
      : selectorDecision.reason
    : gatewayCapabilityDecision && !gatewayCapabilityDecision.allowed && !gatewayBlockedButApprovable
      ? gatewayCapabilityDecision.reason
      : dangerousEvaluation && !dangerousEvaluation.allowed && !dangerousEvaluation.requiresApproval
        ? dangerousEvaluation.reason
        : undefined;

  return {
    operationId: candidate.operationId,
    capability: candidate.capability,
    operation: candidate.operation,
    providerIds: candidate.providerIds,
    selectors: selectorDecision.selectors,
    allowed: selectorDecision.allowed
      && gatewayAllowedOrApprovable
      && (dangerousEvaluation?.allowed ?? true),
    denialReasonCode,
    denialReason,
    requiredDangerousCapability,
    escalationAllowed: selectorDecision.requiresApproval
      || gatewayBlockedButApprovable
      || (dangerousEvaluation?.requiresApproval ?? false),
  };
}

export async function evaluateToolOperationAccess(
  deps: {
    resolveProviders: (capability: CapabilityType, spaceId: string) => CapabilityProvider[];
    evaluateSelectorAvailability: (input: ToolSelectorAvailabilityInput) => Promise<ToolAccessSelectorDecision>;
    resolveGatewayCapabilityAccess: (input: GatewayCapabilityAccessEvaluatorInput) => GatewayCapabilityAccessDecision;
    requiredDangerousCapability: (capability: CapabilityType, operation: string) => DangerousCapabilityId | undefined;
    isManagedCliTool: (capability: CapabilityType, operation: string) => boolean;
    hasActiveToolApprovalGrant: (input: {
      principalId: string;
      deviceId?: string;
      spaceId: string;
      toolId: string;
    }) => boolean;
    evaluateDangerousCapability: (input: DangerousCapabilityAccessEvaluationInput) => Promise<ToolAccessEvaluation>;
  },
  input: {
    spaceId: string;
    agentId: string;
    principalId?: string;
    deviceId?: string;
    executionOrigin?: CapabilityExecutionOrigin;
    accessMode?: TurnRequestAccessMode;
    capability: CapabilityType;
    operation: string;
    targetProvider?: string;
  },
): Promise<ToolAccessEvaluation> {
  const candidateProviders = normalizeOptional(input.targetProvider)
    ? deps.resolveProviders(input.capability, input.spaceId)
      .filter((provider) => provider.id === input.targetProvider)
    : deps.resolveProviders(input.capability, input.spaceId);
  let allowedSelectors: string[] = [];
  let approvableSelectorDecision: ToolAccessSelectorDecision | null = null;
  let deniedSelectorDecision: ToolAccessSelectorDecision | null = null;

  for (const provider of candidateProviders) {
    const selectorDecision = await deps.evaluateSelectorAvailability({
      spaceId: input.spaceId,
      agentId: input.agentId,
      principalId: normalizeOptional(input.principalId),
      deviceId: normalizeOptional(input.deviceId),
      capability: input.capability,
      operation: input.operation,
      provider,
    });
    if (selectorDecision.allowed) {
      allowedSelectors = selectorDecision.selectors;
      approvableSelectorDecision = null;
      deniedSelectorDecision = null;
      break;
    }
    if (selectorDecision.requiresApproval && approvableSelectorDecision == null) {
      approvableSelectorDecision = selectorDecision;
    }
    deniedSelectorDecision ??= selectorDecision;
  }

  if (allowedSelectors.length === 0) {
    if (approvableSelectorDecision) {
      return approvableSelectorDecision;
    }
    return {
      allowed: false,
      reasonCode: deniedSelectorDecision?.reasonCode ?? "tool_unavailable",
      reason: deniedSelectorDecision?.reason ?? `No providers available for ${input.capability}.${input.operation}`,
    };
  }

  const gatewayCapabilityDecision = deps.resolveGatewayCapabilityAccess({
    spaceId: input.spaceId,
    principalId: normalizeOptional(input.principalId),
    deviceId: normalizeOptional(input.deviceId),
    executionOrigin: input.executionOrigin,
    accessMode: input.accessMode,
    capability: input.capability,
    operation: input.operation,
  });
  if (!gatewayCapabilityDecision.allowed) {
    if (
      gatewayCapabilityDecision.reasonCode === "gateway_capability_blocked" &&
      deps.isManagedCliTool(input.capability, input.operation)
    ) {
      const toolName = `${input.capability}.${input.operation}`;
      const hasGrant = deps.hasActiveToolApprovalGrant({
        principalId: input.principalId ?? "*",
        deviceId: input.deviceId,
        spaceId: input.spaceId,
        toolId: toolName,
      });

      if (!hasGrant) {
        return {
          allowed: false,
          requiresApproval: true,
          reasonCode: "policy_escalation_required",
          reason: `${toolName} requires approval to run on this gateway profile.`,
          approvalContext: {
            kind: "policy_escalation",
            targetKind: "tool_operation",
            targetId: `tool_operation:${toolName}`,
            toolName: input.operation,
            requestedCapability: input.capability,
            blockingScope: "gateway_profile",
            persistentApprovalSupported: true,
            approvalModes: ["once", "time_window", "durable"],
            defaultTtlSeconds: 3600,
          },
        };
      }
    } else {
      return {
        allowed: false,
        reasonCode: gatewayCapabilityDecision.reasonCode,
        reason: gatewayCapabilityDecision.reason,
      };
    }
  }

  const requiredDangerousCapability = deps.requiredDangerousCapability(input.capability, input.operation);
  if (!requiredDangerousCapability) {
    return { allowed: true };
  }
  return await deps.evaluateDangerousCapability({
    spaceId: input.spaceId,
    agentId: input.agentId,
    principalId: normalizeOptional(input.principalId),
    executionOrigin: input.executionOrigin,
    accessMode: input.accessMode,
    dangerousCapabilityId: requiredDangerousCapability,
    toolName: `${input.capability}.${input.operation}`,
  });
}
