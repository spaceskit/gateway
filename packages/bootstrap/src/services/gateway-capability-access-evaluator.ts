import type {
  CapabilityExecutionOrigin,
  CapabilityType,
  GuestAccessPreset,
  ToolAccessPolicy,
  TurnRequestAccessMode,
} from "@spaceskit/core";
import {
  capabilityRequestFromInvocation,
  evaluateCapabilityRequest,
  type CapabilityRequestDecision,
  type GatewayCoreProfile,
  type GatewayCoreState,
} from "@spaceskit/gateway-core";
import type { SpaceShareAccessMode } from "@spaceskit/persistence";
import { resolveExecutionOriginForPrincipal } from "./execution-origin-service.js";
import type { GatewayCapabilityAccessService } from "./gateway-capability-access-service.js";
import type { SpaceSharingService } from "./space-sharing-service.js";
import { normalizeGuestAccessPreset, normalizeOptional, normalizeSpaceShareAccessMode } from "./tool-access-policy-normalizers.js";

const UNSAFE_REGULAR_GATEWAY_CAPABILITIES = new Set([
  "shell.execute",
  "mcp.execute",
  "gateway.multi",
  "model.custom",
  "plugin.dynamic-load",
]);

export interface GatewayCapabilityAccessDecision {
  allowed: boolean;
  reasonCode?: string;
  reason?: string;
  requiredGrantId: string;
  decision: CapabilityRequestDecision["decision"];
  effectiveAccessMode: TurnRequestAccessMode;
}

export interface GatewayCapabilityAccessEvaluatorDeps {
  gatewayProfile: GatewayCoreProfile;
  defaultGatewayCoreState: GatewayCoreState;
  gatewayCapabilityAccessService?: Pick<GatewayCapabilityAccessService, "evaluateInvocation"> | null;
  spaceSharingService?: Pick<SpaceSharingService, "evaluateAccess" | "getActiveParticipant"> | null;
  getSpacePolicy: (spaceId: string) => ToolAccessPolicy;
  isRequiredDangerousCapability: (capability: CapabilityType, operation: string) => boolean;
  now: () => Date;
}

export interface GatewayCapabilityAccessEvaluatorInput {
  spaceId: string;
  principalId?: string;
  deviceId?: string;
  executionOrigin?: CapabilityExecutionOrigin;
  accessMode?: TurnRequestAccessMode;
  capability: CapabilityType;
  operation: string;
}

export function resolveGatewayCapabilityAccess(
  deps: GatewayCapabilityAccessEvaluatorDeps,
  input: GatewayCapabilityAccessEvaluatorInput,
): GatewayCapabilityAccessDecision {
  const principalId = normalizeOptional(input.principalId);
  const resolvedExecutionOrigin = resolveExecutionOrigin(
    deps,
    input.spaceId,
    principalId,
    input.executionOrigin,
  );
  const effectiveAccessMode = resolveEffectiveAccessMode(resolvedExecutionOrigin, input.accessMode);
  const request = capabilityRequestFromInvocation(input.capability, input.operation);

  if (deps.gatewayProfile.hardBlockedCapabilities.includes(request.capabilityId)) {
    return {
      allowed: false,
      reasonCode: "gateway_capability_blocked",
      reason: `Capability ${request.capabilityId} is blocked by gateway profile ${deps.gatewayProfile.id}`,
      requiredGrantId: request.capabilityId,
      decision: "deny",
      effectiveAccessMode,
    };
  }

  if (resolvedExecutionOrigin === "owner") {
    return {
      allowed: true,
      requiredGrantId: request.capabilityId,
      decision: "allow",
      effectiveAccessMode,
    };
  }

  const participantMode = resolveParticipantMode(deps, input.spaceId, principalId);
  if (resolvedExecutionOrigin === "guest" && participantMode) {
    const guestAccessPreset = resolveEffectiveGuestAccessPreset(deps, input.spaceId, participantMode);
    if (isSafeNonDangerousCapabilityRequest(deps, input.capability, input.operation, request.capabilityId)) {
      if (guestAccessPreset === "collaborator" || request.level === "read") {
        return {
          allowed: true,
          requiredGrantId: request.capabilityId,
          decision: "allow",
          effectiveAccessMode,
        };
      }
    }

    return {
      allowed: false,
      reasonCode: "guest_access_preset_denied",
      reason: guestAccessPreset === "read_only"
        ? `Guest read-only access does not allow ${input.capability}.${input.operation}`
        : `Guest access does not allow ${input.capability}.${input.operation}`,
      requiredGrantId: request.capabilityId,
      decision: "deny",
      effectiveAccessMode,
    };
  }

  const explicitGrantDecision = deps.gatewayCapabilityAccessService
    ? deps.gatewayCapabilityAccessService.evaluateInvocation({
      capability: input.capability,
      operation: input.operation,
      principalId,
      deviceId: normalizeOptional(input.deviceId),
    }).decision
    : evaluateCapabilityRequest(deps.defaultGatewayCoreState, request, deps.now());

  if (explicitGrantDecision.decision === "allow") {
    return {
      allowed: true,
      requiredGrantId: request.capabilityId,
      decision: explicitGrantDecision.decision,
      effectiveAccessMode,
    };
  }

  return {
    allowed: false,
    reasonCode: explicitGrantDecision.decision === "prompt"
      ? "gateway_capability_not_granted"
      : "gateway_capability_denied",
    reason: `${explicitGrantDecision.reason} (required grant: ${request.capabilityId})`,
    requiredGrantId: request.capabilityId,
    decision: explicitGrantDecision.decision,
    effectiveAccessMode,
  };
}

