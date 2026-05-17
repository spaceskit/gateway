import { randomUUID } from "node:crypto";
import type { CapabilityProvider, CapabilityType, SpaceAdminService } from "@spaceskit/core";
import type { CapabilityRegistry } from "@spaceskit/core";
import type { GatewayCoreProfileId } from "@spaceskit/gateway-core";
import { type AuditEventsRepository, SpaceToolPolicyRepository } from "@spaceskit/persistence";
import { DefaultGatewayPolicyService } from "./gateway-policy-service.js";
import { GatewayCapabilityAccessService } from "./gateway-capability-access-service.js";
import {
  matchesToolSet,
  normalizeConnectorEntries,
  normalizeOptional,
  normalizeRequired,
  parseSourceSelector,
  parseToolList,
  parseToolListExcludingSourceSelectors,
  selectorFromEntry,
} from "./space-tool-policy-service-helpers.js";

export type ToolDenyReasonCode =
  | "gateway_profile_block"
  | "gateway_policy_denied"
  | "principal_grant_denied"
  | "space_tool_denied"
  | "space_tool_allowlist_miss"
  | "space_connector_disabled"
  | "mcp_unavailable";

export interface ToolDenyReason {
  code: ToolDenyReasonCode;
  message: string;
}

export interface EffectiveToolOperation {
  operationId: string;
  capability: CapabilityType;
  operation: string;
  providerIds: string[];
  allowed: boolean;
  denyReasons: ToolDenyReason[];
}

export interface EffectiveToolMatrix {
  spaceId: string;
  principalId?: string;
  deviceId?: string;
  agentId?: string;
  policyVersion: string;
  operations: EffectiveToolOperation[];
  generatedAt: string;
}

export interface SpaceToolPolicyServiceOptions {
  capabilities: CapabilityRegistry;
  spaceAdminService: SpaceAdminService;
  toolPolicies: SpaceToolPolicyRepository;
  gatewayProfile: GatewayCoreProfileId;
  gatewayPolicyService?: DefaultGatewayPolicyService;
  gatewayCapabilityAccessService?: GatewayCapabilityAccessService;
  spaceMcpService?: {
    isConfiguredForSpace: (spaceId: string) => boolean;
  };
  cliToolService?: {
    getTool: (toolId: string) => { id: string; bundleId?: string } | undefined;
  };
  auditRepo?: AuditEventsRepository;
  now?: () => Date;
}

interface SpaceToolPolicyConfig {
  allowed: Set<string>;
  denied: Set<string>;
  connectorMode: SpaceConnectorPolicyMode;
  connectorEntries: SpaceConnectorPolicyEntry[];
  connectorDisabledSelectors: Set<string>;
  version: string;
  updatedBy?: string;
  updatedAt?: string;
}

export type SpaceConnectorPolicyMode = "all_enabled" | "custom";
export type SpaceConnectorPolicySourceKind = "connector_family" | "cli_bundle" | "connector_instance";
export type SpaceConnectorPolicyEntryState = "enabled" | "disabled";

export interface SpaceConnectorPolicyEntry {
  sourceKind: SpaceConnectorPolicySourceKind;
  sourceId: string;
  state: SpaceConnectorPolicyEntryState;
}

export interface SpaceConnectorPolicyRecord {
  spaceId: string;
  mode: SpaceConnectorPolicyMode;
  entries: SpaceConnectorPolicyEntry[];
  policyVersion: string;
  updatedBy?: string;
  updatedAt?: string;
}

export interface ToolProviderVisibility {
  visibleProviderIds: string[];
  deniedProviderIds: string[];
  denyReasonCode?: ToolDenyReasonCode;
  denyReason?: string;
}

const HARD_BLOCKS_BY_PROFILE: Record<GatewayCoreProfileId, Set<string>> = {
  embedded: new Set<string>(),
  external: new Set<string>(),
};

export class SpaceToolPolicyService {
  private readonly now: () => Date;

