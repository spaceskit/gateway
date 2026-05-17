import type {
  CapabilityProvider,
  CapabilityType,
  SpaceAdminService,
  SpaceAgentAssignment,
} from "@spaceskit/core";
import type { Logger } from "@spaceskit/observability";
import type {
  ProfileRepository,
  SpaceExternalAgentBindingRepository,
  SpaceMcpEndpointRepository,
  SpaceMcpTransport,
} from "@spaceskit/persistence";
import type { GatewayCoreProfileId } from "@spaceskit/gateway-core";
import type { ProviderSecretRefService } from "./provider-secret-ref-service.js";
import {
  assertMcpSpaceExists,
  assertValidMcpSecretRef,
  countExternalMcpBindings,
  invokeMcpWithTimeout,
  mapEndpointRow,
  mapExternalAgentBinding,
  normalizeArgList,
  normalizeMcpToolPayload,
  normalizeOptional,
  parseDiscoveredAgents,
  parseTransport,
  requireNonEmpty,
  shortHash,
  SpaceMcpProviderRegistry,
  SpaceMcpServiceError,
} from "./space-mcp-service-helpers.js";

export { normalizeMcpToolPayload, SpaceMcpServiceError };

export interface GlobalMcpFallbackConfig {
  transport: SpaceMcpTransport;
  endpoint: string;
  args?: string[];
  secretRef?: string;
}

export interface SpaceMcpEndpointConfig {
  endpointId: string;
  spaceId: string;
  transport: SpaceMcpTransport;
  endpoint: string;
  args: string[];
  secretRef?: string;
  enabled: boolean;
  healthStatus: "unknown" | "ok" | "degraded" | "error";
  healthMessage?: string;
  lastConnectedAt?: string;
  lastErrorAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SetSpaceMcpEndpointInput {
  spaceId: string;
  transport: SpaceMcpTransport;
  endpoint: string;
  args?: string[];
  secretRef?: string;
  enabled?: boolean;
}

export interface DiscoverSpaceMcpAgentsResult {
  endpointId?: string;
  agents: McpDiscoveredAgent[];
}

export interface McpDiscoveredAgent {
  remoteAgentId: string;
  displayName: string;
  description?: string;
  metadata?: Record<string, unknown>;
}

export interface ExternalAgentRuntimeBinding {
  runtimeKind: "external_mcp";
  spaceId: string;
  agentId: string;
  endpointId: string;
  remoteAgentId: string;
  displayName?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ApproveSpaceMcpAgentInput {
  spaceId: string;
  remoteAgentId: string;
  displayName?: string;
  agentId?: string;
  profileId?: string;
}

export interface ApproveSpaceMcpAgentResult {
  assignment: SpaceAgentAssignment;
  binding: ExternalAgentRuntimeBinding;
}

export interface SpaceMcpServiceOptions {
  capabilities: {
    register: (provider: CapabilityProvider, handler: {
      invoke: (operation: string, args: Record<string, unknown>) => Promise<unknown>;
    }) => void;
    deregister: (providerId: string) => void;
    setPreferences: (prefs: {
      defaults?: Partial<Record<CapabilityType, string>>;
      spaceOverrides?: Record<string, Partial<Record<CapabilityType, string>>>;
    }) => void;
  };
  spaceAdminService: SpaceAdminService;
  profileRepo?: ProfileRepository | null;
  endpointRepo?: SpaceMcpEndpointRepository | null;
  bindingRepo?: SpaceExternalAgentBindingRepository | null;
  providerSecretRefService?: ProviderSecretRefService;
  gatewayProfile: GatewayCoreProfileId;
  logger: Logger;
  globalFallback?: GlobalMcpFallbackConfig;
  /** Timeout in ms for MCP invocations. Default: 30000 (30s). */
  mcpInvocationTimeoutMs?: number;
}

export class SpaceMcpService {
  private readonly spaceAdminService: SpaceAdminService;
  private readonly profileRepo?: ProfileRepository | null;
  private readonly endpointRepo?: SpaceMcpEndpointRepository | null;
  private readonly bindingRepo?: SpaceExternalAgentBindingRepository | null;
  private readonly providerSecretRefService?: ProviderSecretRefService;
  private readonly gatewayProfile: GatewayCoreProfileId;
  private readonly mcpInvocationTimeoutMs: number;
  private readonly providerRegistry: SpaceMcpProviderRegistry;

