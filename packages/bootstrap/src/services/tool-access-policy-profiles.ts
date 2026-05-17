import type {
  SafetyProfileDefinition,
  SafetyProfileId,
  SpaceAdminService,
  ToolAccessPolicy,
} from "@spaceskit/core";
import { DEFAULT_SAFETY_PROFILES } from "@spaceskit/core";
import type { SafetyProfileRepository } from "@spaceskit/persistence";
import {
  emptyPolicy,
  isRecord,
  normalizePolicy,
  normalizeSafetyProfileId,
  parseDangerousCapabilities,
  parseRules,
} from "./tool-access-policy-normalizers.js";

type SafetyProfileReader = Pick<SafetyProfileRepository, "list">;
type SafetyProfileWriter = Pick<SafetyProfileRepository, "upsert">;

export interface ToolAccessPolicyProfileReadDeps {
  spaceAdminService: Pick<SpaceAdminService, "getSpace">;
  safetyProfiles: SafetyProfileReader;
}

export function seedDefaultSafetyProfiles(safetyProfiles: SafetyProfileWriter): void {
  for (const profile of DEFAULT_SAFETY_PROFILES) {
    safetyProfiles.upsert({
      profileId: profile.profileId,
      displayName: profile.displayName,
      description: profile.description,
      rulesJson: JSON.stringify(profile.rules),
      dangerousCapabilitiesJson: JSON.stringify(profile.dangerousCapabilities),
      updatedAt: profile.updatedAt,
    });
  }
}

export function listSafetyProfiles(safetyProfiles: SafetyProfileReader): SafetyProfileDefinition[] {
  const rows = safetyProfiles.list();
  if (rows.length === 0) {
    return DEFAULT_SAFETY_PROFILES;
  }
  return rows.map((row) => ({
    profileId: normalizeSafetyProfileId(row.profile_id) ?? "safe",
    displayName: row.display_name,
    description: row.description,
    rules: parseRules(row.rules_json),
    dangerousCapabilities: parseDangerousCapabilities(row.dangerous_capabilities_json),
    updatedAt: row.updated_at,
  }));
}

export function resolveSafetyProfile(
  safetyProfiles: SafetyProfileReader,
  profileId: SafetyProfileId,
): SafetyProfileDefinition {
  return listSafetyProfiles(safetyProfiles).find((entry) => entry.profileId === profileId)
    ?? DEFAULT_SAFETY_PROFILES.find((entry) => entry.profileId === profileId)
    ?? DEFAULT_SAFETY_PROFILES[0]!;
}

export async function resolveAgentSafetyProfile(
  deps: ToolAccessPolicyProfileReadDeps,
  spaceId: string,
  agentId: string,
): Promise<{ profileId: SafetyProfileId; profile: SafetyProfileDefinition }> {
  const space = await deps.spaceAdminService.getSpace(spaceId);
  const assignment = space?.agents?.find((entry) => entry.agentId === agentId);
  const explicit = normalizeSafetyProfileId(assignment?.safetyProfileId);
  if (explicit) {
    return {
      profileId: explicit,
      profile: resolveSafetyProfile(deps.safetyProfiles, explicit),
    };
  }

  const isPrimary = assignment?.isPrimary === true || assignment?.agentId === "main-agent";
  const profileId: SafetyProfileId = isPrimary ? "workspace" : "safe";
  return {
    profileId,
    profile: resolveSafetyProfile(deps.safetyProfiles, profileId),
  };
}

export async function resolveAgentPolicy(
  deps: { spaceAdminService: Pick<SpaceAdminService, "getSpace"> },
  spaceId: string,
  agentId: string,
): Promise<ToolAccessPolicy> {
  const space = await deps.spaceAdminService.getSpace(spaceId);
  const assignment = space?.agents?.find((entry) => entry.agentId === agentId);
  if (assignment?.toolPolicyOverride && isRecord(assignment.toolPolicyOverride)) {
    return normalizePolicy({
      scopeType: "agent_override",
      scopeId: `${spaceId}:${agentId}`,
      rules: parseRules(JSON.stringify(assignment.toolPolicyOverride.rules ?? [])),
      dangerousCapabilities: parseDangerousCapabilities(JSON.stringify(
        assignment.toolPolicyOverride.dangerousCapabilities ?? [],
      )),
      policyVersion: assignment.toolPolicyOverride.policyVersion ?? "tool_access_policy_v1",
      updatedBy: assignment.toolPolicyOverride.updatedBy,
      updatedAt: assignment.toolPolicyOverride.updatedAt,
    });
  }

  return emptyPolicy("agent_override", `${spaceId}:${agentId}`);
}
