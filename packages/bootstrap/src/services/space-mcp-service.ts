import { createHash } from "node:crypto";
import type {
  CapabilityProvider,
  CapabilityType,
  SpaceAdminService,
  SpaceAgentAssignment,
} from "@spaceskit/core";
import type { Logger } from "@spaceskit/observability";
import type {
  ProfileRepository,
  SpaceExternalAgentBindingRow,
  SpaceExternalAgentBindingRepository,
  SpaceMcpEndpointRepository,
  SpaceMcpEndpointRow,
  SpaceMcpTransport,
} from "@spaceskit/persistence";
import { MCPCapabilityProvider } from "@spaceskit/mcp-ai-sdk";
import type { GatewayCoreProfileId } from "@spaceskit/gateway-core";
import type { ProviderSecretRefService } from "./provider-secret-ref-service.js";

interface MappedProvider {
  providerId: string;
  provider: MCPCapabilityProvider;
  endpointId?: string;
  spaceId?: string;
}

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

export class SpaceMcpServiceError extends Error {
  readonly code:
    | "INVALID_ARGUMENT"
    | "NOT_FOUND"
    | "FAILED_PRECONDITION"
    | "ALREADY_EXISTS";

  constructor(code: SpaceMcpServiceError["code"], message: string) {
    super(message);
    this.code = code;
  }
}

export class SpaceMcpService {
  private readonly capabilities: SpaceMcpServiceOptions["capabilities"];
  private readonly spaceAdminService: SpaceAdminService;
  private readonly profileRepo?: ProfileRepository | null;
  private readonly endpointRepo?: SpaceMcpEndpointRepository | null;
  private readonly bindingRepo?: SpaceExternalAgentBindingRepository | null;
  private readonly providerSecretRefService?: ProviderSecretRefService;
  private readonly gatewayProfile: GatewayCoreProfileId;
  private readonly logger: Logger;
  private readonly globalFallback?: GlobalMcpFallbackConfig;
  private readonly mcpInvocationTimeoutMs: number;

  private readonly providersBySpaceId = new Map<string, MappedProvider>();
  private readonly providersByEndpointId = new Map<string, MappedProvider>();
  private readonly knownSpaceOverrideIds = new Set<string>();
  private globalProvider: MappedProvider | null = null;

  constructor(options: SpaceMcpServiceOptions) {
    this.capabilities = options.capabilities;
    this.spaceAdminService = options.spaceAdminService;
    this.profileRepo = options.profileRepo;
    this.endpointRepo = options.endpointRepo;
    this.bindingRepo = options.bindingRepo;
    this.providerSecretRefService = options.providerSecretRefService;
    this.gatewayProfile = options.gatewayProfile;
    this.logger = options.logger;
    this.globalFallback = options.globalFallback;
    this.mcpInvocationTimeoutMs = options.mcpInvocationTimeoutMs ?? 30_000;
  }

  async initialize(): Promise<void> {
    if (this.globalFallback) {
      await this.connectGlobalProvider(this.globalFallback);
    }

    if (this.endpointRepo) {
      const endpoints = this.endpointRepo.listEnabled();
      for (const endpoint of endpoints) {
        this.knownSpaceOverrideIds.add(endpoint.space_id);
        await this.connectSpaceProvider(endpoint);
      }
    }

    this.applyMcpRoutingPreferences();
  }

  isExternalProfile(): boolean {
    return this.gatewayProfile === "external";
  }

  isConfiguredForSpace(spaceId: string): boolean {
    return this.providersBySpaceId.has(spaceId) || this.globalProvider !== null;
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
    await this.assertSpaceExists(spaceId);
    this.assertValidSecretRef(secretRef);

    const row = endpointRepo.upsert({
      spaceId,
      transport,
      endpoint,
      argsJson: JSON.stringify(args),
      secretRef,
      enabled: input.enabled !== false,
    });
    this.knownSpaceOverrideIds.add(spaceId);

    if (row.enabled === 1) {
      await this.connectSpaceProvider(row);
    } else {
      await this.disconnectSpaceProvider(spaceId);
    }

    this.applyMcpRoutingPreferences();
    return mapEndpointRow(row);
  }

