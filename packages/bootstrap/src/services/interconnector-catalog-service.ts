import type { Logger } from "@spaceskit/observability";
import type { GatewayCoreProfileId } from "@spaceskit/gateway-core";
import type { GatewayLibraryService } from "./gateway-library-service.js";
import type { CliToolHealthStatus, CliToolService } from "./cli-tool-service.js";
import {
  INTERCONNECTOR_CATALOG_BUNDLE_DEFINITIONS,
  type InterconnectorCatalogBundleDefinition,
  type InterconnectorCatalogBundleStatus,
  type InterconnectorCatalogBundleSyncContext,
  type InterconnectorCatalogBundleSyncResult,
} from "./interconnector-catalog-definitions.js";

export interface InterconnectorCatalogServiceOptions {
  enabled: boolean;
  gatewayProfile: GatewayCoreProfileId;
  manifestRoot: string;
  logger: Logger;
  cliToolService?: CliToolService | null;
  gatewayLibraryService?: GatewayLibraryService | null;
  catalogDefinitions?: InterconnectorCatalogBundleDefinition[];
}

export interface InterconnectorCatalogSyncResult {
  detected: boolean;
  bundleIds: string[];
  toolCount: number;
  toolIds: string[];
  removedToolIds: string[];
  healthStatus: CliToolHealthStatus;
  healthMessage?: string;
  interconnectors: InterconnectorCatalogBundleStatus[];
  generatedAt: string;
}

export class InterconnectorCatalogService {
  private readonly cliToolService: CliToolService | null;
  private readonly gatewayLibraryService: GatewayLibraryService | null;
  private readonly catalogDefinitions: InterconnectorCatalogBundleDefinition[];
  private lastResults = new Map<string, InterconnectorCatalogBundleSyncResult>();

  constructor(private readonly options: InterconnectorCatalogServiceOptions) {
    this.cliToolService = options.cliToolService ?? null;
    this.gatewayLibraryService = options.gatewayLibraryService ?? null;
    this.catalogDefinitions = options.catalogDefinitions ?? INTERCONNECTOR_CATALOG_BUNDLE_DEFINITIONS;
  }

  async prepareStartup(): Promise<InterconnectorCatalogSyncResult> {
    return this.sync({ reloadCliTools: false });
  }

  async rescan(): Promise<InterconnectorCatalogSyncResult> {
    return this.sync({ reloadCliTools: true });
  }

  async applyHealth(): Promise<void> {
    if (!this.cliToolService) {
      return;
    }

    for (const result of this.lastResults.values()) {
      for (const toolId of result.toolIds) {
        this.cliToolService.setToolHealth(toolId, {
          healthStatus: result.healthStatus,
          healthMessage: result.healthMessage,
        });
      }
    }
  }

  listBundles(): InterconnectorCatalogBundleStatus[] {
    return Array.from(this.lastResults.values())
      .map((result) => ({ ...result }))
      .sort((lhs, rhs) => lhs.bundleDisplayName.localeCompare(rhs.bundleDisplayName));
  }

  getBundle(bundleIdRaw: string): InterconnectorCatalogBundleStatus | null {
    const bundleId = bundleIdRaw.trim().toLowerCase();
    if (!bundleId) {
      return null;
    }
    return this.lastResults.get(bundleId) ?? null;
  }

  private async sync(input: { reloadCliTools: boolean }): Promise<InterconnectorCatalogSyncResult> {
    const syncContextBase: InterconnectorCatalogBundleSyncContext = {
      enabled: this.options.enabled,
      gatewayProfile: this.options.gatewayProfile,
      manifestRoot: this.options.manifestRoot,
      logger: this.options.logger,
      cliToolService: this.cliToolService,
      gatewayLibraryService: this.gatewayLibraryService,
    };

    const results: InterconnectorCatalogBundleSyncResult[] = [];
    for (const definition of this.catalogDefinitions) {
      const result = await definition.sync(syncContextBase);
      this.lastResults.set(definition.bundleId, result);
      results.push(result);
    }

    if (input.reloadCliTools && this.cliToolService) {
      await this.cliToolService.reloadFromManifestRoot();
      await this.applyHealth();
    }

    return aggregateResults(results);
  }
}

function aggregateResults(
  results: InterconnectorCatalogBundleSyncResult[],
): InterconnectorCatalogSyncResult {
  const generatedAt = new Date().toISOString();
  const bundleIds = results.map((result) => result.bundleId);
  const activeResults = results.filter((result) => result.detected && result.availabilityStatus !== "inactive");
  const toolIds = activeResults.flatMap((result) => result.toolIds);
  const removedToolIds = results.flatMap((result) => result.removedToolIds);
  const detected = results.some((result) => result.detected);
  const degraded = activeResults.some((result) => result.healthStatus === "degraded");
  const healthy = activeResults.some((result) => result.healthStatus === "ok");
  const healthStatus: CliToolHealthStatus = degraded
    ? "degraded"
    : healthy
      ? "ok"
      : "unknown";
  const healthMessage = results.find((result) => result.healthMessage?.trim())?.healthMessage;

  return {
    detected,
    bundleIds,
    toolCount: toolIds.length,
    toolIds,
    removedToolIds,
    healthStatus,
    healthMessage,
    interconnectors: results.map((result) => ({ ...result })),
    generatedAt,
  };
}