  constructor(private readonly options: SpaceToolPolicyServiceOptions) {
    this.now = options.now ?? (() => new Date());
  }

  async getEffectiveTools(input: {
    spaceId: string;
    principalId?: string;
    deviceId?: string;
    agentId?: string;
    accessMode?: "default" | "full_access";
  }): Promise<EffectiveToolMatrix> {
    const spaceId = normalizeRequired(input.spaceId, "spaceId");
    const principalId = normalizeOptional(input.principalId);
    const deviceId = normalizeOptional(input.deviceId);
    const agentId = normalizeOptional(input.agentId);
    const spaceConfig = await this.options.spaceAdminService.getSpace(spaceId);
    if (!spaceConfig) {
      throw new Error(`Space not found: ${spaceId}`);
    }

    const policy = this.resolveSpaceToolPolicy(spaceId);
    const assignment = agentId
      ? spaceConfig.agents.find((entry) => entry.agentId === agentId)
      : undefined;

    const operations = this.resolveCandidateOperations(spaceId);
    const matrix: EffectiveToolOperation[] = operations.map((candidate) => {
      const reasons: ToolDenyReason[] = [];
      const operationId = `${candidate.capability}.${candidate.operation}`;
      const providerVisibility = this.resolveToolProviderVisibility({
        spaceId,
        capability: candidate.capability,
        operation: candidate.operation,
      });

      if (this.isHardBlocked(operationId)) {
        reasons.push({
          code: "gateway_profile_block",
          message: `Blocked by gateway profile: ${operationId}`,
        });
      }

      const gatewayPolicyDecision = this.options.gatewayPolicyService?.evaluateCapability(candidate.capability);
      if (gatewayPolicyDecision && !gatewayPolicyDecision.allowed) {
        reasons.push({
          code: "gateway_policy_denied",
          message: gatewayPolicyDecision.reason ?? `Capability denied by gateway policy: ${candidate.capability}`,
        });
      }

      if (principalId && this.options.gatewayCapabilityAccessService) {
        const decision = this.options.gatewayCapabilityAccessService.evaluateInvocation({
          capability: candidate.capability,
          operation: candidate.operation,
          principalId,
          deviceId,
        }).decision;
        if (decision.decision !== "allow") {
          reasons.push({
            code: "principal_grant_denied",
            message: decision.reason ?? `Principal/device grant denied for ${operationId}`,
          });
        }
      }

      if (matchesToolSet(policy.denied, operationId, candidate.capability)) {
        reasons.push({
          code: "space_tool_denied",
          message: `Denied by space tool policy: ${operationId}`,
        });
      }
      if (policy.allowed.size > 0 && !matchesToolSet(policy.allowed, operationId, candidate.capability)) {
        reasons.push({
          code: "space_tool_allowlist_miss",
          message: `Not included in space tool allowlist: ${operationId}`,
        });
      }
      if (providerVisibility.visibleProviderIds.length === 0 && providerVisibility.deniedProviderIds.length > 0) {
        reasons.push({
          code: "space_connector_disabled",
          message: providerVisibility.denyReason ?? `All providers for ${operationId} are disabled by space connector policy.`,
        });
      }

      if (candidate.capability === "mcp" && this.options.spaceMcpService) {
        if (!this.options.spaceMcpService.isConfiguredForSpace(spaceId)) {
          reasons.push({
            code: "mcp_unavailable",
            message: `No MCP endpoint configured for space: ${spaceId}`,
          });
        }
      }

      return {
        operationId,
        capability: candidate.capability,
        operation: candidate.operation,
        providerIds: providerVisibility.visibleProviderIds.length > 0
          ? providerVisibility.visibleProviderIds
          : candidate.providerIds,
        allowed: reasons.length === 0,
        denyReasons: reasons,
      };
    });

    return {
      spaceId,
      principalId,
      deviceId,
      agentId,
      policyVersion: policy.version,
      operations: matrix,
      generatedAt: this.now().toISOString(),
    };
  }

