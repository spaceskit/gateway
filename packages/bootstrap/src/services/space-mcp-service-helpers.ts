import { createHash } from "node:crypto";
import type { CapabilityProvider, CapabilityType, SpaceAdminService } from "@spaceskit/core";
import { MCPCapabilityProvider } from "@spaceskit/mcp-ai-sdk";
import type { Logger } from "@spaceskit/observability";
import type {
  SpaceExternalAgentBindingRow,
  SpaceExternalAgentBindingRepository,
  SpaceMcpEndpointRepository,
  SpaceMcpEndpointRow,
  SpaceMcpTransport,
} from "@spaceskit/persistence";
import type { ProviderSecretRefService } from "./provider-secret-ref-service.js";
import type {
  ExternalAgentRuntimeBinding,
  GlobalMcpFallbackConfig,
  McpDiscoveredAgent,
  SpaceMcpEndpointConfig,
} from "./space-mcp-service-impl.js";

export interface MappedProvider {
  providerId: string;
  provider: MCPCapabilityProvider;
  endpointId?: string;
  spaceId?: string;
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

export function mapEndpointRow(row: SpaceMcpEndpointRow): SpaceMcpEndpointConfig {
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

export function mapExternalAgentBinding(row: SpaceExternalAgentBindingRow): ExternalAgentRuntimeBinding {
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

export function parseDiscoveredAgents(raw: unknown): McpDiscoveredAgent[] {
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

export function parseArgsJson(raw: string): string[] {
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

export function normalizeArgList(values?: string[]): string[] {
  if (!values) return [];
  return values
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

export function parseTransport(value: string): SpaceMcpTransport {
  if (value === "sse" || value === "stdio") {
    return value;
  }
  throw new SpaceMcpServiceError("INVALID_ARGUMENT", `Unsupported MCP transport: ${value}`);
}

export function requireNonEmpty(value: string, field: string): string {
  const normalized = normalizeOptional(value);
  if (!normalized) {
    throw new SpaceMcpServiceError("INVALID_ARGUMENT", `${field} is required`);
  }
  return normalized;
}

export function normalizeOptional(value?: string): string | undefined {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : undefined;
}

export function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

export function providerIdForSpace(spaceId: string): string {
  return `mcp-space-${spaceId}`;
}

export async function assertMcpSpaceExists(
  spaceAdminService: SpaceAdminService,
  spaceId: string,
): Promise<void> {
  const space = await spaceAdminService.getSpace(spaceId);
  if (!space) {
    throw new SpaceMcpServiceError("NOT_FOUND", `Space not found: ${spaceId}`);
  }
}

export function countExternalMcpBindings(input: {
  endpointRepo?: SpaceMcpEndpointRepository | null;
  bindingRepo?: SpaceExternalAgentBindingRepository | null;
}): number {
  if (!input.bindingRepo || !input.endpointRepo) return 0;
  let total = 0;
  for (const endpoint of input.endpointRepo.listAll()) {
    total += input.bindingRepo.listBySpace(endpoint.space_id).length;
  }
  return total;
}

export async function invokeMcpWithTimeout(input: {
  provider: MCPCapabilityProvider;
  operation: string;
  args: Record<string, unknown>;
  timeoutMs: number;
}): Promise<unknown> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new SpaceMcpServiceError(
        "FAILED_PRECONDITION",
        `MCP invocation timed out after ${input.timeoutMs}ms: ${input.operation}`,
      ));
    }, input.timeoutMs);
  });

