import type { EffectiveToolMatrixPayload } from "./protocol.js";

export interface EffectiveToolAccessSnapshot {
  spaceId: string;
  agentId?: string;
  policyVersion: string;
  generatedAt: string;
  operations: Array<{
    operationId: string;
    capability: string;
    operation: string;
    providerIds: string[];
    allowed: boolean;
    denialReasonCode?: string;
    denialReason?: string;
    escalationAllowed?: boolean;
  }>;
}

export function legacyEffectiveToolMatrixFromAccess(
  access: EffectiveToolAccessSnapshot,
): EffectiveToolMatrixPayload {
  return {
    spaceId: access.spaceId,
    agentId: access.agentId,
    policyVersion: access.policyVersion,
    generatedAt: access.generatedAt,
    operations: access.operations.map((operation) => ({
      operationId: operation.operationId,
      capability: operation.capability,
      operation: operation.operation,
      providerIds: operation.providerIds,
      allowed: operation.allowed,
      denyReasons: operation.allowed
        ? []
        : [{
          code: operation.denialReasonCode ?? (
            operation.escalationAllowed ? "policy_escalation_required" : "access_denied"
          ),
          message: operation.denialReason ?? (
            operation.escalationAllowed
              ? "This operation requires approval before it can continue."
              : "This operation is blocked by the unified tool access policy."
          ),
        }],
    })),
  };
}
