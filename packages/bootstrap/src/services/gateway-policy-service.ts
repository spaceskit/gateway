import { GatewayPolicyRepository } from "@spaceskit/persistence";

export interface GatewayPolicy {
  allowedCapabilityTypes: string[];
  deniedCapabilityTypes: string[];
  allowedSkillIds: string[];
  deniedSkillIds: string[];
  globalFlags: Record<string, unknown>;
  updatedAt: string;
}

export interface GatewayPolicyPatch {
  apiVersion?: string;
  allowedCapabilityTypes?: string[];
  deniedCapabilityTypes?: string[];
  allowedSkillIds?: string[];
  deniedSkillIds?: string[];
  globalFlags?: Record<string, unknown>;
}

export class DefaultGatewayPolicyService {
  constructor(private readonly repo: GatewayPolicyRepository) {}

  getPolicy(): GatewayPolicy {
    return this.rowToPolicy(this.repo.get());
  }

  updatePolicy(patch: GatewayPolicyPatch): GatewayPolicy {
    const current = this.getPolicy();

    const merged = this.repo.set({
      allowedCapabilityTypes: sanitizeStringArray(
        patch.allowedCapabilityTypes ?? current.allowedCapabilityTypes,
      ),
      deniedCapabilityTypes: sanitizeStringArray(
        patch.deniedCapabilityTypes ?? current.deniedCapabilityTypes,
      ),
      allowedSkillIds: sanitizeStringArray(
        patch.allowedSkillIds ?? current.allowedSkillIds,
      ),
      deniedSkillIds: sanitizeStringArray(
        patch.deniedSkillIds ?? current.deniedSkillIds,
      ),
      globalFlags: patch.globalFlags ?? current.globalFlags,
    });

    return this.rowToPolicy(merged);
  }

  evaluateCapability(capabilityType: string): { allowed: boolean; reason?: string } {
    const policy = this.getPolicy();
    const capability = capabilityType.trim();
    if (!capability) {
      return { allowed: false, reason: "Capability type is required" };
    }

    if (policy.deniedCapabilityTypes.includes(capability)) {
      return { allowed: false, reason: `Capability denied by gateway policy: ${capability}` };
    }

    if (
      policy.allowedCapabilityTypes.length > 0
      && !policy.allowedCapabilityTypes.includes(capability)
    ) {
      return { allowed: false, reason: `Capability not allowlisted: ${capability}` };
    }

    return { allowed: true };
  }

  filterSkillIds(skillIds: string[]): string[] {
    const policy = this.getPolicy();
    const denied = new Set(policy.deniedSkillIds);
    const allowed = policy.allowedSkillIds.length > 0 ? new Set(policy.allowedSkillIds) : null;

    return sanitizeStringArray(skillIds).filter((skillId) => {
      if (denied.has(skillId)) return false;
      if (allowed && !allowed.has(skillId)) return false;
      return true;
    });
  }

  private rowToPolicy(row: ReturnType<GatewayPolicyRepository["get"]>): GatewayPolicy {
    return {
      allowedCapabilityTypes: parseStringArray(row.allowed_capability_types_json),
      deniedCapabilityTypes: parseStringArray(row.denied_capability_types_json),
      allowedSkillIds: parseStringArray(row.allowed_skill_ids_json),
      deniedSkillIds: parseStringArray(row.denied_skill_ids_json),
      globalFlags: parseObject(row.global_flags_json),
      updatedAt: row.updated_at,
    };
  }
}

function parseStringArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return sanitizeStringArray(parsed);
    }
  } catch {
    // Ignore parse failures and return empty list.
  }
  return [];
}

function parseObject(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Ignore parse failures and return empty object.
  }
  return {};
}

function sanitizeStringArray(input: unknown[]): string[] {
  return Array.from(
    new Set(
      input
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  );
}
