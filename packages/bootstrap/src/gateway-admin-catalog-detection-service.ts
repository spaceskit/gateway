import {
  ClaudeAgentSdkModelProvider,
  CodexAppServerModelProvider,
} from "@spaceskit/provider-runtime";
import type { GatewayProviderAuthModePayload } from "@spaceskit/server";
import type { ProviderRuntimeConfig } from "./gateway-admin-service.js";
import {
  cloneClaudeAgentSdkCatalogProbe,
  cloneCodexAppServerCatalogProbe,
  mapClaudeAgentSdkProbeResult,
  mapCodexAppServerProbeResult,
  type ClaudeAgentSdkCatalogProbe,
  type CodexAppServerCatalogProbe,
} from "./gateway-admin-telemetry-normalizers.js";
import { runCachedCatalogProbe } from "./gateway-admin-cached-probe.js";
import {
  DEFAULT_MODEL_BY_PROVIDER,
  providerDisplayName,
  resolveProviderAuthMode,
} from "./services/provider-catalog-support.js";
import { withProviderPrefix } from "./gateway-admin-model-normalizers.js";

type GatewayProviderAuthMode = GatewayProviderAuthModePayload;

const CLAUDE_AGENT_SDK_DETECTION_CACHE_TTL_MS = 30_000;

export type ClaudeAgentSdkMetadataProbe = (input: {
  providerId: string;
  model: string;
  authMode: GatewayProviderAuthMode;
  apiKey?: string;
}) => Promise<ClaudeAgentSdkCatalogProbe>;

export type CodexAppServerMetadataProbe = (input: {
  providerId: string;
  model: string;
  authMode: GatewayProviderAuthMode;
  apiKey?: string;
}) => Promise<CodexAppServerCatalogProbe>;

export interface GatewayAdminCatalogDetectionServiceOptions {
  claudeAgentSdkMetadataProbe?: ClaudeAgentSdkMetadataProbe;
  codexAppServerMetadataProbe?: CodexAppServerMetadataProbe;
  resolveConfiguredProviderApiKey: (
    providerId: string,
    config?: ProviderRuntimeConfig,
  ) => string | undefined;
}

export class GatewayAdminCatalogDetectionService {
  private readonly claudeAgentSdkMetadataProbe?: ClaudeAgentSdkMetadataProbe;
  private readonly codexAppServerMetadataProbe?: CodexAppServerMetadataProbe;
  private readonly resolveConfiguredProviderApiKey: (
    providerId: string,
    config?: ProviderRuntimeConfig,
  ) => string | undefined;
  private readonly claudeAgentSdkDetectionCache = new Map<string, {
    expiresAt: number;
    value: ClaudeAgentSdkCatalogProbe;
  }>();
  private readonly claudeAgentSdkDetectionInFlight = new Map<string, Promise<ClaudeAgentSdkCatalogProbe>>();
  private readonly codexAppServerDetectionCache = new Map<string, {
    expiresAt: number;
    value: CodexAppServerCatalogProbe;
  }>();
  private readonly codexAppServerDetectionInFlight = new Map<string, Promise<CodexAppServerCatalogProbe>>();

  constructor(options: GatewayAdminCatalogDetectionServiceOptions) {
    this.claudeAgentSdkMetadataProbe = options.claudeAgentSdkMetadataProbe;
    this.codexAppServerMetadataProbe = options.codexAppServerMetadataProbe;
    this.resolveConfiguredProviderApiKey = options.resolveConfiguredProviderApiKey;
  }

  async detectClaudeAgentSdkCatalog(
    config?: ProviderRuntimeConfig,
    forceRefresh = false,
  ): Promise<ClaudeAgentSdkCatalogProbe> {
    const providerId = "claude-agent-sdk";
    return runCachedCatalogProbe({
      cache: this.claudeAgentSdkDetectionCache,
      inFlight: this.claudeAgentSdkDetectionInFlight,
      cacheKey: providerId,
      forceRefresh,
      ttlMs: CLAUDE_AGENT_SDK_DETECTION_CACHE_TTL_MS,
      cloneValue: cloneClaudeAgentSdkCatalogProbe,
      buildValue: async () => {
        const model = withProviderPrefix(
          providerId,
          config?.model || DEFAULT_MODEL_BY_PROVIDER[providerId] || `${providerId}/default`,
        );
        const authMode = resolveProviderAuthMode(providerId, config?.authMode) ?? "api_key";
        if (this.claudeAgentSdkMetadataProbe) {
          return await this.claudeAgentSdkMetadataProbe({
            providerId,
            model,
            authMode,
            apiKey: authMode === "api_key" ? this.resolveConfiguredProviderApiKey(providerId, config) : undefined,
          });
        }

        const provider = new ClaudeAgentSdkModelProvider({
          id: providerId,
          name: providerDisplayName(providerId),
          model,
          apiKey: authMode === "api_key" ? this.resolveConfiguredProviderApiKey(providerId, config) : undefined,
          authMode: authMode as "api_key" | "host_login",
        });
        const probe = await provider.probeMetadata();
        return mapClaudeAgentSdkProbeResult(probe);
      },
    });
  }

  async detectCodexAppServerCatalog(
    config?: ProviderRuntimeConfig,
    forceRefresh = false,
  ): Promise<CodexAppServerCatalogProbe> {
    const providerId = "codex-app-server";
    return runCachedCatalogProbe({
      cache: this.codexAppServerDetectionCache,
      inFlight: this.codexAppServerDetectionInFlight,
      cacheKey: providerId,
      forceRefresh,
      ttlMs: CLAUDE_AGENT_SDK_DETECTION_CACHE_TTL_MS,
      cloneValue: cloneCodexAppServerCatalogProbe,
      buildValue: async () => {
        const model = withProviderPrefix(
          providerId,
          config?.model || DEFAULT_MODEL_BY_PROVIDER[providerId] || `${providerId}/default`,
        );
        const authMode = resolveProviderAuthMode(providerId, config?.authMode) ?? "host_login";
        if (this.codexAppServerMetadataProbe) {
          return await this.codexAppServerMetadataProbe({
            providerId,
            model,
            authMode,
            apiKey: authMode === "api_key" ? this.resolveConfiguredProviderApiKey(providerId, config) : undefined,
          });
        }

        const provider = new CodexAppServerModelProvider({
          id: providerId,
          name: providerDisplayName(providerId),
          model,
          apiKey: authMode === "api_key" ? this.resolveConfiguredProviderApiKey(providerId, config) : undefined,
          authMode: authMode as "api_key" | "host_login",
        });
        const probe = await provider.probeMetadata();
        return mapCodexAppServerProbeResult(probe);
      },
    });
  }

  invalidate(providerId: string): void {
    if (providerId === "claude-agent-sdk") {
      this.claudeAgentSdkDetectionCache.delete(providerId);
      this.claudeAgentSdkDetectionInFlight.delete(providerId);
      return;
    }
    if (providerId === "codex-app-server") {
      this.codexAppServerDetectionCache.delete(providerId);
      this.codexAppServerDetectionInFlight.delete(providerId);
    }
  }
}