  constructor(options: SpaceMcpServiceOptions) {
    this.spaceAdminService = options.spaceAdminService;
    this.profileRepo = options.profileRepo;
    this.endpointRepo = options.endpointRepo;
    this.bindingRepo = options.bindingRepo;
    this.providerSecretRefService = options.providerSecretRefService;
    this.gatewayProfile = options.gatewayProfile;
    this.mcpInvocationTimeoutMs = options.mcpInvocationTimeoutMs ?? 30_000;
    this.providerRegistry = new SpaceMcpProviderRegistry({
      capabilities: options.capabilities,
      endpointRepo: options.endpointRepo,
      providerSecretRefService: options.providerSecretRefService,
      logger: options.logger,
      globalFallback: options.globalFallback,
    });
  }

  async initialize(): Promise<void> {
    const globalFallback = this.providerRegistry.globalFallback;
    if (globalFallback) {
      await this.providerRegistry.connectGlobalProvider(globalFallback);
    }

    if (this.endpointRepo) {
      const endpoints = this.endpointRepo.listEnabled();
      for (const endpoint of endpoints) {
        this.providerRegistry.addKnownSpaceOverride(endpoint.space_id);
        await this.providerRegistry.connectSpaceProvider(endpoint);
      }
    }

    this.providerRegistry.applyMcpRoutingPreferences();
  }

  isExternalProfile(): boolean {
    return this.gatewayProfile === "external";
  }

  isConfiguredForSpace(spaceId: string): boolean {
    return this.providerRegistry.isConfiguredForSpace(spaceId);
  }

  getSpaceEndpoint(spaceIdRaw: string): SpaceMcpEndpointConfig | null {
    const spaceId = requireNonEmpty(spaceIdRaw, "spaceId");
    if (!this.endpointRepo) return null;
    const row = this.endpointRepo.getBySpace(spaceId);
    return row ? mapEndpointRow(row) : null;
  }

  async setSpaceEndpoint(input: SetSpaceMcpEndpointInput): Promise<SpaceMcpEndpointConfig> {
    this.assertExternalProfile();
    const endpointRepo = this.requireEndpointRepo();
    const spaceId = requireNonEmpty(input.spaceId, "spaceId");
    const endpoint = requireNonEmpty(input.endpoint, "endpoint");
    const transport = parseTransport(input.transport);
    const args = normalizeArgList(input.args);
    const secretRef = normalizeOptional(input.secretRef);
    await assertMcpSpaceExists(this.spaceAdminService, spaceId);
    assertValidMcpSecretRef(secretRef, this.providerSecretRefService);

    const row = endpointRepo.upsert({
      spaceId,
      transport,
      endpoint,
      argsJson: JSON.stringify(args),
      secretRef,
      enabled: input.enabled !== false,
    });
    this.providerRegistry.addKnownSpaceOverride(spaceId);

    if (row.enabled === 1) {
      await this.providerRegistry.connectSpaceProvider(row);
    } else {
      await this.providerRegistry.disconnectSpaceProvider(spaceId);
    }

    this.providerRegistry.applyMcpRoutingPreferences();
    return mapEndpointRow(row);
  }

  async clearSpaceEndpoint(spaceIdRaw: string): Promise<boolean> {
    this.assertExternalProfile();
    const endpointRepo = this.requireEndpointRepo();
    const spaceId = requireNonEmpty(spaceIdRaw, "spaceId");
    const existing = endpointRepo.getBySpace(spaceId);
    const cleared = endpointRepo.clearBySpace(spaceId);

    await this.providerRegistry.disconnectSpaceProvider(spaceId);

    if (existing?.endpoint_id && this.bindingRepo) {
      const assignments = await this.spaceAdminService.listAgentAssignments(spaceId).catch(() => []);
      for (const assignment of assignments) {
        const binding = this.bindingRepo.get(spaceId, assignment.agentId);
        if (binding?.endpoint_id === existing.endpoint_id) {
          this.bindingRepo.delete(spaceId, assignment.agentId);
        }
      }
    }

    this.providerRegistry.applyMcpRoutingPreferences();
    return cleared;
  }

