import { randomUUID } from "node:crypto";
import type {
  CapabilityProvider,
  CapabilityRegistry,
  CapabilityExecutionOrigin,
  CapabilityType,
  DangerousCapabilityId,
  DangerousCapabilityRule,
  EffectiveDangerousCapability,
  EffectiveToolAccess,
  EffectiveToolAccessOperation,
  GuestAccessPreset,
  SafetyProfileDefinition,
  SafetyProfileId,
  SpaceAdminService,
  ToolAccessEvaluation,
  ToolAccessPolicy,
  ToolAccessPolicyScopeType,
  ToolAccessRule,
  TurnRequestAccessMode,
} from "@spaceskit/core";
import { DEFAULT_SAFETY_PROFILES } from "@spaceskit/core";
import {
  capabilityRequestFromInvocation,
  createGatewayCoreState,
  evaluateCapabilityRequest,
  getGatewayCoreProfile,
  type CapabilityRequestDecision,
  type GatewayCoreProfileId,
} from "@spaceskit/gateway-core";
import type {
  AccessGrantRepository,
  AuditEventsRepository,
  ConnectorPolicyRepository,
  SafetyProfileRepository,
  SpaceShareAccessMode,
  SpaceToolPolicyRepository,
  ToolAccessPolicyRepository,
} from "@spaceskit/persistence";
import type { DefaultGatewayPolicyService } from "./gateway-policy-service.js";
import type { CliToolService } from "./cli-tool-service.js";
import type { GatewayCapabilityAccessService } from "./gateway-capability-access-service.js";
import { resolveExecutionOriginForPrincipal } from "./execution-origin-service.js";
import type { SpaceSharingService } from "./space-sharing-service.js";
import type { ToolApprovalGrantService } from "./tool-approval-grant-service.js";
import {
  DANGEROUS_CAPABILITIES,
  capabilitySupportsFullAccess,
  capitalize,
  connectorPolicyIsActive,
  emptyPolicy,
  findDangerousRule,
  isRecord,
  normalizeDangerousCapabilities,
  normalizeGuestAccessPreset,
  normalizeOptional,
  normalizePolicy,
  normalizeRequired,
  normalizeRules,
  normalizeSafetyProfileId,
  normalizeSpaceShareAccessMode,
  parseDangerousCapabilities,
  parseLegacySpaceToolEntries,
  parseRules,
  rowToPolicy,
} from "./tool-access-policy-normalizers.js";

const UNSAFE_REGULAR_GATEWAY_CAPABILITIES = new Set([
  "shell.execute",
  "mcp.execute",
  "gateway.multi",
  "model.custom",
  "plugin.dynamic-load",
]);

export interface ToolAccessPolicyServiceOptions {
  capabilities: CapabilityRegistry;
  spaceAdminService: SpaceAdminService;
  toolPolicies: ToolAccessPolicyRepository;
  safetyProfiles: SafetyProfileRepository;
  accessGrants: AccessGrantRepository;
  gatewayCapabilityAccessService?: Pick<GatewayCapabilityAccessService, "evaluateInvocation"> | null;
  gatewayProfileId?: GatewayCoreProfileId;
  legacySpaceToolPolicies?: SpaceToolPolicyRepository | null;
  legacyGatewayPolicyService?: DefaultGatewayPolicyService | null;
  legacyConnectorPolicies?: ConnectorPolicyRepository | null;
  spaceSharingService?: Pick<SpaceSharingService, "evaluateAccess" | "getActiveParticipant"> | null;
  cliToolService?: Pick<CliToolService, "getTool"> | null;
  toolApprovalGrantService?: Pick<ToolApprovalGrantService, "hasActiveGrant"> | null;
  auditRepo?: AuditEventsRepository | null;
  now?: () => Date;
}

export class ToolAccessPolicyService {
  private readonly now: () => Date;
  private readonly gatewayProfile: ReturnType<typeof getGatewayCoreProfile>;
  private readonly defaultGatewayCoreState: ReturnType<typeof createGatewayCoreState>;

  constructor(private readonly options: ToolAccessPolicyServiceOptions) {
    this.now = options.now ?? (() => new Date());
    this.gatewayProfile = getGatewayCoreProfile(options.gatewayProfileId ?? "embedded");
    this.defaultGatewayCoreState = createGatewayCoreState({
      profileId: options.gatewayProfileId ?? "embedded",
    });
    this.seedDefaultSafetyProfiles();
  }

