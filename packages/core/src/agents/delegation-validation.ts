export interface DelegationRequest {
  targetAgentId: string;
  task: string;
  context?: string;
  delegatingAgentId: string;
  delegatingSpaceId: string;
  lineageId: string;
  hopCount: number;
}

export interface DelegationValidationResult {
  allowed: boolean;
  rejection?: string;
  gate?: "loop_guard";
  gateDescription?: string;
}

export function validateDelegation(
  request: DelegationRequest,
  maxHops: number,
): DelegationValidationResult {
  if (request.targetAgentId === request.delegatingAgentId) {
    return { allowed: false, rejection: "Delegation rejected: agent cannot delegate to itself" };
  }
  if (request.hopCount >= maxHops) {
    return {
      allowed: false,
      gate: "loop_guard",
      gateDescription: `Agent delegation chain reached maximum hop count (${maxHops}). Lineage: ${request.lineageId}. Approve to allow one more hop, or reject to stop.`,
    };
  }
  return { allowed: true };
}
