import type {
  ToolAccessPolicy,
  ToolAccessPolicyScopeType,
  ToolAccessRule,
} from "@spaceskit/core";
import type {
  ConnectorPolicyRepository,
  SpaceToolPolicyRepository,
  ToolAccessPolicyRepository,
} from "@spaceskit/persistence";
import type { DefaultGatewayPolicyService } from "./gateway-policy-service.js";
import {
  connectorPolicyIsActive,
  isRecord,
  normalizeRules,
  parseLegacySpaceToolEntries,
} from "./tool-access-policy-normalizers.js";

export interface LegacyPolicyMigrationDeps {
  toolPolicies: ToolAccessPolicyRepository;
  legacyGatewayPolicyService?: DefaultGatewayPolicyService | null;
  legacyConnectorPolicies?: ConnectorPolicyRepository | null;
  legacySpaceToolPolicies?: SpaceToolPolicyRepository | null;
}

export function ensureLegacyPolicyMigrated(
  deps: LegacyPolicyMigrationDeps,
  scopeType: ToolAccessPolicyScopeType,
  scopeId: string,
): void {
  if (deps.toolPolicies.get(scopeType, scopeId)) {
    return;
  }

  const legacyPolicy = scopeType === "gateway"
    ? buildLegacyGatewayPolicy(deps)
    : scopeType === "space"
      ? buildLegacySpacePolicy(deps, scopeId)
      : undefined;
  if (!legacyPolicy) {
    return;
  }

  deps.toolPolicies.upsert({
    scopeType,
    scopeId,
    rulesJson: JSON.stringify(legacyPolicy.rules),
    dangerousCapabilitiesJson: JSON.stringify(legacyPolicy.dangerousCapabilities),
    policyVersion: legacyPolicy.policyVersion,
    updatedBy: legacyPolicy.updatedBy ?? "migration",
  });
}

export function buildLegacyGatewayPolicy(deps: LegacyPolicyMigrationDeps): ToolAccessPolicy | undefined {
  const rules: ToolAccessRule[] = [];
  const legacyPolicy = deps.legacyGatewayPolicyService?.getPolicy();
  for (const capability of legacyPolicy?.allowedCapabilityTypes ?? []) {
    rules.push({ selectorKind: "capability", selectorId: capability, state: "enabled" });
  }
  for (const capability of legacyPolicy?.deniedCapabilityTypes ?? []) {
    rules.push({ selectorKind: "capability", selectorId: capability, state: "disabled" });
  }

  const globalFlags = legacyPolicy?.globalFlags ?? {};
  const integrations = isRecord(globalFlags.integrations) ? globalFlags.integrations : null;
  const appleCalendar = integrations && isRecord(integrations.appleCalendar) ? integrations.appleCalendar : null;
  if (appleCalendar?.enabled === false) {
    rules.push({ selectorKind: "connector_family", selectorId: "apple-calendar-eventkit", state: "disabled" });
  }
  const appleReminders = integrations && isRecord(integrations.appleReminders) ? integrations.appleReminders : null;
  if (appleReminders?.enabled === false) {
    rules.push({ selectorKind: "connector_family", selectorId: "apple-reminders-eventkit", state: "disabled" });
  }
  const appleMail = integrations && isRecord(integrations.appleMail) ? integrations.appleMail : null;
  if (appleMail?.enabled === false) {
    rules.push({ selectorKind: "connector_family", selectorId: "apple-mail-mailkit", state: "disabled" });
  }

  for (const row of deps.legacyConnectorPolicies?.list() ?? []) {
    if (row.disabled !== 1 || !connectorPolicyIsActive(row.disabled_until)) {
      continue;
    }
    if (row.scope_type === "family") {
      rules.push({ selectorKind: "connector_family", selectorId: row.scope_id, state: "disabled" });
    } else if (row.scope_type === "instance") {
      rules.push({ selectorKind: "connector_instance", selectorId: row.scope_id, state: "disabled" });
    }
  }

  if (rules.length === 0) {
    return undefined;
  }

  return {
    scopeType: "gateway",
    scopeId: "gateway",
    rules: normalizeRules(rules),
    dangerousCapabilities: [],
    policyVersion: "tool_access_policy_v1",
  };
}

export function buildLegacySpacePolicy(
  deps: LegacyPolicyMigrationDeps,
  spaceId: string,
): ToolAccessPolicy | undefined {
  const row = deps.legacySpaceToolPolicies?.getBySpace(spaceId);
  if (!row) {
    return undefined;
  }
  const rules = [
    ...parseLegacySpaceToolEntries(row.allowed_tools_json).map((entry) => ({ ...entry, state: "enabled" as const })),
    ...parseLegacySpaceToolEntries(row.denied_tools_json).map((entry) => ({ ...entry, state: "disabled" as const })),
  ];
  if (rules.length === 0) {
    return undefined;
  }
  return {
    scopeType: "space",
    scopeId: spaceId,
    rules: normalizeRules(rules),
    dangerousCapabilities: [],
    policyVersion: "tool_access_policy_v1",
    updatedBy: row.updated_by,
    updatedAt: row.updated_at,
  };
}