  getConnectorPolicy(input: {
    spaceId: string;
  }): SpaceConnectorPolicyRecord {
    const spaceId = normalizeRequired(input.spaceId, "spaceId");
    const policy = this.resolveSpaceToolPolicy(spaceId);
    return {
      spaceId,
      mode: policy.connectorMode,
      entries: policy.connectorEntries,
      policyVersion: policy.version,
      updatedBy: policy.updatedBy,
      updatedAt: policy.updatedAt,
    };
  }

  async updateConnectorPolicy(input: {
    spaceId: string;
    mode: SpaceConnectorPolicyMode;
    entries?: SpaceConnectorPolicyEntry[];
    updatedBy?: string;
  }): Promise<SpaceConnectorPolicyRecord> {
    const spaceId = normalizeRequired(input.spaceId, "spaceId");
    const current = this.resolveSpaceToolPolicy(spaceId);
    const normalizedEntries = input.mode === "custom"
      ? normalizeConnectorEntries(input.entries ?? [])
      : [];
    const allowedRaw = parseToolListExcludingSourceSelectors(current.allowed);
    const deniedRaw = parseToolListExcludingSourceSelectors(current.denied);
    const allowedTools = [
      ...allowedRaw,
      ...normalizedEntries
        .filter((entry) => entry.state === "enabled")
        .map((entry) => selectorFromEntry(entry)),
    ];
    const deniedTools = [
      ...deniedRaw,
      ...normalizedEntries
        .filter((entry) => entry.state === "disabled")
        .map((entry) => selectorFromEntry(entry)),
    ];

    const row = this.options.toolPolicies.upsert({
      spaceId,
      allowedTools,
      deniedTools,
      policyVersion: current.version,
      updatedBy: normalizeOptional(input.updatedBy) ?? "system",
    });

    const record: SpaceConnectorPolicyRecord = {
      spaceId,
      mode: input.mode,
      entries: normalizedEntries,
      policyVersion: row.policy_version,
      updatedBy: row.updated_by,
      updatedAt: row.updated_at,
    };
    this.recordAudit(
      "space_connector_policy.updated",
      normalizeOptional(input.updatedBy) ?? "system",
      spaceId,
      {
        mode: record.mode,
        entries: record.entries,
      },
    );
    return record;
  }

