import { randomUUID } from "node:crypto";
import type {
  CapabilityProvider,
  CapabilityRegistry,
  CapabilityExecutionOrigin,
  CapabilityType,
  DangerousCapabilityRule,
  EffectiveToolAccess,
  GuestAccessPreset,
  SafetyProfileDefinition,
  SpaceAdminService,
  ToolAccessEvaluation,
  ToolAccessPolicy,
  ToolAccessPolicyScopeType,
  ToolAccessRule,
  TurnRequestAccessMode,
} from "@spaceskit/core";
import {
  createGatewayCoreState,
  getGatewayCoreProfile,
  type GatewayCoreProfileId,
} from "@spaceskit/gateway-core";
import type {
  AccessGrantRepository,
  AuditEventsRepository,
  SafetyProfileRepository,
  ToolAccessPolicyRepository,
} from "@spaceskit/persistence";
import type { CliToolService } from "./cli-tool-service.js";
import type { GatewayCapabilityAccessService } from "./gateway-capability-access-service.js";
import {
  resolveGatewayCapabilityAccess as resolveGatewayCapabilityAccessHelper,
  type GatewayCapabilityAccessDecision,
  type GatewayCapabilityAccessEvaluatorDeps,
} from "./gateway-capability-access-evaluator.js";
import type { SpaceSharingService } from "./space-sharing-service.js";
import type { ToolApprovalGrantService } from "./tool-approval-grant-service.js";
import {
  buildEffectiveToolAccessOperation,
  evaluateSelectorAvailability as evaluateSelectorAvailabilityHelper,
  evaluateSelectorsAgainstPolicies,
  evaluateToolOperationAccess,
  resolveToolProviderVisibilityDecision,
  type SelectorPolicyEvaluationDeps,
  type ToolAccessSelectorDecision,
  type ToolSelectorAvailabilityDeps,
  type ToolSelectorAvailabilityInput,
} from "./tool-access-policy-decisions.js";
import {
  describeDangerousCapability,
  evaluateDangerousCapability as evaluateDangerousCapabilityHelper,
  type DangerousCapabilityAccessEvaluationInput,
  type DangerousCapabilityPolicyDeps,
} from "./tool-access-policy-dangerous.js";
import { createGatewayCapabilityAccessEvaluatorDeps } from "./tool-access-policy-gateway-deps.js";
import {
  DANGEROUS_CAPABILITIES,
  normalizeDangerousCapabilities,
  normalizeGuestAccessPreset,
  normalizeOptional,
  normalizeRequired,
  normalizeRules,
  rowToPolicy,
} from "./tool-access-policy-normalizers.js";
import {
  listSafetyProfiles as listSafetyProfilesHelper,
  resolveAgentPolicy as resolveAgentPolicyHelper,
  resolveAgentSafetyProfile,
  resolveSafetyProfile,
  seedDefaultSafetyProfiles as seedDefaultSafetyProfilesHelper,
  type ToolAccessPolicyProfileReadDeps,
} from "./tool-access-policy-profiles.js";
import {
  buildSelectorIds,
  isManagedCliTool,
  requiredDangerousCapability,
  resolveCandidateOperations,
  resolveProviders,
  type ToolAccessCandidateOperation,
} from "./tool-access-policy-selectors.js";

