/**
 * Entitlement enforcement — checks tier limits before space/agent operations.
 *
 * The entitlement state lives in SQLite (managed by @spaceskit/persistence).
 * This module contains the pure logic; the repository reads are passed in.
 */

export interface EntitlementState {
  tier: "FREE" | "PRO" | "TEAM";
  maxActiveSpaces: number;
  maxAgentsPerSpace: number;
  maxSpacesPerMonth: number;
  maxMonthlyExports: number;
  activeSpacesUsed: number;
  spacesCreatedInPeriod: number;
}

export interface EntitlementCheckResult {
  allowed: boolean;
  reason?: string;
  limit?: number;
  current?: number;
}

/** Sentinel value meaning "unlimited" — matches v1 convention. */
export const UNLIMITED = -1;

function isUnlimited(value: number): boolean {
  return value === UNLIMITED;
}

export function canCreateSpace(state: EntitlementState): EntitlementCheckResult {
  if (!isUnlimited(state.maxActiveSpaces) && state.activeSpacesUsed >= state.maxActiveSpaces) {
    return {
      allowed: false,
      reason: `Active space limit reached (${state.maxActiveSpaces}). Complete or delete a space to continue.`,
      limit: state.maxActiveSpaces,
      current: state.activeSpacesUsed,
    };
  }
  if (!isUnlimited(state.maxSpacesPerMonth) && state.spacesCreatedInPeriod >= state.maxSpacesPerMonth) {
    return {
      allowed: false,
      reason: `Monthly space creation limit reached (${state.maxSpacesPerMonth}).`,
      limit: state.maxSpacesPerMonth,
      current: state.spacesCreatedInPeriod,
    };
  }
  return { allowed: true };
}

export function canAddAgent(state: EntitlementState, currentAgentCount: number): EntitlementCheckResult {
  if (!isUnlimited(state.maxAgentsPerSpace) && currentAgentCount >= state.maxAgentsPerSpace) {
    return {
      allowed: false,
      reason: `Agent limit per space reached (${state.maxAgentsPerSpace}).`,
      limit: state.maxAgentsPerSpace,
      current: currentAgentCount,
    };
  }
  return { allowed: true };
}

/** Default entitlement values per tier. */
export const TIER_DEFAULTS: Record<string, Omit<EntitlementState, "activeSpacesUsed" | "spacesCreatedInPeriod">> = {
  FREE: {
    tier: "FREE",
    maxActiveSpaces: 2,
    maxAgentsPerSpace: 4,
    maxSpacesPerMonth: 20,
    maxMonthlyExports: 10,
  },
  PRO: {
    tier: "PRO",
    maxActiveSpaces: UNLIMITED,
    maxAgentsPerSpace: UNLIMITED,
    maxSpacesPerMonth: UNLIMITED,
    maxMonthlyExports: UNLIMITED,
  },
  TEAM: {
    tier: "TEAM",
    maxActiveSpaces: UNLIMITED,
    maxAgentsPerSpace: UNLIMITED,
    maxSpacesPerMonth: UNLIMITED,
    maxMonthlyExports: UNLIMITED,
  },
};
