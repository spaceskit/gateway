import type {
  DangerousCapabilityId,
  DangerousCapabilityRule,
  GuestAccessPreset,
  SafetyProfileId,
  ToolAccessPolicy,
  ToolAccessPolicyScopeType,
  ToolAccessRule,
  ToolAccessRuleSelectorKind,
} from "@spaceskit/core";
import type {
  SpaceShareAccessMode,
  ToolAccessPolicyRepository,
} from "@spaceskit/persistence";

export const DANGEROUS_CAPABILITIES: DangerousCapabilityId[] = [
  "managed_shell",
  "arbitrary_shell",
  "approval_bypass",
  "filesystem_escape",
];

export function rowToPolicy(
  scopeType: ToolAccessPolicyScopeType,
  scopeId: string,
  row: ReturnType<ToolAccessPolicyRepository["get"]>,
): ToolAccessPolicy {
  if (!row) {
    return emptyPolicy(scopeType, scopeId);
  }
  return normalizePolicy({
    scopeType,
    scopeId,
    rules: parseRules(row.rules_json),
    dangerousCapabilities: parseDangerousCapabilities(row.dangerous_capabilities_json),
    guestAccessPreset: scopeType === "space"
      ? normalizeGuestAccessPreset(row.guest_access_preset) ?? "collaborator"
      : undefined,
    policyVersion: row.policy_version,
    updatedBy: row.updated_by,
    updatedAt: row.updated_at,
  });
}

export function emptyPolicy(scopeType: ToolAccessPolicyScopeType, scopeId: string): ToolAccessPolicy {
  return {
    scopeType,
    scopeId,
    rules: [],
    dangerousCapabilities: [],
    guestAccessPreset: scopeType === "space" ? "collaborator" : undefined,
    policyVersion: "tool_access_policy_v1",
  };
}

export function normalizePolicy(policy: ToolAccessPolicy): ToolAccessPolicy {
  return {
    ...policy,
    rules: normalizeRules(policy.rules),
    dangerousCapabilities: normalizeDangerousCapabilities(policy.dangerousCapabilities),
    guestAccessPreset: policy.scopeType === "space"
      ? normalizeGuestAccessPreset(policy.guestAccessPreset) ?? "collaborator"
      : undefined,
  };
}

export function parseRules(raw: string): ToolAccessRule[] {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return normalizeRules(parsed as ToolAccessRule[]);
  } catch {
    return [];
  }
}

export function parseDangerousCapabilities(raw: string): DangerousCapabilityRule[] {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return normalizeDangerousCapabilities(parsed as DangerousCapabilityRule[]);
  } catch {
    return [];
  }
}

export function normalizeRules(input: ToolAccessRule[]): ToolAccessRule[] {
  const deduped = new Map<string, ToolAccessRule>();
  for (const rule of input) {
    if (!rule || !isSelectorKind(rule.selectorKind)) continue;
    const selectorId = normalizeOptional(rule.selectorId);
    if (!selectorId) continue;
    const state = normalizeRuleState(rule.state);
    deduped.set(`${rule.selectorKind}:${selectorId}`, {
      selectorKind: rule.selectorKind,
      selectorId,
      state,
    });
  }
  return Array.from(deduped.values()).sort((left, right) => (
    left.selectorKind.localeCompare(right.selectorKind)
    || left.selectorId.localeCompare(right.selectorId)
  ));
}

export function normalizeDangerousCapabilities(input: DangerousCapabilityRule[]): DangerousCapabilityRule[] {
  const deduped = new Map<string, DangerousCapabilityRule>();
  for (const rule of input) {
    if (!rule || !DANGEROUS_CAPABILITIES.includes(rule.capabilityId)) continue;
    deduped.set(rule.capabilityId, {
      capabilityId: rule.capabilityId,
      state: normalizeRuleState(rule.state),
    });
  }
  return Array.from(deduped.values()).sort((left, right) => left.capabilityId.localeCompare(right.capabilityId));
}

function normalizeRuleState(value: string | undefined): DangerousCapabilityRule["state"] {
  return value === "enabled" || value === "inherit" ? value : "disabled";
}

export function normalizeRequired(value: unknown, field: string): string {
  const normalized = normalizeOptional(value);
  if (!normalized) {
    throw new Error(`${field} is required`);
  }
  return normalized;
}

export function normalizeOptional(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return normalized ? normalized : undefined;
}

export function normalizeGuestAccessPreset(value: unknown): GuestAccessPreset | undefined {
  return value === "read_only" || value === "collaborator"
    ? value
    : undefined;
}

export function normalizeSafetyProfileId(value: unknown): SafetyProfileId | undefined {
  return value === "safe" || value === "workspace" || value === "operator" || value === "yolo"
    ? value
    : undefined;
}

export function normalizeSpaceShareAccessMode(value: unknown): SpaceShareAccessMode | undefined {
  return value === "read_only" || value === "collaborator"
    ? value
    : undefined;
}

function isSelectorKind(value: unknown): value is ToolAccessRuleSelectorKind {
  return value === "capability"
    || value === "cli_bundle"
    || value === "connector_family"
    || value === "connector_instance"
    || value === "mcp_server"
    || value === "tool_operation";
}

export function findDangerousRule(
  rules: DangerousCapabilityRule[],
  capabilityId: DangerousCapabilityId,
): DangerousCapabilityRule | undefined {
  return rules.find((rule) => rule.capabilityId === capabilityId);
}

export function capabilitySupportsFullAccess(capabilityId: DangerousCapabilityId): boolean {
  return capabilityId === "managed_shell"
    || capabilityId === "arbitrary_shell"
    || capabilityId === "filesystem_escape"
    || capabilityId === "approval_bypass";
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function connectorPolicyIsActive(disabledUntil: string | null): boolean {
  if (!disabledUntil) {
    return true;
  }
  const until = Date.parse(disabledUntil);
  return Number.isNaN(until) || until > Date.now();
}

export function capitalize(value: string): string {
  return value ? value[0]!.toUpperCase() + value.slice(1) : value;
}
