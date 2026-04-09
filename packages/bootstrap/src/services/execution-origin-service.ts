export type ExecutionOrigin = "owner" | "guest" | "unknown";

export interface ExecutionOriginParticipant {
  joinedViaInviteId?: string | null;
}

export interface ExecutionOriginAccessDecision {
  allowed: boolean;
  enforced: boolean;
}

export type ExecutionOriginParticipantLookup = (
  spaceId: string,
  principalId: string,
) => ExecutionOriginParticipant | null | undefined;

export type ExecutionOriginAccessLookup = (
  spaceId: string,
  principalId: string,
) => ExecutionOriginAccessDecision | null | undefined;

export function resolveExecutionOriginForPrincipal(input: {
  spaceId: string;
  principalId?: string | null;
  getActiveParticipant?: ExecutionOriginParticipantLookup | null;
  evaluateAccess?: ExecutionOriginAccessLookup | null;
}): ExecutionOrigin {
  const principalId = normalizeOptionalString(input.principalId);
  if (!principalId) {
    return "unknown";
  }

  const participant = input.getActiveParticipant?.(input.spaceId, principalId);
  if (participant?.joinedViaInviteId) {
    return "guest";
  }

  const accessDecision = input.evaluateAccess?.(input.spaceId, principalId);
  if (accessDecision?.allowed && !accessDecision.enforced) {
    return "owner";
  }

  if (participant) {
    return "owner";
  }

  return "unknown";
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}