  async discoverSpaceAgents(spaceIdRaw: string): Promise<DiscoverSpaceMcpAgentsResult> {
    this.assertExternalProfile();
    const spaceId = requireNonEmpty(spaceIdRaw, "spaceId");
    await assertMcpSpaceExists(this.spaceAdminService, spaceId);

    const provider = this.providerRegistry.resolveEffectiveProviderForSpace(spaceId);
    if (!provider) {
      throw new SpaceMcpServiceError(
        "FAILED_PRECONDITION",
        `No MCP endpoint configured for space: ${spaceId}`,
      );
    }

    const raw = normalizeMcpToolPayload(
      await this.invokeWithTimeout(provider.provider, "spaceskit.agent.list", {}),
    );
    return {
      endpointId: provider.endpointId,
      agents: parseDiscoveredAgents(raw),
    };
  }

  async approveSpaceAgent(input: ApproveSpaceMcpAgentInput): Promise<ApproveSpaceMcpAgentResult> {
    this.assertExternalProfile();
    const bindingRepo = this.requireBindingRepo();
    const spaceId = requireNonEmpty(input.spaceId, "spaceId");
    const remoteAgentId = requireNonEmpty(input.remoteAgentId, "remoteAgentId");
    await assertMcpSpaceExists(this.spaceAdminService, spaceId);

    const provider = this.providerRegistry.resolveEffectiveProviderForSpace(spaceId);
    if (!provider) {
      throw new SpaceMcpServiceError(
        "FAILED_PRECONDITION",
        `No MCP endpoint configured for space: ${spaceId}`,
      );
    }

    const materializedEndpoint = provider.endpointId
      ? provider.endpointId
      : await this.providerRegistry.materializeGlobalEndpointForSpace(spaceId);

    const displayName = normalizeOptional(input.displayName) ?? remoteAgentId;
    const profileId = await this.ensureExternalProfile({
      profileId: normalizeOptional(input.profileId),
      spaceId,
      remoteAgentId,
      displayName,
    });
    const agentId = normalizeOptional(input.agentId)
      ?? `external-mcp-${shortHash(`${spaceId}:${remoteAgentId}`)}`;
    const assignment = await this.ensureAssignment({
      spaceId,
      agentId,
      profileId,
    });

    const binding = bindingRepo.upsert({
      spaceId,
      agentId,
      endpointId: materializedEndpoint,
      remoteAgentId,
      displayName,
    });

    return {
      assignment,
      binding: mapExternalAgentBinding(binding),
    };
  }

  removeBinding(spaceIdRaw: string, agentIdRaw: string): boolean {
    if (!this.bindingRepo) return false;
    const spaceId = requireNonEmpty(spaceIdRaw, "spaceId");
    const agentId = requireNonEmpty(agentIdRaw, "agentId");
    return this.bindingRepo.delete(spaceId, agentId);
  }

  listBindings(spaceIdRaw: string): ExternalAgentRuntimeBinding[] {
    if (!this.bindingRepo) return [];
    const spaceId = requireNonEmpty(spaceIdRaw, "spaceId");
    return this.bindingRepo.listBySpace(spaceId).map(mapExternalAgentBinding);
  }

  getBinding(spaceIdRaw: string, agentIdRaw: string): ExternalAgentRuntimeBinding | null {
    if (!this.bindingRepo) return null;
    const spaceId = requireNonEmpty(spaceIdRaw, "spaceId");
    const agentId = requireNonEmpty(agentIdRaw, "agentId");
    const row = this.bindingRepo.get(spaceId, agentId);
    if (!row) return null;
    return mapExternalAgentBinding(row);
  }