export function resolveExecutionOrigin(
  deps: Pick<GatewayCapabilityAccessEvaluatorDeps, "spaceSharingService">,
  spaceId: string,
  principalId?: string,
  executionOrigin?: CapabilityExecutionOrigin,
): CapabilityExecutionOrigin {
  if (executionOrigin) {
    return executionOrigin;
  }
  return resolveExecutionOriginForPrincipal({
    spaceId,
    principalId,
    getActiveParticipant: deps.spaceSharingService
      ? (candidateSpaceId, candidatePrincipalId) => deps.spaceSharingService!.getActiveParticipant(
        candidateSpaceId,
        candidatePrincipalId,
      )
      : null,
    evaluateAccess: deps.spaceSharingService
      ? (candidateSpaceId, candidatePrincipalId) => deps.spaceSharingService!.evaluateAccess({
        spaceId: candidateSpaceId,
        principalId: candidatePrincipalId,
        action: "read",
      })
      : null,
  });
}

export function resolveEffectiveAccessMode(
  executionOrigin: CapabilityExecutionOrigin,
  accessMode?: TurnRequestAccessMode,
): TurnRequestAccessMode {
  if (executionOrigin === "owner" && accessMode === "full_access") {
    return "full_access";
  }
  return "default";
}

function resolveParticipantMode(
  deps: Pick<GatewayCapabilityAccessEvaluatorDeps, "spaceSharingService">,
  spaceId: string,
  principalId?: string,
): SpaceShareAccessMode | undefined {
  if (!principalId) {
    return undefined;
  }
  return normalizeSpaceShareAccessMode(
    deps.spaceSharingService?.getActiveParticipant(spaceId, principalId)?.mode,
  );
}

function resolveEffectiveGuestAccessPreset(
  deps: Pick<GatewayCapabilityAccessEvaluatorDeps, "getSpacePolicy">,
  spaceId: string,
  participantMode?: SpaceShareAccessMode,
): GuestAccessPreset {
  const spacePreset = normalizeGuestAccessPreset(
    deps.getSpacePolicy(spaceId).guestAccessPreset,
  ) ?? "collaborator";
  if (participantMode === "read_only" || spacePreset === "read_only") {
    return "read_only";
  }
  return "collaborator";
}

function isSafeNonDangerousCapabilityRequest(
  deps: Pick<GatewayCapabilityAccessEvaluatorDeps, "isRequiredDangerousCapability">,
  capability: CapabilityType,
  operation: string,
  capabilityId: string,
): boolean {
  return !UNSAFE_REGULAR_GATEWAY_CAPABILITIES.has(capabilityId)
    && !deps.isRequiredDangerousCapability(capability, operation);
}
