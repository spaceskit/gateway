import type {
  GatewayModelProviderCatalogPayload,
} from "@spaceskit/server";
import type {
  ProviderRuntimeConfig,
} from "./gateway-admin-service.js";
import type {
  OpenAICompatibleDetectionResult,
  DiscoveredLocalAgent,
} from "./services/local-agent-discovery-service.js";
import type {
  ClaudeAgentSdkCatalogProbe,
  CodexAppServerCatalogProbe,
} from "./gateway-admin-telemetry-normalizers.js";
import {
  cloneGatewayModelProviderCatalog,
} from "./gateway-admin-telemetry-normalizers.js";
import {
  DEFAULT_MODEL_BY_PROVIDER,
  isOpenAICompatibleProvider,
} from "./services/provider-catalog-support.js";
import { buildGatewayProviderCatalogs } from "./gateway-provider-catalog-builder.js";
import type { AppleFoundationAvailabilitySnapshot } from "./gateway-admin-provider-policy-service.js";
import { normalizeProviderId } from "./gateway-admin-model-normalizers.js";

export type GatewayModelProviderCatalog = GatewayModelProviderCatalogPayload;

const PROVIDER_CATALOG_SNAPSHOT_CACHE_TTL_MS = 10_000;

export interface GatewayAdminProviderCatalogServiceOptions {
  providerConfigs: Map<string, ProviderRuntimeConfig>;
  ensureAppleFoundationAvailability: () => Promise<AppleFoundationAvailabilitySnapshot>;
  providerVisibleInCatalog: (providerId: string) => boolean;
  isProviderConfigAllowed: (providerId: string) => boolean;
  loadLocalAgentSnapshot: (forceRefresh: boolean) => Promise<DiscoveredLocalAgent[]>;
  resolveProviderBaseURL: (providerId: string, configuredBaseURL?: string) => string | undefined;
  detectOpenAICompatibleModels: (
    baseURLRaw?: string,
    options?: { forceRefresh?: boolean },
  ) => Promise<OpenAICompatibleDetectionResult>;
  detectClaudeAgentSdkCatalog: (
    config?: ProviderRuntimeConfig,
    forceRefresh?: boolean,
  ) => Promise<ClaudeAgentSdkCatalogProbe>;
  detectCodexAppServerCatalog: (
    config?: ProviderRuntimeConfig,
    forceRefresh?: boolean,
  ) => Promise<CodexAppServerCatalogProbe>;
  providerPolicyRestrictionReason: (providerId: string) => string | undefined;
  appleProviderRuntimeEligibleSync: () => { eligible: boolean; reason: string };
}

export class GatewayAdminProviderCatalogService {
  private readonly providerCatalogSnapshotCache = new Map<string, {
    expiresAt: number;
    value: GatewayModelProviderCatalog[];
  }>();
  private readonly providerCatalogSnapshotInFlight = new Map<string, Promise<GatewayModelProviderCatalog[]>>();

  constructor(private readonly options: GatewayAdminProviderCatalogServiceOptions) {}

  async listProviderCatalogs(input?: {
    providerId?: string;
    refresh?: boolean;
  }): Promise<GatewayModelProviderCatalog[]> {
    const requestedProvider = normalizeProviderId(input?.providerId);
    if (input?.providerId && !requestedProvider) {
      throw new Error(`Unknown providerId: ${input.providerId}`);
    }
    const forceRefresh = input?.refresh === true;
    const cacheKey = requestedProvider ?? "__all__";

    if (!forceRefresh) {
      const cached = this.providerCatalogSnapshotCache.get(cacheKey);
      if (cached) {
        if (cached.expiresAt > Date.now()) {
          return cached.value.map(cloneGatewayModelProviderCatalog);
        }
        if (!this.providerCatalogSnapshotInFlight.has(cacheKey)) {
          this.providerCatalogSnapshotInFlight.set(
            cacheKey,
            this.computeProviderCatalogSnapshot(requestedProvider, false),
          );
        }
        return cached.value.map(cloneGatewayModelProviderCatalog);
      }

      const inFlight = this.providerCatalogSnapshotInFlight.get(cacheKey);
      if (inFlight) {
        return (await inFlight).map(cloneGatewayModelProviderCatalog);
      }
    }

    if (!this.providerCatalogSnapshotInFlight.has(cacheKey)) {
      this.providerCatalogSnapshotInFlight.set(
        cacheKey,
        this.computeProviderCatalogSnapshot(requestedProvider, forceRefresh),
      );
    }
    return (await this.providerCatalogSnapshotInFlight.get(cacheKey)!)
      .map(cloneGatewayModelProviderCatalog);
  }