  listSafetyProfiles(): SafetyProfileDefinition[] {
    const rows = this.options.safetyProfiles.list();
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

  getToolPolicy(input: {
    scopeType: ToolAccessPolicyScopeType;
    scopeId: string;
  }): ToolAccessPolicy {
    const scopeType = input.scopeType;
    const scopeId = normalizeRequired(input.scopeId, "scopeId");
    this.ensureLegacyPolicyMigrated(scopeType, scopeId);
    const row = this.options.toolPolicies.get(scopeType, scopeId);
    return rowToPolicy(scopeType, scopeId, row);
  }

  updateToolPolicy(input: {
    scopeType: ToolAccessPolicyScopeType;
    scopeId: string;
    rules?: ToolAccessRule[];
    dangerousCapabilities?: DangerousCapabilityRule[];
    guestAccessPreset?: GuestAccessPreset;
    updatedBy?: string;
  }): ToolAccessPolicy {
    const scopeType = input.scopeType;
    const scopeId = normalizeRequired(input.scopeId, "scopeId");
    const current = this.getToolPolicy({ scopeType, scopeId });
    const nextRules = normalizeRules(input.rules ?? current.rules);
    const nextDangerousCapabilities = normalizeDangerousCapabilities(
      input.dangerousCapabilities ?? current.dangerousCapabilities,
    );
    const nextGuestAccessPreset = scopeType === "space"
      ? normalizeGuestAccessPreset(input.guestAccessPreset ?? current.guestAccessPreset)
      : undefined;
    const row = this.options.toolPolicies.upsert({
      scopeType,
      scopeId,
      rulesJson: JSON.stringify(nextRules),
      dangerousCapabilitiesJson: JSON.stringify(nextDangerousCapabilities),
      guestAccessPreset: nextGuestAccessPreset ?? null,
      policyVersion: "tool_access_policy_v1",
      updatedBy: normalizeOptional(input.updatedBy) ?? "system",
    });
    this.recordAudit(
      "tool_access_policy.updated",
      normalizeOptional(input.updatedBy) ?? "system",
      scopeType === "space" ? scopeId : "*",
      {
      scopeType,
      scopeId,
      rules: nextRules,
      dangerousCapabilities: nextDangerousCapabilities,
      guestAccessPreset: nextGuestAccessPreset,
      },
    );
    return rowToPolicy(scopeType, scopeId, row);
  }

  async resolveToolProviderVisibility(input: {
    spaceId: string;
    agentId?: string;
    capability: CapabilityType;
    operation: string;
    targetProvider?: string;
  }): Promise<{
    visibleProviderIds: string[];
    deniedProviderIds: string[];
    denyReasonCode?: string;
    denyReason?: string;
  }> {
    const spaceId = normalizeRequired(input.spaceId, "spaceId");
    const providers = this.resolveProviders(input.capability, spaceId)
      .filter((provider) => provider.operations.includes(input.operation));
    const candidates = normalizeOptional(input.targetProvider)
      ? providers.filter((provider) => provider.id === input.targetProvider)
      : providers;
    const allowedProviders: string[] = [];
    const deniedProviders: string[] = [];
    let firstReasonCode: string | undefined;
    let firstReason: string | undefined;

    for (const provider of candidates) {
      const evaluation = await this.evaluateSelectorAvailability({
        spaceId,
        agentId: normalizeOptional(input.agentId),
        capability: input.capability,
        operation: input.operation,
        provider,
      });
      if (evaluation.allowed) {
        allowedProviders.push(provider.id);
      } else {
        deniedProviders.push(provider.id);
        firstReasonCode ??= evaluation.reasonCode;
        firstReason ??= evaluation.reason;
      }
    }

    return {
      visibleProviderIds: allowedProviders,
      deniedProviderIds: deniedProviders,
      denyReasonCode: allowedProviders.length === 0 ? firstReasonCode : undefined,
      denyReason: allowedProviders.length === 0 ? firstReason : undefined,
    };
  }

  async getEffectiveToolAccess(input: {
    spaceId: string;
    agentId?: string;
    principalId?: string;
    deviceId?: string;
    executionOrigin?: CapabilityExecutionOrigin;
    accessMode?: TurnRequestAccessMode;
  }): Promise<EffectiveToolAccess> {
    const spaceId = normalizeRequired(input.spaceId, "spaceId");
    const agentId = normalizeOptional(input.agentId);
    const operations = await Promise.all(this.resolveCandidateOperations(spaceId).map(async (candidate) => {
      const selectorDecision = await this.evaluateSelectorAvailability({
        spaceId,
        agentId,
        principalId: normalizeOptional(input.principalId),
        deviceId: normalizeOptional(input.deviceId),
        capability: candidate.capability,
        operation: candidate.operation,
        provider: candidate.providers[0]!,
      });
      const gatewayCapabilityDecision = selectorDecision.allowed
        ? this.resolveGatewayCapabilityAccess({
          spaceId,
          principalId: normalizeOptional(input.principalId),
          deviceId: normalizeOptional(input.deviceId),
          executionOrigin: input.executionOrigin,
          accessMode: input.accessMode,
          capability: candidate.capability,
          operation: candidate.operation,
        })
        : null;
      // Managed CLI tools on embedded profile: treat gateway hard-block as approvable escalation
      const gatewayBlockedButApprovable = gatewayCapabilityDecision != null
        && !gatewayCapabilityDecision.allowed
        && gatewayCapabilityDecision.reasonCode === "gateway_capability_blocked"
        && this.isManagedCliTool(candidate.capability, candidate.operation);

      const effectiveGatewayAllowed = gatewayCapabilityDecision?.allowed ?? true;
      const gatewayAllowedOrApprovable = effectiveGatewayAllowed || gatewayBlockedButApprovable;

      const requiredDangerousCapability = this.requiredDangerousCapability(candidate.capability, candidate.operation);
      const dangerousEvaluation = selectorDecision.allowed && gatewayAllowedOrApprovable && requiredDangerousCapability
        ? await this.evaluateDangerousCapability({
          spaceId,
          agentId,
          principalId: normalizeOptional(input.principalId),
          deviceId: normalizeOptional(input.deviceId),
          executionOrigin: input.executionOrigin,
          accessMode: input.accessMode,
          dangerousCapabilityId: requiredDangerousCapability,
          selectors: selectorDecision.selectors,
        })
        : null;

      const denialReasonCode = !selectorDecision.allowed
        ? selectorDecision.requiresApproval
          ? undefined
          : selectorDecision.reasonCode
        : gatewayCapabilityDecision && !gatewayCapabilityDecision.allowed && !gatewayBlockedButApprovable
          ? gatewayCapabilityDecision.reasonCode
        : dangerousEvaluation && !dangerousEvaluation.allowed && !dangerousEvaluation.requiresApproval
          ? dangerousEvaluation.reasonCode
          : undefined;
      const denialReason = !selectorDecision.allowed
        ? selectorDecision.requiresApproval
          ? undefined
          : selectorDecision.reason
        : gatewayCapabilityDecision && !gatewayCapabilityDecision.allowed && !gatewayBlockedButApprovable
          ? gatewayCapabilityDecision.reason
        : dangerousEvaluation && !dangerousEvaluation.allowed && !dangerousEvaluation.requiresApproval
          ? dangerousEvaluation.reason
          : undefined;

      return {
        operationId: candidate.operationId,
        capability: candidate.capability,
        operation: candidate.operation,
        providerIds: candidate.providerIds,
        selectors: selectorDecision.selectors,
        allowed: selectorDecision.allowed
          && gatewayAllowedOrApprovable
          && (dangerousEvaluation?.allowed ?? true),
        denialReasonCode,
        denialReason,
        requiredDangerousCapability,
        escalationAllowed: selectorDecision.requiresApproval || gatewayBlockedButApprovable || (dangerousEvaluation?.requiresApproval ?? false),
      } satisfies EffectiveToolAccessOperation;
    }));

    return {
      spaceId,
      agentId,
      safetyProfileId: agentId ? (await this.resolveAgentSafetyProfile(spaceId, agentId)).profileId : undefined,
      policyVersion: "tool_access_policy_v1",
      operations,
      dangerousCapabilities: await Promise.all(DANGEROUS_CAPABILITIES.map((capabilityId) => (
        this.describeDangerousCapability(
          spaceId,
          agentId,
          capabilityId,
          normalizeOptional(input.principalId),
          input.accessMode,
          input.executionOrigin,
        )
      ))),
      generatedAt: this.now().toISOString(),
    };
  }

  async evaluateToolAccess(input: {
    spaceId: string;
    agentId: string;
    principalId?: string;
    deviceId?: string;
    executionOrigin?: CapabilityExecutionOrigin;
    accessMode?: TurnRequestAccessMode;
    capability: CapabilityType;
    operation: string;
    targetProvider?: string;
  }): Promise<ToolAccessEvaluation> {
    const candidateProviders = normalizeOptional(input.targetProvider)
      ? this.resolveProviders(input.capability, input.spaceId)
        .filter((provider) => provider.id === input.targetProvider)
      : this.resolveProviders(input.capability, input.spaceId);
    let allowedSelectors: string[] = [];
    let approvableSelectorDecision: (ToolAccessEvaluation & { selectors: string[] }) | null = null;
    let deniedSelectorDecision: (ToolAccessEvaluation & { selectors: string[] }) | null = null;

    for (const provider of candidateProviders) {
      const selectorDecision = await this.evaluateSelectorAvailability({
        spaceId: input.spaceId,
        agentId: input.agentId,
        principalId: normalizeOptional(input.principalId),
        deviceId: normalizeOptional(input.deviceId),
        capability: input.capability,
        operation: input.operation,
        provider,
      });
      if (selectorDecision.allowed) {
        allowedSelectors = selectorDecision.selectors;
        approvableSelectorDecision = null;
        deniedSelectorDecision = null;
        break;
      }
      if (selectorDecision.requiresApproval && approvableSelectorDecision == null) {
        approvableSelectorDecision = selectorDecision;
      }
      deniedSelectorDecision ??= selectorDecision;
    }

    if (allowedSelectors.length === 0) {
      if (approvableSelectorDecision) {
        return approvableSelectorDecision;
      }
      return {
        allowed: false,
        reasonCode: deniedSelectorDecision?.reasonCode ?? "tool_unavailable",
        reason: deniedSelectorDecision?.reason ?? `No providers available for ${input.capability}.${input.operation}`,
      };
    }

    const gatewayCapabilityDecision = this.resolveGatewayCapabilityAccess({
      spaceId: input.spaceId,
      principalId: normalizeOptional(input.principalId),
      deviceId: normalizeOptional(input.deviceId),
      executionOrigin: input.executionOrigin,
      accessMode: input.accessMode,
      capability: input.capability,
      operation: input.operation,
    });
    if (!gatewayCapabilityDecision.allowed) {
      // For managed CLI tools on embedded profile, allow approval instead of flat deny
      if (
        gatewayCapabilityDecision.reasonCode === "gateway_capability_blocked" &&
        this.isManagedCliTool(input.capability, input.operation)
      ) {
        // Check if user already approved this tool
        const toolName = `${input.capability}.${input.operation}`;
        const hasGrant = this.options.toolApprovalGrantService?.hasActiveGrant({
          principalId: input.principalId ?? "*",
          deviceId: input.deviceId,
          spaceId: input.spaceId,
          toolId: toolName,
        }) ?? false;

        if (hasGrant) {
          // Grant exists — bypass hard-block for this managed CLI tool
          // Fall through to dangerous capability check below
        } else {
          return {
            allowed: false,
            requiresApproval: true,
            reasonCode: "policy_escalation_required",
            reason: `${toolName} requires approval to run on this gateway profile.`,
            approvalContext: {
              kind: "policy_escalation",
              targetKind: "tool_operation",
              targetId: `tool_operation:${toolName}`,
              toolName: input.operation,
              requestedCapability: input.capability,
              blockingScope: "gateway_profile",
              persistentApprovalSupported: true,
              approvalModes: ["once", "time_window", "durable"],
              defaultTtlSeconds: 3600,
            },
          };
        }
      } else {
        return {
          allowed: false,
          reasonCode: gatewayCapabilityDecision.reasonCode,
          reason: gatewayCapabilityDecision.reason,
        };
      }
    }

    const requiredDangerousCapability = this.requiredDangerousCapability(input.capability, input.operation);
    if (!requiredDangerousCapability) {
      return { allowed: true };
    }
    return await this.evaluateDangerousCapability({
      spaceId: input.spaceId,
      agentId: input.agentId,
      principalId: normalizeOptional(input.principalId),
      deviceId: normalizeOptional(input.deviceId),
      executionOrigin: input.executionOrigin,
      accessMode: input.accessMode,
      dangerousCapabilityId: requiredDangerousCapability,
      selectors: allowedSelectors,
      toolName: `${input.capability}.${input.operation}`,
    });
  }

  async evaluateInjectedToolAccess(input: {
    spaceId: string;
    agentId: string;
    principalId?: string;
    deviceId?: string;
    toolName: string;
    selectorIds?: string[];
  }): Promise<ToolAccessEvaluation> {
    const selectors = Array.from(
      new Set([
        `tool_operation:${normalizeRequired(input.toolName, "toolName")}`,
        ...(input.selectorIds ?? []),
      ]),
    );
    const decision = await this.evaluateSelectorsAgainstPolicies({
      spaceId: normalizeRequired(input.spaceId, "spaceId"),
      agentId: normalizeOptional(input.agentId),
      principalId: normalizeOptional(input.principalId),
      deviceId: normalizeOptional(input.deviceId),
      selectors,
      toolName: input.toolName,
    });
    if (!decision.allowed && !decision.requiresApproval) {
      return {
        allowed: false,
        reasonCode: decision.reasonCode ?? "tool_unavailable",
        reason: decision.reason ?? `Tool unavailable: ${input.toolName}`,
      };
    }
    return decision;
  }

  recordBlockedToolInvocation(input: {
    spaceId: string;
    agentId?: string;
    toolName: string;
    reasonCode: string;
    reason: string;
    principalId?: string;
    deviceId?: string;
  }): void {
    this.recordAudit(
      "tool_access_policy.blocked_tool_call",
      normalizeOptional(input.agentId) ? `agent:${input.agentId}` : "system",
      input.spaceId,
      {
        toolName: input.toolName,
        reasonCode: input.reasonCode,
        reason: input.reason,
        principalId: normalizeOptional(input.principalId),
        deviceId: normalizeOptional(input.deviceId),
      },
    );
  }

  private seedDefaultSafetyProfiles(): void {
    for (const profile of DEFAULT_SAFETY_PROFILES) {
      this.options.safetyProfiles.upsert({
        profileId: profile.profileId,
        displayName: profile.displayName,
        description: profile.description,
        rulesJson: JSON.stringify(profile.rules),
        dangerousCapabilitiesJson: JSON.stringify(profile.dangerousCapabilities),
        updatedAt: profile.updatedAt,
      });
    }
  }

  private ensureLegacyPolicyMigrated(scopeType: ToolAccessPolicyScopeType, scopeId: string): void {
    if (this.options.toolPolicies.get(scopeType, scopeId)) {
      return;
    }

    const legacyPolicy = scopeType === "gateway"
      ? this.buildLegacyGatewayPolicy()
      : scopeType === "space"
        ? this.buildLegacySpacePolicy(scopeId)
        : undefined;
    if (!legacyPolicy) {
      return;
    }

    this.options.toolPolicies.upsert({
      scopeType,
      scopeId,
      rulesJson: JSON.stringify(legacyPolicy.rules),
      dangerousCapabilitiesJson: JSON.stringify(legacyPolicy.dangerousCapabilities),
      policyVersion: legacyPolicy.policyVersion,
      updatedBy: legacyPolicy.updatedBy ?? "migration",
    });
  }

  private buildLegacyGatewayPolicy(): ToolAccessPolicy | undefined {
    const rules: ToolAccessRule[] = [];
    const legacyPolicy = this.options.legacyGatewayPolicyService?.getPolicy();
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

    for (const row of this.options.legacyConnectorPolicies?.list() ?? []) {
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

  private buildLegacySpacePolicy(spaceId: string): ToolAccessPolicy | undefined {
    const row = this.options.legacySpaceToolPolicies?.getBySpace(spaceId);
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

  private resolveCandidateOperations(spaceId: string): Array<{
    operationId: string;
    capability: CapabilityType;
    operation: string;
    providerIds: string[];
    providers: CapabilityProvider[];
  }> {
    const output = new Map<string, {
      capability: CapabilityType;
      operation: string;
      providerIds: Set<string>;
      providers: Map<string, CapabilityProvider>;
    }>();
    for (const capability of this.options.capabilities.getAvailableCapabilities()) {
      const providers = this.resolveProviders(capability, spaceId);
      for (const provider of providers) {
        for (const operation of provider.operations) {
          const operationId = `${capability}.${operation}`;
          const entry = output.get(operationId) ?? {
            capability,
            operation,
            providerIds: new Set<string>(),
            providers: new Map<string, CapabilityProvider>(),
          };
          entry.providerIds.add(provider.id);
          entry.providers.set(provider.id, provider);
          output.set(operationId, entry);
        }
      }
    }
    return Array.from(output.entries()).map(([operationId, value]) => ({
      operationId,
      capability: value.capability,
      operation: value.operation,
      providerIds: Array.from(value.providerIds).sort(),
      providers: Array.from(value.providers.values()),
    }));
  }

  private resolveProviders(capability: CapabilityType, spaceId: string): CapabilityProvider[] {
    if (capability === "mcp") {
      return this.options.capabilities.getProvidersForSpace(capability, spaceId);
    }
    return this.options.capabilities.getProviders(capability);
  }

  private async evaluateSelectorAvailability(input: {
    spaceId: string;
    agentId?: string;
    principalId?: string;
    deviceId?: string;
    capability: CapabilityType;
    operation: string;
    provider: CapabilityProvider;
  }): Promise<ToolAccessEvaluation & { selectors: string[] }> {
    const selectors = this.buildSelectorIds(input);
    return this.evaluateSelectorsAgainstPolicies({
      spaceId: input.spaceId,
      agentId: input.agentId,
      principalId: normalizeOptional(input.principalId),
      deviceId: normalizeOptional(input.deviceId),
      selectors,
      toolName: `${input.capability}.${input.operation}`,
    });
  }

  private async evaluateSelectorsAgainstPolicies(input: {
    spaceId: string;
    agentId?: string;
    principalId?: string;
    deviceId?: string;
    selectors: string[];
    toolName: string;
  }): Promise<ToolAccessEvaluation & { selectors: string[] }> {
    const gatewayPolicy = this.getToolPolicy({ scopeType: "gateway", scopeId: "gateway" });
    const spacePolicy = this.getToolPolicy({ scopeType: "space", scopeId: input.spaceId });
    const agentPolicy = input.agentId
      ? await this.resolveAgentPolicy(input.spaceId, input.agentId)
      : emptyPolicy("agent_override", `${input.spaceId}:*`);

    const policies: Array<{ scope: string; policy: ToolAccessPolicy }> = [
      { scope: "gateway", policy: gatewayPolicy },
      { scope: "space", policy: spacePolicy },
      { scope: "agent", policy: agentPolicy },
    ];

    for (const { scope, policy } of policies) {
      const matchingRule = this.findMatchingRule(policy.rules, input.selectors);
      if (matchingRule?.state === "disabled") {
        const targetId = `${matchingRule.selectorKind}:${matchingRule.selectorId}`;
        const grants = this.options.accessGrants.listEffective({
          principalId: normalizeOptional(input.principalId),
          deviceId: normalizeOptional(input.deviceId),
          spaceId: input.spaceId,
          targetIds: [targetId, ...input.selectors],
        });
        if (grants.length > 0) {
          return { allowed: true, selectors: input.selectors };
        }
        if (scope === "space") {
          return {
            allowed: false,
            requiresApproval: true,
            reasonCode: "policy_escalation_required",
            reason: `Space policy disabled ${matchingRule.selectorKind}:${matchingRule.selectorId}`,
            approvalContext: {
              kind: "policy_escalation",
              targetKind: "tool_selector",
              targetId: `tool_operation:${input.toolName}`,
              toolName: input.toolName,
              requestedCapability: input.toolName,
              selectorKind: matchingRule.selectorKind,
              selectorId: matchingRule.selectorId,
              selectorIds: input.selectors,
              blockingScope: "space_policy",
              persistentApprovalSupported: true,
              approvalModes: ["once", "time_window", "durable"],
              defaultTtlSeconds: 900,
            },
            selectors: input.selectors,
          };
        }
        return {
          allowed: false,
          reasonCode: scope === "gateway"
            ? "gateway_disabled"
            : scope === "space"
              ? "space_disabled"
              : "agent_disabled",
          reason: `${capitalize(scope)} policy disabled ${matchingRule.selectorKind}:${matchingRule.selectorId}`,
          selectors: input.selectors,
        };
      }
    }

    return { allowed: true, selectors: input.selectors };
  }

  private async evaluateDangerousCapability(input: {
    spaceId: string;
    agentId?: string;
    principalId?: string;
    deviceId?: string;
    executionOrigin?: CapabilityExecutionOrigin;
    accessMode?: TurnRequestAccessMode;
    dangerousCapabilityId: DangerousCapabilityId;
    selectors: string[];
    toolName?: string;
  }): Promise<ToolAccessEvaluation> {
    const resolved = await this.resolveDangerousCapabilityState(
      input.spaceId,
      input.agentId,
      input.dangerousCapabilityId,
      input.principalId,
      input.accessMode,
      input.executionOrigin,
    );
    if (resolved.enabled) {
      return { allowed: true };
    }

    return {
      allowed: false,
      reasonCode: "dangerous_access_requires_owner_full_access",
      reason: input.toolName
        ? `${input.toolName} requires owner full access`
        : `Dangerous capability ${input.dangerousCapabilityId} requires owner full access`,
    };
  }

  private async describeDangerousCapability(
    spaceId: string,
    agentId: string | undefined,
    capabilityId: DangerousCapabilityId,
    principalId?: string,
    accessMode?: TurnRequestAccessMode,
    executionOrigin?: CapabilityExecutionOrigin,
  ): Promise<EffectiveDangerousCapability> {
    const resolved = await this.resolveDangerousCapabilityState(
      spaceId,
      agentId,
      capabilityId,
      principalId,
      accessMode,
      executionOrigin,
    );
    return {
      capabilityId,
      enabled: resolved.enabled,
      source: resolved.source,
    };
  }

  private async resolveDangerousCapabilityState(
    spaceId: string,
    agentId: string | undefined,
    capabilityId: DangerousCapabilityId,
    principalId?: string,
    accessMode?: TurnRequestAccessMode,
    executionOrigin?: CapabilityExecutionOrigin,
  ): Promise<{ enabled: boolean; source: EffectiveDangerousCapability["source"] }> {
    const resolvedExecutionOrigin = this.resolveExecutionOrigin(spaceId, principalId, executionOrigin);
    const effectiveAccessMode = this.resolveEffectiveAccessMode(resolvedExecutionOrigin, accessMode);
    if (resolvedExecutionOrigin !== "owner" || effectiveAccessMode !== "full_access") {
      return { enabled: false, source: "default" };
    }

    const gatewayPolicy = this.getToolPolicy({ scopeType: "gateway", scopeId: "gateway" });
    const gatewayRule = findDangerousRule(gatewayPolicy.dangerousCapabilities, capabilityId);
    if (gatewayRule?.state === "disabled") {
      return { enabled: false, source: "gateway_policy" };
    }

    const spacePolicy = this.getToolPolicy({ scopeType: "space", scopeId: spaceId });
    const spaceRule = findDangerousRule(spacePolicy.dangerousCapabilities, capabilityId);
    if (spaceRule?.state === "disabled") {
      return { enabled: false, source: "space_policy" };
    }

    let enabled = false;
    let source: EffectiveDangerousCapability["source"] = "default";

    if (gatewayRule?.state === "enabled") {
      enabled = true;
      source = "gateway_policy";
    }
    if (spaceRule?.state === "enabled") {
      enabled = true;
      source = "space_policy";
    }

    const { profileId, profile } = agentId
      ? await this.resolveAgentSafetyProfile(spaceId, agentId)
      : { profileId: "safe" as SafetyProfileId, profile: this.resolveSafetyProfile("safe") };
    const profileRule = findDangerousRule(profile.dangerousCapabilities, capabilityId);
    if (!enabled && profileRule?.state === "enabled") {
      enabled = true;
      source = "profile";
    }

    if (agentId) {
      const overrideRule = findDangerousRule(
        (await this.resolveAgentPolicy(spaceId, agentId)).dangerousCapabilities,
        capabilityId,
      );
      if (overrideRule?.state === "disabled") {
        return { enabled: false, source: "agent_override" };
      }
      if (overrideRule?.state === "enabled") {
        enabled = true;
        source = "agent_override";
      }
    }

    if (!enabled && capabilitySupportsFullAccess(capabilityId)) {
      return {
        enabled: true,
        source: "turn_access_mode",
      };
    }

    return {
      enabled,
      source: enabled ? source : profileId === "safe" ? "default" : "profile",
    };
  }

  private async resolveAgentSafetyProfile(
    spaceId: string,
    agentId: string,
  ): Promise<{ profileId: SafetyProfileId; profile: SafetyProfileDefinition }> {
    const space = await this.options.spaceAdminService.getSpace(spaceId);
    const assignment = space?.agents?.find((entry) => entry.agentId === agentId);
    const explicit = normalizeSafetyProfileId(assignment?.safetyProfileId);
    if (explicit) {
      return {
        profileId: explicit,
        profile: this.resolveSafetyProfile(explicit),
      };
    }

    const legacyScope = isRecord(assignment?.securityScope)
      ? assignment?.securityScope
      : null;
    if (legacyScope) {
      const allowShell = legacyScope.allowShell === true;
      const permissionMode = typeof legacyScope.permissionMode === "string"
        ? legacyScope.permissionMode.trim()
        : "";
      const filesystemScope = typeof legacyScope.filesystemScope === "string"
        ? legacyScope.filesystemScope.trim()
        : "";
      if (!allowShell) {
        return { profileId: "safe", profile: this.resolveSafetyProfile("safe") };
      }
      if (permissionMode === "developer" || filesystemScope === "/") {
        return { profileId: "operator", profile: this.resolveSafetyProfile("operator") };
      }
      return { profileId: "workspace", profile: this.resolveSafetyProfile("workspace") };
    }

    const isPrimary = assignment?.isPrimary === true || assignment?.agentId === "main-agent";
    const profileId: SafetyProfileId = isPrimary ? "workspace" : "safe";
    return { profileId, profile: this.resolveSafetyProfile(profileId) };
  }

  private resolveSafetyProfile(profileId: SafetyProfileId): SafetyProfileDefinition {
    return this.listSafetyProfiles().find((entry) => entry.profileId === profileId)
      ?? DEFAULT_SAFETY_PROFILES.find((entry) => entry.profileId === profileId)
      ?? DEFAULT_SAFETY_PROFILES[0]!;
  }

  private async resolveAgentPolicy(spaceId: string, agentId: string): Promise<ToolAccessPolicy> {
    const space = await this.options.spaceAdminService.getSpace(spaceId);
    const assignment = space?.agents?.find((entry) => entry.agentId === agentId);
    if (assignment?.toolPolicyOverride && isRecord(assignment.toolPolicyOverride)) {
      return normalizePolicy({
        scopeType: "agent_override",
        scopeId: `${spaceId}:${agentId}`,
        rules: parseRules(JSON.stringify(assignment.toolPolicyOverride.rules ?? [])),
        dangerousCapabilities: parseDangerousCapabilities(JSON.stringify(assignment.toolPolicyOverride.dangerousCapabilities ?? [])),
        policyVersion: assignment.toolPolicyOverride.policyVersion ?? "tool_access_policy_v1",
        updatedBy: assignment.toolPolicyOverride.updatedBy,
        updatedAt: assignment.toolPolicyOverride.updatedAt,
      });
    }

    if (assignment?.securityScope && isRecord(assignment.securityScope)) {
      const rules: ToolAccessRule[] = [];
      const allowedCapabilities = Array.isArray(assignment.securityScope.allowedCapabilities)
        ? assignment.securityScope.allowedCapabilities
        : [];
      for (const capability of allowedCapabilities) {
        if (typeof capability === "string" && capability.trim()) {
          rules.push({ selectorKind: "capability", selectorId: capability.trim(), state: "enabled" });
        }
      }
      return {
        scopeType: "agent_override",
        scopeId: `${spaceId}:${agentId}`,
        rules: normalizeRules(rules),
        dangerousCapabilities: [],
        policyVersion: "tool_access_policy_v1",
      };
    }

    return emptyPolicy("agent_override", `${spaceId}:${agentId}`);
  }

  resolveGatewayCapabilityAccess(input: {
    spaceId: string;
    principalId?: string;
    deviceId?: string;
    executionOrigin?: CapabilityExecutionOrigin;
    accessMode?: TurnRequestAccessMode;
    capability: CapabilityType;
    operation: string;
  }): {
    allowed: boolean;
    reasonCode?: string;
    reason?: string;
    requiredGrantId: string;
    decision: CapabilityRequestDecision["decision"];
    effectiveAccessMode: TurnRequestAccessMode;
  } {
    const principalId = normalizeOptional(input.principalId);
    const resolvedExecutionOrigin = this.resolveExecutionOrigin(
      input.spaceId,
      principalId,
      input.executionOrigin,
    );
    const effectiveAccessMode = this.resolveEffectiveAccessMode(resolvedExecutionOrigin, input.accessMode);
    const request = capabilityRequestFromInvocation(input.capability, input.operation);

    if (this.gatewayProfile.hardBlockedCapabilities.includes(request.capabilityId)) {
      return {
        allowed: false,
        reasonCode: "gateway_capability_blocked",
        reason: `Capability ${request.capabilityId} is blocked by gateway profile ${this.gatewayProfile.id}`,
        requiredGrantId: request.capabilityId,
        decision: "deny",
        effectiveAccessMode,
      };
    }

    if (resolvedExecutionOrigin === "owner") {
      return {
        allowed: true,
        requiredGrantId: request.capabilityId,
        decision: "allow",
        effectiveAccessMode,
      };
    }

    const participantMode = this.resolveParticipantMode(input.spaceId, principalId);
    if (resolvedExecutionOrigin === "guest" && participantMode) {
      const guestAccessPreset = this.resolveEffectiveGuestAccessPreset(input.spaceId, participantMode);
      if (this.isSafeNonDangerousCapabilityRequest(input.capability, input.operation, request.capabilityId)) {
        if (guestAccessPreset === "collaborator" || request.level === "read") {
          return {
            allowed: true,
            requiredGrantId: request.capabilityId,
            decision: "allow",
            effectiveAccessMode,
          };
        }
      }

      return {
        allowed: false,
        reasonCode: "guest_access_preset_denied",
        reason: guestAccessPreset === "read_only"
          ? `Guest read-only access does not allow ${input.capability}.${input.operation}`
          : `Guest access does not allow ${input.capability}.${input.operation}`,
        requiredGrantId: request.capabilityId,
        decision: "deny",
        effectiveAccessMode,
      };
    }

    const explicitGrantDecision = this.options.gatewayCapabilityAccessService
      ? this.options.gatewayCapabilityAccessService.evaluateInvocation({
        capability: input.capability,
        operation: input.operation,
        principalId,
        deviceId: normalizeOptional(input.deviceId),
      }).decision
      : evaluateCapabilityRequest(this.defaultGatewayCoreState, request, this.now());

    if (explicitGrantDecision.decision === "allow") {
      return {
        allowed: true,
        requiredGrantId: request.capabilityId,
        decision: explicitGrantDecision.decision,
        effectiveAccessMode,
      };
    }

    return {
      allowed: false,
      reasonCode: explicitGrantDecision.decision === "prompt"
        ? "gateway_capability_not_granted"
        : "gateway_capability_denied",
      reason: `${explicitGrantDecision.reason} (required grant: ${request.capabilityId})`,
      requiredGrantId: request.capabilityId,
      decision: explicitGrantDecision.decision,
      effectiveAccessMode,
    };
  }

  private buildSelectorIds(input: {
    capability: CapabilityType;
    operation: string;
    provider: CapabilityProvider;
  }): string[] {
    const selectors = [
      `capability:${input.capability}`,
      `tool_operation:${input.capability}.${input.operation}`,
    ];
    if (input.capability === "calendar" && input.provider.id === "apple-calendar-eventkit") {
      selectors.push("connector_family:apple-calendar-eventkit");
    }
    if (input.capability === "lists" && input.provider.id === "apple-reminders-eventkit") {
      selectors.push("connector_family:apple-reminders-eventkit");
    }
    if (input.capability === "email" && input.provider.id === "apple-mail-mailkit") {
      selectors.push("connector_family:apple-mail-mailkit");
    }
    if (input.capability === "shell") {
      const tool = this.options.cliToolService?.getTool(input.operation);
      if (tool?.bundleId?.trim()) {
        selectors.push(`cli_bundle:${tool.bundleId.trim()}`);
      }
    }
    if (input.provider.source === "connector") {
      selectors.push(`connector_instance:${input.provider.id}`);
      const familyId = input.provider.id.split(":")[0]?.trim();
      if (familyId) {
        selectors.push(`connector_family:${familyId}`);
      }
    }
    if (input.capability === "mcp" && input.provider.id.trim()) {
      selectors.push(`mcp_server:${input.provider.id.trim()}`);
    }
    return Array.from(new Set(selectors));
  }

  private findMatchingRule(rules: ToolAccessRule[], selectors: string[]): ToolAccessRule | undefined {
    for (const selector of selectors) {
      const [selectorKind, ...rest] = selector.split(":");
      const selectorId = rest.join(":");
      const match = rules.find((rule) => rule.selectorKind === selectorKind && rule.selectorId === selectorId);
      if (match) {
        return match;
      }
    }
    return undefined;
  }

  private requiredDangerousCapability(
    capability: CapabilityType,
    operation: string,
  ): DangerousCapabilityId | undefined {
    if (capability !== "shell") {
      return undefined;
    }
    const tool = this.options.cliToolService?.getTool(operation);
    return tool?.bundleId?.trim() ? "managed_shell" : "arbitrary_shell";
  }

  private resolveExecutionOrigin(
    spaceId: string,
    principalId?: string,
    executionOrigin?: CapabilityExecutionOrigin,
  ): CapabilityExecutionOrigin {
    if (executionOrigin) {
      return executionOrigin;
    }
    return resolveExecutionOriginForPrincipal({
      spaceId,
      principalId,
      getActiveParticipant: this.options.spaceSharingService
        ? (candidateSpaceId, candidatePrincipalId) => this.options.spaceSharingService!.getActiveParticipant(
          candidateSpaceId,
          candidatePrincipalId,
        )
        : null,
      evaluateAccess: this.options.spaceSharingService
        ? (candidateSpaceId, candidatePrincipalId) => this.options.spaceSharingService!.evaluateAccess({
          spaceId: candidateSpaceId,
          principalId: candidatePrincipalId,
          action: "read",
        })
        : null,
    });
  }

  private resolveEffectiveAccessMode(
    executionOrigin: CapabilityExecutionOrigin,
    accessMode?: TurnRequestAccessMode,
  ): TurnRequestAccessMode {
    if (executionOrigin === "owner" && accessMode === "full_access") {
      return "full_access";
    }
    return "default";
  }

  private resolveParticipantMode(
    spaceId: string,
    principalId?: string,
  ): SpaceShareAccessMode | undefined {
    if (!principalId) {
      return undefined;
    }
    return normalizeSpaceShareAccessMode(
      this.options.spaceSharingService?.getActiveParticipant(spaceId, principalId)?.mode,
    );
  }

  private resolveEffectiveGuestAccessPreset(
    spaceId: string,
    participantMode?: SpaceShareAccessMode,
  ): GuestAccessPreset {
    const spacePreset = normalizeGuestAccessPreset(
      this.getToolPolicy({ scopeType: "space", scopeId: spaceId }).guestAccessPreset,
    ) ?? "collaborator";
    if (participantMode === "read_only" || spacePreset === "read_only") {
      return "read_only";
    }
    return "collaborator";
  }

  private isManagedCliTool(capability: CapabilityType, operation: string): boolean {
    if (capability !== "shell") return false;
    const cliToolService = this.options.cliToolService;
    if (!cliToolService) return false;
    // CLI tool IDs use dot notation (e.g., "jira.issue.list")
    // The operation in the capability request matches the tool ID
    const tool = cliToolService.getTool(operation);
    return tool != null;
  }

  private isSafeNonDangerousCapabilityRequest(
    capability: CapabilityType,
    operation: string,
    capabilityId: string,
  ): boolean {
    return !UNSAFE_REGULAR_GATEWAY_CAPABILITIES.has(capabilityId)
      && !this.requiredDangerousCapability(capability, operation);
  }

  private recordAudit(
    eventType: string,
    actor: string,
    spaceId: string,
    payload: Record<string, unknown>,
  ): void {
    try {
      this.options.auditRepo?.create({
        auditEventId: `audit-${randomUUID()}`,
        eventType,
        actor,
        spaceId,
        payload,
      });
    } catch {
      // Ignore audit failures.
    }
  }
}