  async clearSpaceEndpoint(spaceIdRaw: string): Promise<boolean> {
    this.assertExternalProfile();
    const endpointRepo = this.requireEndpointRepo();
    const spaceId = requireNonEmpty(spaceIdRaw, "spaceId");
    const existing = endpointRepo.getBySpace(spaceId);
    const cleared = endpointRepo.clearBySpace(spaceId);

    await this.disconnectSpaceProvider(spaceId);

    if (existing?.endpoint_id && this.bindingRepo) {
      const assignments = await this.spaceAdminService.listAgentAssignments(spaceId).catch(() => []);
      for (const assignment of assignments) {
        const binding = this.bindingRepo.get(spaceId, assignment.agentId);
        if (binding?.endpoint_id === existing.endpoint_id) {
          this.bindingRepo.delete(spaceId, assignment.agentId);
        }
      }
    }

    this.applyMcpRoutingPreferences();
    return cleared;
  }

  async discoverSpaceAgents(spaceIdRaw: string): Promise<DiscoverSpaceMcpAgentsResult> {
    this.assertExternalProfile();
    const spaceId = requireNonEmpty(spaceIdRaw, "spaceId");
    await this.assertSpaceExists(spaceId);

    const provider = await this.resolveEffectiveProviderForSpace(spaceId);
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
    await this.assertSpaceExists(spaceId);

    const provider = await this.resolveEffectiveProviderForSpace(spaceId);
    if (!provider) {
      throw new SpaceMcpServiceError(
        "FAILED_PRECONDITION",
        `No MCP endpoint configured for space: ${spaceId}`,
      );
    }

    const materializedEndpoint = provider.endpointId
      ? provider.endpointId
      : await this.materializeGlobalEndpointForSpace(spaceId);

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
      binding: {
        runtimeKind: "external_mcp",
        spaceId: binding.space_id,
        agentId: binding.agent_id,
        endpointId: binding.endpoint_id,
        remoteAgentId: binding.remote_agent_id,
        displayName: normalizeOptional(binding.display_name),
        createdAt: binding.created_at,
        updatedAt: binding.updated_at,
      },
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
    return this.bindingRepo.listBySpace(spaceId).map((row: SpaceExternalAgentBindingRow) => ({
      runtimeKind: "external_mcp",
      spaceId: row.space_id,
      agentId: row.agent_id,
      endpointId: row.endpoint_id,
      remoteAgentId: row.remote_agent_id,
      displayName: normalizeOptional(row.display_name),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  getBinding(spaceIdRaw: string, agentIdRaw: string): ExternalAgentRuntimeBinding | null {
    if (!this.bindingRepo) return null;
    const spaceId = requireNonEmpty(spaceIdRaw, "spaceId");
    const agentId = requireNonEmpty(agentIdRaw, "agentId");
    const row = this.bindingRepo.get(spaceId, agentId);
    if (!row) return null;
    return {
      runtimeKind: "external_mcp",
      spaceId: row.space_id,
      agentId: row.agent_id,
      endpointId: row.endpoint_id,
      remoteAgentId: row.remote_agent_id,
      displayName: normalizeOptional(row.display_name),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
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

    const mapped = await this.resolveProviderForEndpoint(binding.endpointId);
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
      connectedSpaceEndpoints: this.providersBySpaceId.size,
      externalBindings: this.bindingRepo ? this.countBindings() : 0,
    };
  }

  private countBindings(): number {
    if (!this.bindingRepo || !this.endpointRepo) return 0;
    let total = 0;
    for (const endpoint of this.endpointRepo.listAll()) {
      total += this.bindingRepo.listBySpace(endpoint.space_id).length;
    }
    return total;
  }

  private async invokeWithTimeout(
    provider: MCPCapabilityProvider,
    operation: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new SpaceMcpServiceError(
          "FAILED_PRECONDITION",
          `MCP invocation timed out after ${this.mcpInvocationTimeoutMs}ms: ${operation}`,
        ));
      }, this.mcpInvocationTimeoutMs);
    });