export interface ToolAccessPolicyServiceOptions {
  capabilities: CapabilityRegistry;
  spaceAdminService: SpaceAdminService;
  toolPolicies: ToolAccessPolicyRepository;
  safetyProfiles: SafetyProfileRepository;
  accessGrants: AccessGrantRepository;
  gatewayCapabilityAccessService?: Pick<GatewayCapabilityAccessService, "evaluateInvocation"> | null;
  gatewayProfileId?: GatewayCoreProfileId;
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
    seedDefaultSafetyProfilesHelper(this.options.safetyProfiles);
  }

  listSafetyProfiles(): SafetyProfileDefinition[] {
    return listSafetyProfilesHelper(this.options.safetyProfiles);
  }

  getToolPolicy(input: {
    scopeType: ToolAccessPolicyScopeType;
    scopeId: string;
  }): ToolAccessPolicy {
    const scopeType = input.scopeType;
    const scopeId = normalizeRequired(input.scopeId, "scopeId");
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
    return resolveToolProviderVisibilityDecision({
      resolveProviders: (capability, spaceId) => this.resolveProviders(capability, spaceId),
      evaluateSelectorAvailability: (candidate) => this.evaluateSelectorAvailability(candidate),
    }, input);
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
      return buildEffectiveToolAccessOperation({
        evaluateSelectorAvailability: (candidateInput) => this.evaluateSelectorAvailability(candidateInput),
        resolveGatewayCapabilityAccess: (candidateInput) => this.resolveGatewayCapabilityAccess(candidateInput),
        requiredDangerousCapability: (capability, operation) => (
          requiredDangerousCapability(this.options.cliToolService, capability, operation)
        ),
        isManagedCliTool: (capability, operation) => (
          isManagedCliTool(this.options.cliToolService, capability, operation)
        ),
        evaluateDangerousCapability: (candidateInput) => this.evaluateDangerousCapability(candidateInput),
      }, {
        spaceId,
        agentId,
        principalId: normalizeOptional(input.principalId),
        deviceId: normalizeOptional(input.deviceId),
        executionOrigin: input.executionOrigin,
        accessMode: input.accessMode,
        candidate,
      });
    }));

    return {
      spaceId,
      agentId,
      safetyProfileId: agentId
        ? (await resolveAgentSafetyProfile(this.profileReadDeps(), spaceId, agentId)).profileId
        : undefined,
      policyVersion: "tool_access_policy_v1",
      operations,
      dangerousCapabilities: await Promise.all(DANGEROUS_CAPABILITIES.map((capabilityId) => (
        describeDangerousCapability(
          this.dangerousCapabilityPolicyDeps(),
          {
            spaceId,
            agentId,
            capabilityId,
            principalId: normalizeOptional(input.principalId),
            accessMode: input.accessMode,
            executionOrigin: input.executionOrigin,
          },
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
    return evaluateToolOperationAccess({
      resolveProviders: (capability, spaceId) => this.resolveProviders(capability, spaceId),
      evaluateSelectorAvailability: (candidateInput) => this.evaluateSelectorAvailability(candidateInput),
      resolveGatewayCapabilityAccess: (candidateInput) => this.resolveGatewayCapabilityAccess(candidateInput),
      requiredDangerousCapability: (capability, operation) => (
        requiredDangerousCapability(this.options.cliToolService, capability, operation)
      ),
      isManagedCliTool: (capability, operation) => (
        isManagedCliTool(this.options.cliToolService, capability, operation)
      ),
      hasActiveToolApprovalGrant: (grantInput) => (
        this.options.toolApprovalGrantService?.hasActiveGrant(grantInput) ?? false
      ),
      evaluateDangerousCapability: (candidateInput) => this.evaluateDangerousCapability(candidateInput),
    }, input);
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

  private resolveCandidateOperations(spaceId: string): ToolAccessCandidateOperation[] {
    return resolveCandidateOperations(this.options.capabilities, spaceId);
  }

  private resolveProviders(capability: CapabilityType, spaceId: string): CapabilityProvider[] {
    return resolveProviders(this.options.capabilities, capability, spaceId);
  }

  private async evaluateSelectorAvailability(
    input: ToolSelectorAvailabilityInput,
  ): Promise<ToolAccessSelectorDecision> {
    return evaluateSelectorAvailabilityHelper(this.selectorAvailabilityDeps(), input);
  }

  private async evaluateSelectorsAgainstPolicies(input: {
    spaceId: string;
    agentId?: string;
    principalId?: string;
    deviceId?: string;
    selectors: string[];
    toolName: string;
  }): Promise<ToolAccessSelectorDecision> {
    return evaluateSelectorsAgainstPolicies(this.selectorPolicyEvaluationDeps(), input);
  }

  private async evaluateDangerousCapability(
    input: DangerousCapabilityAccessEvaluationInput,
  ): Promise<ToolAccessEvaluation> {
    return evaluateDangerousCapabilityHelper(this.dangerousCapabilityPolicyDeps(), input);
  }

  private selectorPolicyEvaluationDeps(): SelectorPolicyEvaluationDeps {
    return {
      getToolPolicy: (input) => this.getToolPolicy(input),
      resolveAgentPolicy: (spaceId, agentId) => (
        resolveAgentPolicyHelper(this.profileReadDeps(), spaceId, agentId)
      ),
      accessGrants: this.options.accessGrants,
    };
  }

  private selectorAvailabilityDeps(): ToolSelectorAvailabilityDeps {
    return {
      ...this.selectorPolicyEvaluationDeps(),
      buildSelectorIds: (input) => buildSelectorIds({
        ...input,
        cliToolService: this.options.cliToolService,
      }),
    };
  }

  private dangerousCapabilityPolicyDeps(): DangerousCapabilityPolicyDeps {
    return {
      spaceSharingService: this.options.spaceSharingService ?? null,
      getToolPolicy: (input) => this.getToolPolicy(input),
      resolveAgentSafetyProfile: (spaceId, agentId) => (
        resolveAgentSafetyProfile(this.profileReadDeps(), spaceId, agentId)
      ),
      resolveAgentPolicy: (spaceId, agentId) => (
        resolveAgentPolicyHelper(this.profileReadDeps(), spaceId, agentId)
      ),
      resolveSafetyProfile: (profileId) => resolveSafetyProfile(this.options.safetyProfiles, profileId),
    };
  }

  private profileReadDeps(): ToolAccessPolicyProfileReadDeps {
    return {
      spaceAdminService: this.options.spaceAdminService,
      safetyProfiles: this.options.safetyProfiles,
    };
  }

  resolveGatewayCapabilityAccess(input: {
    spaceId: string;
    principalId?: string;
    deviceId?: string;
    executionOrigin?: CapabilityExecutionOrigin;
    accessMode?: TurnRequestAccessMode;
    capability: CapabilityType;
    operation: string;
  }): GatewayCapabilityAccessDecision {
    return resolveGatewayCapabilityAccessHelper(this.gatewayCapabilityAccessEvaluatorDeps(), input);
  }

  private gatewayCapabilityAccessEvaluatorDeps(): GatewayCapabilityAccessEvaluatorDeps {
    return createGatewayCapabilityAccessEvaluatorDeps({
      gatewayProfile: this.gatewayProfile,
      defaultGatewayCoreState: this.defaultGatewayCoreState,
      gatewayCapabilityAccessService: this.options.gatewayCapabilityAccessService ?? null,
      spaceSharingService: this.options.spaceSharingService ?? null,
      getSpacePolicy: (spaceId) => this.getToolPolicy({ scopeType: "space", scopeId: spaceId }),
      requiredDangerousCapability: (capability, operation) => (
        requiredDangerousCapability(this.options.cliToolService, capability, operation)
      ),
      now: this.now,
    });
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