  async invokeExternalAgentTurn(input: {
    spaceId: string;
    agentId: string;
    turnId: string;
    messages: Array<Record<string, unknown>>;
    lineageId: string;
    hopCount: number;
    maxHops: number;
    principalId?: string;
    deviceId?: string;
  }): Promise<unknown> {
    this.assertExternalProfile();
    const binding = this.getBinding(input.spaceId, input.agentId);
    if (!binding) {
      throw new SpaceMcpServiceError(
        "FAILED_PRECONDITION",
        `No external MCP binding for ${input.spaceId}/${input.agentId}`,
      );
    }

    const mapped = await this.providerRegistry.resolveProviderForEndpoint(binding.endpointId);
    if (!mapped) {
      throw new SpaceMcpServiceError(
        "FAILED_PRECONDITION",
        `External MCP endpoint unavailable for binding ${binding.endpointId}`,
      );
    }

    const raw = await this.invokeWithTimeout(mapped.provider, "spaceskit.agent.execute_turn", {
      remoteAgentId: binding.remoteAgentId,
      spaceId: input.spaceId,
      turnId: input.turnId,
      messages: input.messages,
      lineageId: input.lineageId,
      hopCount: input.hopCount,
      maxHops: input.maxHops,
      principalId: input.principalId,
      deviceId: input.deviceId,
    });
    return normalizeMcpToolPayload(raw);
  }

  getHealthStats(): {
    configuredSpaceEndpoints: number;
    connectedSpaceEndpoints: number;
    externalBindings: number;
  } {
    return {
      configuredSpaceEndpoints: this.endpointRepo?.listAll().length ?? 0,
      connectedSpaceEndpoints: this.providerRegistry.connectedSpaceEndpoints,
      externalBindings: countExternalMcpBindings({
        endpointRepo: this.endpointRepo,
        bindingRepo: this.bindingRepo,
      }),
    };
  }

  private invokeWithTimeout(
    provider: Parameters<typeof invokeMcpWithTimeout>[0]["provider"],
    operation: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    return invokeMcpWithTimeout({
      provider,
      operation,
      args,
      timeoutMs: this.mcpInvocationTimeoutMs,
    });
  }

  private assertExternalProfile(): void {
    if (!this.isExternalProfile()) {
      throw new SpaceMcpServiceError(
        "FAILED_PRECONDITION",
        "MCP endpoint management requires external gateway profile.",
      );
    }
  }

  private requireEndpointRepo(): SpaceMcpEndpointRepository {
    if (!this.endpointRepo) {
      throw new SpaceMcpServiceError(
        "FAILED_PRECONDITION",
        "Space MCP endpoint persistence is unavailable.",
      );
    }
    return this.endpointRepo;
  }

  private requireBindingRepo(): SpaceExternalAgentBindingRepository {
    if (!this.bindingRepo) {
      throw new SpaceMcpServiceError(
        "FAILED_PRECONDITION",
        "Space external MCP binding persistence is unavailable.",
      );
    }
    return this.bindingRepo;
  }

  private async ensureExternalProfile(input: {
    profileId?: string;
    spaceId: string;
    remoteAgentId: string;
    displayName: string;
  }): Promise<string> {
    if (!this.profileRepo) {
      throw new SpaceMcpServiceError(
        "FAILED_PRECONDITION",
        "Profile repository unavailable for external MCP agent approval.",
      );
    }

    const profileId = input.profileId
      ?? `profile-external-mcp-${shortHash(`${input.spaceId}:${input.remoteAgentId}`)}`;
    const existing = this.profileRepo.getById(profileId);
    if (existing) {
      return profileId;
    }

    this.profileRepo.create({
      profileId,
      name: input.displayName,
      description: `External MCP agent (${input.remoteAgentId})`,
      canModerate: false,
      personalityPrompt: `External MCP agent proxy for ${input.displayName}.`,
      providerHint: "mcp",
      modelConfig: {
        preferredModels: ["mcp/external-agent"],
        fallbackModels: [],
      },
      source: "external_mcp",
    });
    return profileId;
  }

  private async ensureAssignment(input: {
    spaceId: string;
    agentId: string;
    profileId: string;
  }): Promise<SpaceAgentAssignment> {
    const existingAssignments = await this.spaceAdminService.listAgentAssignments(input.spaceId);
    const existing = existingAssignments.find((entry) => entry.agentId === input.agentId);
    if (!existing) {
      return this.spaceAdminService.addAgent({
        spaceId: input.spaceId,
        agentId: input.agentId,
        profileId: input.profileId,
        role: "participant",
        isPrimary: false,
      });
    }

    return this.spaceAdminService.updateAgentAssignment({
      spaceId: input.spaceId,
      agentId: input.agentId,
      profileId: input.profileId,
      role: "participant",
      isPrimary: false,
    });
  }
}