  resolveToolProviderVisibility(input: {
    spaceId: string;
    capability: CapabilityType;
    operation: string;
    targetProvider?: string;
  }): ToolProviderVisibility {
    const spaceId = normalizeRequired(input.spaceId, "spaceId");
    const targetProvider = normalizeOptional(input.targetProvider);
    const policy = this.resolveSpaceToolPolicy(spaceId);
    const providers = this.resolveProviders(input.capability, spaceId)
      .filter((provider) => provider.operations.includes(input.operation))
      .filter((provider) => !targetProvider || provider.id === targetProvider);

    const visibleProviderIds: string[] = [];
    const deniedProviderIds: string[] = [];
    for (const provider of providers) {
      const selectors = this.buildConnectorSelectors({
        capability: input.capability,
        operation: input.operation,
        provider,
      });
      const denied = selectors.some((selector) => policy.connectorDisabledSelectors.has(selector));
      if (denied) {
        deniedProviderIds.push(provider.id);
        continue;
      }
      visibleProviderIds.push(provider.id);
    }

    const operationId = `${input.capability}.${input.operation}`;
    return {
      visibleProviderIds,
      deniedProviderIds,
      denyReasonCode: visibleProviderIds.length === 0 && deniedProviderIds.length > 0
        ? "space_connector_disabled"
        : undefined,
      denyReason: visibleProviderIds.length === 0 && deniedProviderIds.length > 0
        ? `All providers for ${operationId} are disabled by space connector policy.`
        : undefined,
    };
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
      "space_connector_policy.blocked_tool_call",
      normalizeOptional(input.principalId) ?? normalizeOptional(input.agentId) ?? "system",
      normalizeRequired(input.spaceId, "spaceId"),
      {
        agentId: normalizeOptional(input.agentId),
        toolName: input.toolName,
        reasonCode: input.reasonCode,
        reason: input.reason,
        principalId: normalizeOptional(input.principalId),
        deviceId: normalizeOptional(input.deviceId),
      },
    );
  }

  private resolveCandidateOperations(spaceId: string): Array<{
    capability: CapabilityType;
    operation: string;
    providerIds: string[];
  }> {
    const output = new Map<string, { capability: CapabilityType; operation: string; providerIds: Set<string> }>();
    const capabilities = this.options.capabilities.getAvailableCapabilities();
    for (const capability of capabilities) {
      const providers = this.options.capabilities.getProvidersForSpace(capability, spaceId);
      for (const provider of providers) {
        for (const operation of provider.operations) {
          const key = `${capability}.${operation}`;
          const entry = output.get(key) ?? {
            capability,
            operation,
            providerIds: new Set<string>(),
          };
          entry.providerIds.add(provider.id);
          output.set(key, entry);
        }
      }
    }

    return Array.from(output.values())
      .map((entry) => ({
        capability: entry.capability,
        operation: entry.operation,
        providerIds: Array.from(entry.providerIds).sort(),
      }))
      .sort((left, right) => left.capability.localeCompare(right.capability) || left.operation.localeCompare(right.operation));
  }

  private resolveSpaceToolPolicy(spaceId: string): SpaceToolPolicyConfig {
    const row = this.options.toolPolicies.getBySpace(spaceId);
    const allowedEntries = parseToolList(row?.allowed_tools_json);
    const deniedEntries = parseToolList(row?.denied_tools_json);
    const connectorEntries = [
      ...allowedEntries
        .map((entry) => parseSourceSelector(entry, "enabled"))
        .filter((entry): entry is SpaceConnectorPolicyEntry => entry != null),
      ...deniedEntries
        .map((entry) => parseSourceSelector(entry, "disabled"))
        .filter((entry): entry is SpaceConnectorPolicyEntry => entry != null),
    ];
    return {
      allowed: new Set(allowedEntries),
      denied: new Set(deniedEntries),
      connectorMode: connectorEntries.length > 0 ? "custom" : "all_enabled",
      connectorEntries,
      connectorDisabledSelectors: new Set(
        connectorEntries
          .filter((entry) => entry.state === "disabled")
          .map((entry) => selectorFromEntry(entry)),
      ),
      version: normalizeOptional(row?.policy_version) ?? "v1",
      updatedBy: normalizeOptional(row?.updated_by),
      updatedAt: normalizeOptional(row?.updated_at),
    };
  }

  private isHardBlocked(operationId: string): boolean {
    return HARD_BLOCKS_BY_PROFILE[this.options.gatewayProfile].has(operationId);
  }

  private resolveProviders(capability: CapabilityType, spaceId: string): CapabilityProvider[] {
    return this.options.capabilities.getProvidersForSpace(capability, spaceId);
  }

  private buildConnectorSelectors(input: {
    capability: CapabilityType;
    operation: string;
    provider: CapabilityProvider;
  }): string[] {
    const selectors: string[] = [];
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
      const bundleId = normalizeOptional(tool?.bundleId);
      if (bundleId) {
        selectors.push(`cli_bundle:${bundleId}`);
      }
    }
    if (input.provider.source === "connector") {
      selectors.push(`connector_instance:${input.provider.id}`);
    }
    return Array.from(new Set(selectors));
  }

  private recordAudit(
    eventType: string,
    actor: string,
    spaceId: string,
    payload: Record<string, unknown>,
  ): void {
    this.options.auditRepo?.create({
      auditEventId: randomUUID(),
      eventType,
      actor,
      spaceId,
      payload,
      createdAt: this.now().toISOString(),
    });
  }
}
