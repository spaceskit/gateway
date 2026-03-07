/**
 * Space-level pinned decisions — agent-proposed, human-approved.
 * Pure functions — no I/O, no logging.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const MAX_PINNED_DECISIONS = 30;
export const MAX_DECISION_LENGTH = 120;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PinnedDecisionStatus = "proposed" | "approved" | "rejected";
export type PinnedDecisionAction = "propose" | "approve" | "reject";

export interface PinnedDecision {
  decisionId: string;
  spaceId: string;
  text: string;
  proposedBy: string;       // agentId
  approvedBy?: string;      // userId or agentId
  status: PinnedDecisionStatus;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface DecisionValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateDecisionText(text: string): DecisionValidationResult {
  const errors: string[] = [];

  if (!text || text.trim().length === 0) {
    errors.push("Decision text is required");
  } else if (text.trim().length > MAX_DECISION_LENGTH) {
    errors.push(`Decision text exceeds ${MAX_DECISION_LENGTH} characters (got ${text.trim().length})`);
  }

  return { valid: errors.length === 0, errors };
}

export function canAddDecision(existingCount: number): boolean {
  return existingCount < MAX_PINNED_DECISIONS;
}

// ---------------------------------------------------------------------------
// State Machine
// ---------------------------------------------------------------------------

export function transitionPinnedDecision(
  currentStatus: PinnedDecisionStatus,
  action: PinnedDecisionAction,
  actorId: string,
): { status: PinnedDecisionStatus; approvedBy?: string } {
  switch (action) {
    case "propose":
      return { status: "proposed" };  // re-propose (idempotent)
    case "approve":
      if (currentStatus === "proposed") {
        return { status: "approved", approvedBy: actorId };
      }
      return { status: currentStatus };
    case "reject":
      if (currentStatus === "proposed") {
        return { status: "rejected" };
      }
      return { status: currentStatus };
  }
}