  try {
    return await Promise.race([
      input.provider.invoke(input.operation, input.args),
      timeoutPromise,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export function assertValidMcpSecretRef(
  secretRef: string | undefined,
  providerSecretRefService: ProviderSecretRefService | undefined,
): void {
  if (!secretRef) return;
  if (!providerSecretRefService) {
    throw new SpaceMcpServiceError(
      "FAILED_PRECONDITION",
      "Provider secret ref service unavailable for MCP endpoint auth.",
    );
  }
  const summary = providerSecretRefService.getSecretRef(secretRef);
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

export class SpaceMcpProviderRegistry {
  private readonly providersBySpaceId = new Map<string, MappedProvider>();
  private readonly providersByEndpointId = new Map<string, MappedProvider>();
  private readonly knownSpaceOverrideIds = new Set<string>();
  private globalProvider: MappedProvider | null = null;

  constructor(private readonly input: {
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
    endpointRepo?: SpaceMcpEndpointRepository | null;
    providerSecretRefService?: ProviderSecretRefService;
    logger: Logger;
    globalFallback?: GlobalMcpFallbackConfig;
  }) {}

  get globalFallback(): GlobalMcpFallbackConfig | undefined {
    return this.input.globalFallback;
  }

  isConfiguredForSpace(spaceId: string): boolean {
    return this.providersBySpaceId.has(spaceId) || this.globalProvider !== null;
  }

  addKnownSpaceOverride(spaceId: string): void {
    this.knownSpaceOverrideIds.add(spaceId);
  }

  async connectGlobalProvider(config: GlobalMcpFallbackConfig): Promise<void> {
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
    this.input.logger.info("Global MCP provider connected", {
      providerId: "mcp",
      endpoint: config.endpoint,
      transport: config.transport,
    });
  }

  async connectSpaceProvider(endpoint: SpaceMcpEndpointRow): Promise<void> {
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
      this.input.endpointRepo?.updateHealth({
        endpointId: endpoint.endpoint_id,
        healthStatus: "ok",
        healthMessage: "Connected",
        lastConnectedAt: new Date().toISOString(),
        lastErrorAt: null,
      });
      this.input.logger.info("Space MCP provider connected", {
        spaceId: endpoint.space_id,
        endpointId: endpoint.endpoint_id,
        providerId,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.input.endpointRepo?.updateHealth({
        endpointId: endpoint.endpoint_id,
        healthStatus: "error",
        healthMessage: message,
        lastErrorAt: new Date().toISOString(),
      });
      throw err;
    }
  }

  async disconnectSpaceProvider(spaceId: string): Promise<void> {
    const existing = this.providersBySpaceId.get(spaceId);
    if (!existing) return;

    this.input.capabilities.deregister(existing.providerId);
    await existing.provider.disconnect().catch(() => undefined);
    this.providersBySpaceId.delete(spaceId);
    if (existing.endpointId) {
      this.providersByEndpointId.delete(existing.endpointId);
    }
  }

  applyMcpRoutingPreferences(): void {
    const defaults: Partial<Record<CapabilityType, string>> = {};
    (defaults as Record<string, string | undefined>).mcp = this.globalProvider?.providerId;

    const spaceOverrides: Record<string, Partial<Record<CapabilityType, string>>> = {};
    for (const spaceId of this.knownSpaceOverrideIds) {
      spaceOverrides[spaceId] = {};
    }
    for (const [spaceId, mapped] of this.providersBySpaceId) {
      spaceOverrides[spaceId] = { mcp: mapped.providerId };
    }

    this.input.capabilities.setPreferences({
      defaults,
      spaceOverrides,
    });
  }

  resolveEffectiveProviderForSpace(spaceId: string): MappedProvider | null {
    return this.providersBySpaceId.get(spaceId) ?? this.globalProvider;
  }

  async resolveProviderForEndpoint(endpointId: string): Promise<MappedProvider | null> {
    const cached = this.providersByEndpointId.get(endpointId);
    if (cached) return cached;
    if (!this.input.endpointRepo) return null;

    const endpoint = this.input.endpointRepo.getByEndpointId(endpointId);
    if (!endpoint || endpoint.enabled !== 1) return null;
    await this.connectSpaceProvider(endpoint);
    return this.providersByEndpointId.get(endpointId) ?? null;
  }

  async materializeGlobalEndpointForSpace(spaceId: string): Promise<string> {
    if (!this.input.endpointRepo || !this.input.globalFallback) {
      throw new SpaceMcpServiceError(
        "FAILED_PRECONDITION",
        `Cannot bind external MCP agent without a per-space endpoint: ${spaceId}`,
      );
    }

    const row = this.input.endpointRepo.upsert({
      spaceId,
      transport: this.input.globalFallback.transport,
      endpoint: this.input.globalFallback.endpoint,
      argsJson: JSON.stringify(normalizeArgList(this.input.globalFallback.args)),
      secretRef: normalizeOptional(this.input.globalFallback.secretRef),
      enabled: true,
    });
    this.knownSpaceOverrideIds.add(spaceId);
    await this.connectSpaceProvider(row);
    this.applyMcpRoutingPreferences();
    return row.endpoint_id;
  }

  get connectedSpaceEndpoints(): number {
    return this.providersBySpaceId.size;
  }

  private registerProvider(mapped: MappedProvider): void {
    this.input.capabilities.register(mapped.provider, {
      invoke: async (operation, args) => mapped.provider.invoke(operation, args),
    });
  }

  private resolveSecret(secretRef?: string): string | undefined {
    if (!secretRef) return undefined;
    assertValidMcpSecretRef(secretRef, this.input.providerSecretRefService);
    const resolved = this.input.providerSecretRefService!.resolveSecret(secretRef);
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
      this.input.logger.warn("Failed to connect MCP provider", {
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
}

function parseHealthStatus(value: string): "unknown" | "ok" | "degraded" | "error" {
  if (value === "ok" || value === "degraded" || value === "error") {
    return value;
  }
  return "unknown";
}

function toStringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
