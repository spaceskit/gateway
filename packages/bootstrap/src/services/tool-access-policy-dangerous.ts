import type {
  CapabilityExecutionOrigin,
  DangerousCapabilityId,
  EffectiveDangerousCapability,
  SafetyProfileDefinition,
  SafetyProfileId,
  ToolAccessEvaluation,
  ToolAccessPolicy,
  TurnRequestAccessMode,
} from "@spaceskit/core";
import type { SpaceSharingService } from "./space-sharing-service.js";
import {
  resolveEffectiveAccessMode,
  resolveExecutionOrigin,
} from "./gateway-capability-access-evaluator.js";
import {
  capabilitySupportsFullAccess,
  findDangerousRule,
} from "./tool-access-policy-normalizers.js";

type PolicyGetter = (input: {
  scopeType: "gateway" | "space";
  scopeId: string;
}) => ToolAccessPolicy;

export interface DangerousCapabilityPolicyDeps {
  spaceSharingService?: Pick<SpaceSharingService, "evaluateAccess" | "getActiveParticipant"> | null;
  getToolPolicy: PolicyGetter;
  resolveAgentSafetyProfile: (
    spaceId: string,
    agentId: string,
  ) => Promise<{ profileId: SafetyProfileId; profile: SafetyProfileDefinition }>;
  resolveAgentPolicy: (spaceId: string, agentId: string) => Promise<ToolAccessPolicy>;
  resolveSafetyProfile: (profileId: SafetyProfileId) => SafetyProfileDefinition;
}

export interface DangerousCapabilityAccessEvaluationInput {
  spaceId: string;
  agentId?: string;
  principalId?: string;
  executionOrigin?: CapabilityExecutionOrigin;
  accessMode?: TurnRequestAccessMode;
  dangerousCapabilityId: DangerousCapabilityId;
  toolName?: string;
}

export async function evaluateDangerousCapability(
  deps: DangerousCapabilityPolicyDeps,
  input: DangerousCapabilityAccessEvaluationInput,
): Promise<ToolAccessEvaluation> {
  const resolved = await resolveDangerousCapabilityState(deps, {
    spaceId: input.spaceId,
    agentId: input.agentId,
    capabilityId: input.dangerousCapabilityId,
    principalId: input.principalId,
    accessMode: input.accessMode,
    executionOrigin: input.executionOrigin,
  });
  if (resolved.enabled) {
    return { allowed: true };
  }

  return {
    allowed: false,
    reasonCode: "dangerous_access_requires_owner_full_access",
    reason: input.toolName
      ? `${input.toolName} requires owner full access`
      : `Dangerous capability ${input.dangerousCapabilityId} requires owner full access`,
  };
}

export async function describeDangerousCapability(
  deps: DangerousCapabilityPolicyDeps,
  input: {
    spaceId: string;
    agentId?: string;
    capabilityId: DangerousCapabilityId;
    principalId?: string;
    accessMode?: TurnRequestAccessMode;
    executionOrigin?: CapabilityExecutionOrigin;
  },
): Promise<EffectiveDangerousCapability> {
  const resolved = await resolveDangerousCapabilityState(deps, {
    ...input,
    agentId: input.agentId,
  });
  return {
    capabilityId: input.capabilityId,
    enabled: resolved.enabled,
    source: resolved.source,
  };
}

export async function resolveDangerousCapabilityState(
  deps: DangerousCapabilityPolicyDeps,
  input: {
    spaceId: string;
    agentId: string | undefined;
    capabilityId: DangerousCapabilityId;
    principalId?: string;
    accessMode?: TurnRequestAccessMode;
    executionOrigin?: CapabilityExecutionOrigin;
  },
): Promise<{ enabled: boolean; source: EffectiveDangerousCapability["source"] }> {
  const resolvedExecutionOrigin = resolveExecutionOrigin(
    { spaceSharingService: deps.spaceSharingService ?? null },
    input.spaceId,
    input.principalId,
    input.executionOrigin,
  );
  const effectiveAccessMode = resolveEffectiveAccessMode(resolvedExecutionOrigin, input.accessMode);
  if (resolvedExecutionOrigin !== "owner" || effectiveAccessMode !== "full_access") {
    return { enabled: false, source: "default" };
  }

  const gatewayPolicy = deps.getToolPolicy({ scopeType: "gateway", scopeId: "gateway" });
  const gatewayRule = findDangerousRule(gatewayPolicy.dangerousCapabilities, input.capabilityId);
  if (gatewayRule?.state === "disabled") {
    return { enabled: false, source: "gateway_policy" };
  }

  const spacePolicy = deps.getToolPolicy({ scopeType: "space", scopeId: input.spaceId });
  const spaceRule = findDangerousRule(spacePolicy.dangerousCapabilities, input.capabilityId);
  if (spaceRule?.state === "disabled") {
    return { enabled: false, source: "space_policy" };
  }

  let enabled = false;
  let source: EffectiveDangerousCapability["source"] = "default";

  if (gatewayRule?.state === "enabled") {
    enabled = true;
    source = "gateway_policy";
  }
  if (spaceRule?.state === "enabled") {
    enabled = true;
    source = "space_policy";
  }

  const { profileId, profile } = input.agentId
    ? await deps.resolveAgentSafetyProfile(input.spaceId, input.agentId)
    : { profileId: "safe" as SafetyProfileId, profile: deps.resolveSafetyProfile("safe") };
  const profileRule = findDangerousRule(profile.dangerousCapabilities, input.capabilityId);
  if (!enabled && profileRule?.state === "enabled") {
    enabled = true;
    source = "profile";
  }

  if (input.agentId) {
    const overrideRule = findDangerousRule(
      (await deps.resolveAgentPolicy(input.spaceId, input.agentId)).dangerousCapabilities,
      input.capabilityId,
    );
    if (overrideRule?.state === "disabled") {
      return { enabled: false, source: "agent_override" };
    }
    if (overrideRule?.state === "enabled") {
      enabled = true;
      source = "agent_override";
    }
  }

  if (!enabled && capabilitySupportsFullAccess(input.capabilityId)) {
    return {
      enabled: true,
      source: "turn_access_mode",
    };
  }

  return {
    enabled,
    source: enabled ? source : profileId === "safe" ? "default" : "profile",
  };
}
