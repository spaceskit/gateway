import type { CapabilityType, SpaceAdminService } from "@spaceskit/core";
import type { CapabilityRegistry } from "@spaceskit/core";
import type { GatewayCoreProfileId } from "@spaceskit/gateway-core";
import { SpaceToolPolicyRepository } from "@spaceskit/persistence";
import { DefaultGatewayPolicyService } from "./gateway-policy-service.js";
import { GatewayCapabilityAccessService } from "./gateway-capability-access-service.js";

export type ToolDenyReasonCode =
  | "gateway_profile_block"
  | "gateway_policy_denied"
  | "principal_grant_denied"
  | "space_tool_denied"
  | "space_tool_allowlist_miss"
  | "agent_scope_denied"
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
  now?: () => Date;
}

interface SpaceToolPolicyConfig {
  allowed: Set<string>;
  denied: Set<string>;
  version: string;
}

const NETWORK_CAPABILITIES = new Set<CapabilityType>(["browser", "messaging", "mcp"]);
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

      if (assignment?.securityScope) {
        const scope = assignment.securityScope;
        if (
          scope.allowedCapabilities.length > 0
          && !scope.allowedCapabilities.includes(candidate.capability)
        ) {
          reasons.push({
            code: "agent_scope_denied",
            message: `Agent scope does not allow capability: ${candidate.capability}`,
          });
        }
        if (candidate.capability === "shell" && scope.allowShell === false) {
          reasons.push({
            code: "agent_scope_denied",
            message: "Agent scope disables shell execution",
          });
        }
        if (NETWORK_CAPABILITIES.has(candidate.capability) && scope.allowNetwork === false) {
          reasons.push({
            code: "agent_scope_denied",
            message: "Agent scope disables network operations",
          });
        }
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
        providerIds: candidate.providerIds,
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
    return {
      allowed: new Set(parseToolList(row?.allowed_tools_json)),
      denied: new Set(parseToolList(row?.denied_tools_json)),
      version: normalizeOptional(row?.policy_version) ?? "v1",
    };
  }

  private isHardBlocked(operationId: string): boolean {
    return HARD_BLOCKS_BY_PROFILE[this.options.gatewayProfile].has(operationId);
  }
}

function matchesToolSet(set: Set<string>, operationId: string, capability: CapabilityType): boolean {
  if (set.has(operationId)) return true;
  if (set.has(capability)) return true;
  if (set.has(`${capability}.*`)) return true;
  return false;
}

function parseToolList(raw: string | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
    }
  } catch {
    // Ignore parse failures.
  }
  return [];
}

function normalizeRequired(value: string | undefined, field: string): string {
  const normalized = normalizeOptional(value);
  if (!normalized) {
    throw new Error(`${field} is required`);
  }
  return normalized;
}

function normalizeOptional(value: string | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}