    try {
      return await Promise.race([
        provider.invoke(operation, args),
        timeoutPromise,
      ]);
    } finally {
      clearTimeout(timer);
    }
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

  private async assertSpaceExists(spaceId: string): Promise<void> {
    const space = await this.spaceAdminService.getSpace(spaceId);
    if (!space) {
      throw new SpaceMcpServiceError("NOT_FOUND", `Space not found: ${spaceId}`);
    }
  }

  private async connectGlobalProvider(config: GlobalMcpFallbackConfig): Promise<void> {
    const provider = await this.createProvider({
      providerId: "mcp",
      displayName: "MCP (Global)",
      transport: config.transport,
      endpoint: config.endpoint,
      args: normalizeArgList(config.args),
      secretRef: normalizeOptional(config.secretRef),
    });

    this.globalProvider = { providerId: "mcp", provider };
    this.registerProvider(this.globalProvider);
    this.logger.info("Global MCP provider connected", {
      providerId: "mcp",
      endpoint: config.endpoint,
      transport: config.transport,
    });
  }

  private async connectSpaceProvider(endpoint: SpaceMcpEndpointRow): Promise<void> {
    await this.disconnectSpaceProvider(endpoint.space_id);
    try {
      const providerId = providerIdForSpace(endpoint.space_id);
      const provider = await this.createProvider({
        providerId,
        displayName: `MCP (${endpoint.space_id})`,
        transport: parseTransport(endpoint.transport),
        endpoint: endpoint.endpoint,
        args: parseArgsJson(endpoint.args_json),
        secretRef: normalizeOptional(endpoint.secret_ref),
      });

      const mapped: MappedProvider = {
        providerId,
        provider,
        endpointId: endpoint.endpoint_id,
        spaceId: endpoint.space_id,
      };
      this.providersBySpaceId.set(endpoint.space_id, mapped);
      this.providersByEndpointId.set(endpoint.endpoint_id, mapped);
      this.registerProvider(mapped);
      this.endpointRepo?.updateHealth({
        endpointId: endpoint.endpoint_id,
        healthStatus: "ok",
        healthMessage: "Connected",
        lastConnectedAt: new Date().toISOString(),
        lastErrorAt: null,
      });
      this.logger.info("Space MCP provider connected", {
        spaceId: endpoint.space_id,
        endpointId: endpoint.endpoint_id,
        providerId,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.endpointRepo?.updateHealth({
        endpointId: endpoint.endpoint_id,
        healthStatus: "error",
        healthMessage: message,
        lastErrorAt: new Date().toISOString(),
      });
      throw err;
    }
  }

  private async disconnectSpaceProvider(spaceId: string): Promise<void> {
    const existing = this.providersBySpaceId.get(spaceId);
    if (!existing) return;

    this.capabilities.deregister(existing.providerId);
    await existing.provider.disconnect().catch(() => undefined);
    this.providersBySpaceId.delete(spaceId);
    if (existing.endpointId) {
      this.providersByEndpointId.delete(existing.endpointId);
    }
  }

  private registerProvider(mapped: MappedProvider): void {
    this.capabilities.register(mapped.provider, {
      invoke: async (operation, args) => mapped.provider.invoke(operation, args),
    });
  }

  private applyMcpRoutingPreferences(): void {
    const defaults: Partial<Record<CapabilityType, string>> = {};
    (defaults as Record<string, string | undefined>).mcp = this.globalProvider?.providerId;

    const spaceOverrides: Record<string, Partial<Record<CapabilityType, string>>> = {};
    for (const spaceId of this.knownSpaceOverrideIds) {
      spaceOverrides[spaceId] = {};
    }
    for (const [spaceId, mapped] of this.providersBySpaceId) {
      spaceOverrides[spaceId] = { mcp: mapped.providerId };
    }

    this.capabilities.setPreferences({
      defaults,
      spaceOverrides,
    });
  }

  private async resolveEffectiveProviderForSpace(spaceId: string): Promise<MappedProvider | null> {
    const spaceMapped = this.providersBySpaceId.get(spaceId);
    if (spaceMapped) {
      return spaceMapped;
    }
    return this.globalProvider;
  }

  private async resolveProviderForEndpoint(endpointId: string): Promise<MappedProvider | null> {
    const cached = this.providersByEndpointId.get(endpointId);
    if (cached) return cached;
    if (!this.endpointRepo) return null;

    const endpoint = this.endpointRepo.getByEndpointId(endpointId);
    if (!endpoint || endpoint.enabled !== 1) return null;
    await this.connectSpaceProvider(endpoint);
    return this.providersByEndpointId.get(endpointId) ?? null;
  }

  private assertValidSecretRef(secretRef?: string): void {
    if (!secretRef) return;
    if (!this.providerSecretRefService) {
      throw new SpaceMcpServiceError(
        "FAILED_PRECONDITION",
        "Provider secret ref service unavailable for MCP endpoint auth.",
      );
    }
    const summary = this.providerSecretRefService.getSecretRef(secretRef);
    if (!summary) {
      throw new SpaceMcpServiceError("NOT_FOUND", `Unknown MCP secret ref: ${secretRef}`);
    }
    if (summary.providerId !== "mcp") {
      throw new SpaceMcpServiceError(
        "FAILED_PRECONDITION",
        `MCP endpoint secret ref provider mismatch: expected mcp, got ${summary.providerId}`,
      );
    }
  }

  private resolveSecret(secretRef?: string): string | undefined {
    if (!secretRef) return undefined;
    this.assertValidSecretRef(secretRef);
    const resolved = this.providerSecretRefService!.resolveSecret(secretRef);
    if (!resolved) {
      throw new SpaceMcpServiceError("NOT_FOUND", `MCP secret ref not found: ${secretRef}`);
    }
    return resolved.secret;
  }

  private async createProvider(input: {
    providerId: string;
    displayName: string;
    transport: SpaceMcpTransport;
    endpoint: string;
    args: string[];
    secretRef?: string;
  }): Promise<MCPCapabilityProvider> {
    const token = this.resolveSecret(input.secretRef);
    const provider = new MCPCapabilityProvider({
      id: input.providerId,
      name: input.displayName,
      capabilityType: "mcp",
      transport: input.transport,
      endpoint: input.endpoint,
      args: input.args,
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      env: token ? { SPACESKIT_MCP_TOKEN: token } : undefined,
    });

    try {
      await provider.connect();
      return provider;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn("Failed to connect MCP provider", {
        providerId: input.providerId,
        endpoint: input.endpoint,
        transport: input.transport,
        error: message,
      });
      throw new SpaceMcpServiceError(
        "FAILED_PRECONDITION",
        `Failed to connect MCP endpoint (${input.transport}): ${message}`,
      );
    }
  }

  private async materializeGlobalEndpointForSpace(spaceId: string): Promise<string> {
    const endpointRepo = this.requireEndpointRepo();
    if (!this.globalFallback) {
      throw new SpaceMcpServiceError(
        "FAILED_PRECONDITION",
        `Cannot bind external MCP agent without a per-space endpoint: ${spaceId}`,
      );
    }

    const row = endpointRepo.upsert({
      spaceId,
      transport: this.globalFallback.transport,
      endpoint: this.globalFallback.endpoint,
      argsJson: JSON.stringify(normalizeArgList(this.globalFallback.args)),
      secretRef: normalizeOptional(this.globalFallback.secretRef),
      enabled: true,
    });
    this.knownSpaceOverrideIds.add(spaceId);
    await this.connectSpaceProvider(row);
    this.applyMcpRoutingPreferences();
    return row.endpoint_id;
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
      modelHint: "mcp/external-agent",
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

function providerIdForSpace(spaceId: string): string {
  return `mcp-space-${spaceId}`;
}

function mapEndpointRow(row: SpaceMcpEndpointRow): SpaceMcpEndpointConfig {
  return {
    endpointId: row.endpoint_id,
    spaceId: row.space_id,
    transport: parseTransport(row.transport),
    endpoint: row.endpoint,
    args: parseArgsJson(row.args_json),
    secretRef: normalizeOptional(row.secret_ref),
    enabled: row.enabled === 1,
    healthStatus: parseHealthStatus(row.health_status),
    healthMessage: normalizeOptional(row.health_message),
    lastConnectedAt: row.last_connected_at ?? undefined,
    lastErrorAt: row.last_error_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function parseDiscoveredAgents(raw: unknown): McpDiscoveredAgent[] {
  const root = isRecord(raw) ? raw : {};
  const candidates = Array.isArray(raw)
    ? raw
    : Array.isArray(root.agents)
    ? root.agents
    : [];

  const result: McpDiscoveredAgent[] = [];
  const seen = new Set<string>();
  for (const entry of candidates) {
    if (!isRecord(entry)) continue;
    const remoteAgentId = normalizeOptional(
      toStringOrUndefined(entry.remoteAgentId)
      ?? toStringOrUndefined(entry.agentId)
      ?? toStringOrUndefined(entry.id),
    );
    if (!remoteAgentId) continue;
    const key = remoteAgentId.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({
      remoteAgentId,
      displayName: normalizeOptional(
        toStringOrUndefined(entry.displayName)
        ?? toStringOrUndefined(entry.name)
        ?? toStringOrUndefined(entry.label),
      ) ?? remoteAgentId,
      description: normalizeOptional(toStringOrUndefined(entry.description)),
      metadata: isRecord(entry.metadata) ? entry.metadata : undefined,
    });
  }
  return result;
}

export function normalizeMcpToolPayload(raw: unknown): unknown {
  const record = isRecord(raw) ? raw : null;
  if (!record) {
    return raw;
  }

  if (isRecord(record.structuredContent)) {
    return record.structuredContent;
  }

  const content = Array.isArray(record.content) ? record.content : [];
  const firstText = content
    .filter((entry): entry is Record<string, unknown> => isRecord(entry))
    .map((entry) => entry.text)
    .find((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);

  if (!firstText) {
    return raw;
  }

  try {
    return JSON.parse(firstText);
  } catch {
    return { text: firstText };
  }
}

function parseArgsJson(raw: string): string[] {
  if (!raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  } catch {
    return [];
  }
}

function normalizeArgList(values?: string[]): string[] {
  if (!values) return [];
  return values
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

function parseTransport(value: string): SpaceMcpTransport {
  if (value === "sse" || value === "stdio") {
    return value;
  }
  throw new SpaceMcpServiceError("INVALID_ARGUMENT", `Unsupported MCP transport: ${value}`);
}

function parseHealthStatus(value: string): "unknown" | "ok" | "degraded" | "error" {
  if (value === "ok" || value === "degraded" || value === "error") {
    return value;
  }
  return "unknown";
}

function requireNonEmpty(value: string, field: string): string {
  const normalized = normalizeOptional(value);
  if (!normalized) {
    throw new SpaceMcpServiceError("INVALID_ARGUMENT", `${field} is required`);
  }
  return normalized;
}

function normalizeOptional(value?: string): string | undefined {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : undefined;
}

function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

function toStringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
