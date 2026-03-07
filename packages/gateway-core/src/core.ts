import { DEFAULT_CAPABILITY_CATALOG, getGatewayCoreProfile } from "./profiles.js";
import type {
  CapabilityGrantInput,
  CapabilityLevel,
  CapabilityRequest,
  CapabilityRequestDecision,
  CreateGatewayCoreStateInput,
  GatewayCapabilityDefinition,
  GatewayCapabilityState,
  GatewayCoreState,
} from "./types.js";

const CAPABILITY_LEVEL_RANK: Record<CapabilityLevel, number> = {
  none: 0,
  read: 1,
  write: 2,
  execute: 3,
};

export function createGatewayCoreState(input: CreateGatewayCoreStateInput = {}): GatewayCoreState {
  const profile = getGatewayCoreProfile(input.profileId ?? "embedded");
  const catalog = dedupeCapabilities(input.capabilityCatalog ?? DEFAULT_CAPABILITY_CATALOG);
  const hardBlocked = new Set(profile.hardBlockedCapabilities);
  const capabilities: Record<string, GatewayCapabilityState> = {};

  for (const capability of catalog) {
    const blocked = hardBlocked.has(capability.id);
    capabilities[capability.id] = {
      capabilityId: capability.id,
      level: "none",
      source: "default",
      reason: blocked
        ? `Capability blocked by profile "${profile.id}".`
        : "Default deny. Explicit user grant required.",
    };
  }

  let state: GatewayCoreState = {
    profile,
    defaultAction: "deny",
    capabilities,
  };

  for (const grant of input.initialGrants ?? []) {
    state = grantCapability(state, grant);
  }

  return state;
}

export function evaluateCapabilityRequest(
  state: GatewayCoreState,
  request: CapabilityRequest,
  now: Date = new Date(),
): CapabilityRequestDecision {
  const existing = getEffectiveCapabilityState(state, request.capabilityId, now);
  const hardBlocked = state.profile.hardBlockedCapabilities.includes(request.capabilityId);

  if (hardBlocked) {
    return {
      capabilityId: request.capabilityId,
      requestedLevel: request.level,
      currentLevel: "none",
      decision: "deny",
      reason: `Capability is blocked by profile "${state.profile.id}".`,
    };
  }

  if (CAPABILITY_LEVEL_RANK[existing.level] >= CAPABILITY_LEVEL_RANK[request.level]) {
    return {
      capabilityId: request.capabilityId,
      requestedLevel: request.level,
      currentLevel: existing.level,
      decision: "allow",
      reason: "Capability already granted.",
    };
  }

  return {
    capabilityId: request.capabilityId,
    requestedLevel: request.level,
    currentLevel: existing.level,
    decision: "prompt",
    reason: "Capability not granted yet. Ask the user for consent.",
  };
}

export function grantCapability(state: GatewayCoreState, grant: CapabilityGrantInput): GatewayCoreState {
  if (state.profile.hardBlockedCapabilities.includes(grant.capabilityId)) {
    throw new Error(`Cannot grant blocked capability "${grant.capabilityId}" in profile "${state.profile.id}".`);
  }

  const existing = state.capabilities[grant.capabilityId] ?? {
    capabilityId: grant.capabilityId,
    level: "none",
    source: "default" as const,
    reason: "Default deny. Explicit user grant required.",
  };
  const resolvedLevel = resolveHigherCapabilityLevel(existing.level, grant.level);
  const grantedAt = (grant.grantedAt ?? new Date()).toISOString();

  return {
    ...state,
    capabilities: {
      ...state.capabilities,
      [grant.capabilityId]: {
        capabilityId: grant.capabilityId,
        level: resolvedLevel,
        source: "grant",
        reason: grant.reason ?? "Granted after explicit user consent.",
        grantedBy: grant.grantedBy ?? "user",
        grantedAt,
        expiresAt: grant.expiresAt?.toISOString(),
      },
    },
  };
}

export function revokeCapability(
  state: GatewayCoreState,
  capabilityId: string,
  reason = "Revoked by user or policy update.",
): GatewayCoreState {
  if (!state.capabilities[capabilityId]) {
    return state;
  }

  return {
    ...state,
    capabilities: {
      ...state.capabilities,
      [capabilityId]: {
        capabilityId,
        level: "none",
        source: "default",
        reason,
      },
    },
  };
}

export function pruneExpiredCapabilityGrants(
  state: GatewayCoreState,
  now: Date = new Date(),
): GatewayCoreState {
  let changed = false;
  const nextCapabilities: Record<string, GatewayCapabilityState> = {};

  for (const [capabilityId, entry] of Object.entries(state.capabilities)) {
    if (entry.expiresAt && new Date(entry.expiresAt).getTime() <= now.getTime()) {
      changed = true;
      nextCapabilities[capabilityId] = {
        capabilityId,
        level: "none",
        source: "default",
        reason: "Grant expired. Explicit user re-approval required.",
      };
      continue;
    }

    nextCapabilities[capabilityId] = entry;
  }

  if (!changed) {
    return state;
  }

  return {
    ...state,
    capabilities: nextCapabilities,
  };
}

function getEffectiveCapabilityState(
  state: GatewayCoreState,
  capabilityId: string,
  now: Date,
): GatewayCapabilityState {
  const existing = state.capabilities[capabilityId];
  if (!existing) {
    return {
      capabilityId,
      level: "none",
      source: "default",
      reason: "Capability unknown to this runtime. Default deny.",
    };
  }

  if (existing.expiresAt && new Date(existing.expiresAt).getTime() <= now.getTime()) {
    return {
      capabilityId,
      level: "none",
      source: "default",
      reason: "Grant expired. Explicit user re-approval required.",
    };
  }

  return existing;
}

function dedupeCapabilities(catalog: GatewayCapabilityDefinition[]): GatewayCapabilityDefinition[] {
  const seen = new Set<string>();
  const output: GatewayCapabilityDefinition[] = [];

  for (const entry of catalog) {
    const id = entry.id.trim();
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    output.push({
      id,
      description: entry.description,
    });
  }

  return output;
}

function resolveHigherCapabilityLevel(current: CapabilityLevel, requested: CapabilityLevel): CapabilityLevel {
  return CAPABILITY_LEVEL_RANK[requested] > CAPABILITY_LEVEL_RANK[current] ? requested : current;
}