  invalidate(): void {
    this.providerCatalogSnapshotCache.clear();
    this.providerCatalogSnapshotInFlight.clear();
  }

  private async computeProviderCatalogSnapshot(
    requestedProvider: string | undefined,
    forceRefresh: boolean,
  ): Promise<GatewayModelProviderCatalog[]> {
    await this.options.ensureAppleFoundationAvailability();
    if (requestedProvider === "apple" && !this.options.providerVisibleInCatalog("apple")) {
      throw new Error(`Unknown providerId: ${requestedProvider}`);
    }

    const providerIds = requestedProvider
      ? [requestedProvider]
      : Array.from(new Set([
        ...Object.keys(DEFAULT_MODEL_BY_PROVIDER),
        ...Array.from(this.options.providerConfigs.keys()),
      ]))
        .filter((providerId) => this.options.providerVisibleInCatalog(providerId))
        .sort();

    const localAgents = await this.options.loadLocalAgentSnapshot(forceRefresh);
    const localAgentsByProvider = new Map<string, DiscoveredLocalAgent>();
    for (const agent of localAgents) {
      localAgentsByProvider.set(agent.recommendedProviderId, agent);
    }

    const openAIDetections = new Map<string, {
      serviceReachable: OpenAICompatibleDetectionResult["serviceReachable"];
      models: OpenAICompatibleDetectionResult["models"];
      detectionError?: OpenAICompatibleDetectionResult["detectionError"];
    }>();
    const claudeAgentSdkDetections = new Map<string, ClaudeAgentSdkCatalogProbe>();
    const codexAppServerDetections = new Map<string, CodexAppServerCatalogProbe>();

    await Promise.all(
      providerIds
        .filter((providerId) => isOpenAICompatibleProvider(providerId) && this.options.isProviderConfigAllowed(providerId))
        .map(async (providerId) => {
          const config = this.options.providerConfigs.get(providerId);
          const baseURL = this.options.resolveProviderBaseURL(providerId, config?.baseURL);
          const detection = await this.options.detectOpenAICompatibleModels(baseURL, {
            forceRefresh,
          });
          openAIDetections.set(providerId, detection);
        }),
    );

    await Promise.all(
      providerIds
        .filter((providerId) => providerId === "claude-agent-sdk" && this.options.isProviderConfigAllowed(providerId))
        .map(async (providerId) => {
          const config = this.options.providerConfigs.get(providerId);
          const detection = await this.options.detectClaudeAgentSdkCatalog(config, forceRefresh);
          claudeAgentSdkDetections.set(providerId, detection);
        }),
    );

    await Promise.all(
      providerIds
        .filter((providerId) => providerId === "codex-app-server" && this.options.isProviderConfigAllowed(providerId))
        .map(async (providerId) => {
          const config = this.options.providerConfigs.get(providerId);
          const detection = await this.options.detectCodexAppServerCatalog(config, forceRefresh);
          codexAppServerDetections.set(providerId, detection);
        }),
    );

    try {
      const value = buildGatewayProviderCatalogs({
        providerIds,
        providerConfigs: this.options.providerConfigs,
        localAgentsByProvider,
        openAIDetections,
        claudeAgentSdkDetections,
        codexAppServerDetections,
        providerPolicyRestrictionReason: this.options.providerPolicyRestrictionReason,
        isProviderConfigAllowed: this.options.isProviderConfigAllowed,
        resolveProviderBaseURL: this.options.resolveProviderBaseURL,
        appleProviderRuntimeEligibleSync: this.options.appleProviderRuntimeEligibleSync,
      });

      this.providerCatalogSnapshotCache.set(requestedProvider ?? "__all__", {
        expiresAt: Date.now() + PROVIDER_CATALOG_SNAPSHOT_CACHE_TTL_MS,
        value,
      });
      return value;
    } finally {
      this.providerCatalogSnapshotInFlight.delete(requestedProvider ?? "__all__");
    }
  }
}
