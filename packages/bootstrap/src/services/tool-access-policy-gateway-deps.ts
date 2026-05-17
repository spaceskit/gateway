import type {
  CapabilityType,
  DangerousCapabilityId,
  ToolAccessPolicy,
} from "@spaceskit/core";
import type {
  GatewayCoreProfile,
  GatewayCoreState,
} from "@spaceskit/gateway-core";
import type { GatewayCapabilityAccessService } from "./gateway-capability-access-service.js";
import type { SpaceSharingService } from "./space-sharing-service.js";
import type {
  GatewayCapabilityAccessEvaluatorDeps,
} from "./gateway-capability-access-evaluator.js";

export function createGatewayCapabilityAccessEvaluatorDeps(input: {
  gatewayProfile: GatewayCoreProfile;
  defaultGatewayCoreState: GatewayCoreState;
  gatewayCapabilityAccessService?: Pick<GatewayCapabilityAccessService, "evaluateInvocation"> | null;
  spaceSharingService?: Pick<SpaceSharingService, "evaluateAccess" | "getActiveParticipant"> | null;
  getSpacePolicy: (spaceId: string) => ToolAccessPolicy;
  requiredDangerousCapability: (
    capability: CapabilityType,
    operation: string,
  ) => DangerousCapabilityId | undefined;
  now: () => Date;
}): GatewayCapabilityAccessEvaluatorDeps {
  return {
    gatewayProfile: input.gatewayProfile,
    defaultGatewayCoreState: input.defaultGatewayCoreState,
    gatewayCapabilityAccessService: input.gatewayCapabilityAccessService ?? null,
    spaceSharingService: input.spaceSharingService ?? null,
    getSpacePolicy: input.getSpacePolicy,
    isRequiredDangerousCapability: (capability, operation) => (
      input.requiredDangerousCapability(capability, operation) != null
    ),
    now: input.now,
  };
}
