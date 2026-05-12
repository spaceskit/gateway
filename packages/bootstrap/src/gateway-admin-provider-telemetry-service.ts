import { spawnSync } from "node:child_process";
import type { Logger } from "@spaceskit/observability";
import type {
  ProviderRuntimeConfigPayload,
  ProviderTelemetryPayload,
  ProviderTelemetrySourcePayload,
  ProviderTelemetryWindowPayload,
  ProviderUsageSnapshotPayload,
} from "@spaceskit/server";
import type { UsageSnapshotService } from "./services/usage-snapshot-service.js";
import type { LocalUsageTelemetryService } from "./services/local-usage-telemetry-service.js";
import type { LocalProviderUsageTelemetry } from "./services/local-usage-telemetry-types.js";
import type {
  ClaudeOAuthAccessTokenResult,
  ClaudeOAuthUsageResult,
} from "./services/claude-oauth-telemetry.js";
import {
  normalizeCodexTelemetryWindows as normalizeCodexTelemetryWindowsPayload,
  type CodexAppServerTelemetryResult,
} from "./services/codex-app-server-telemetry.js";
import type { OpenAICompatibleDetectionResult } from "./services/local-agent-discovery-service.js";
import {
  normalizeProviderId,
  normalizeProviderIds,
} from "./gateway-admin-model-normalizers.js";
import {
  asString,
  isObjectRecord,
  joinNonEmpty,
} from "./gateway-admin-value-normalizers.js";
import { buildLocalUsageTelemetryFallback } from "./gateway-admin-local-usage-fallback.js";

type PublicProviderRuntimeConfig = ProviderRuntimeConfigPayload;
type ProviderTelemetry = ProviderTelemetryPayload;
type ProviderTelemetrySource = ProviderTelemetrySourcePayload;
type ProviderTelemetryWindow = ProviderTelemetryWindowPayload;

interface LocalProviderTelemetryProbeResult {
  source: ProviderTelemetrySource;
  status: ProviderUsageSnapshotPayload["status"];
  message?: string;
  accountLabel?: string;
  windows?: ProviderTelemetryWindow[];
}

export interface GatewayAdminProviderTelemetryServiceOptions {
  logger: Logger;
  usageSnapshotService?: UsageSnapshotService;
  localUsageTelemetryService?: LocalUsageTelemetryService;
  listProviderConfigs: () => PublicProviderRuntimeConfig[];
  findExecutable: (commands: string[]) => string | null;
  resolveProviderBaseURL: (providerId: string, configuredBaseURL?: string) => string | undefined;
  detectOpenAICompatibleModels: (baseURLRaw?: string) => Promise<OpenAICompatibleDetectionResult>;
  queryCodexAppServer: (executablePath: string) => Promise<CodexAppServerTelemetryResult>;
  readClaudeOAuthAccessToken: () => Promise<ClaudeOAuthAccessTokenResult>;
  fetchClaudeOAuthUsage: (accessToken: string) => Promise<ClaudeOAuthUsageResult>;
}

export class GatewayAdminProviderTelemetryService {
  private readonly logger: Logger;
  private usageSnapshotService?: UsageSnapshotService;
  private localUsageTelemetryService?: LocalUsageTelemetryService;

  constructor(private readonly options: GatewayAdminProviderTelemetryServiceOptions) {
    this.logger = options.logger;
    this.usageSnapshotService = options.usageSnapshotService;
    this.localUsageTelemetryService = options.localUsageTelemetryService;
  }

  setUsageSnapshotService(service?: UsageSnapshotService): void {
    this.usageSnapshotService = service;
  }

  setLocalUsageTelemetryService(service?: LocalUsageTelemetryService): void {
    this.localUsageTelemetryService = service;
  }

  async getProviderTelemetry(input?: {
    providerId?: string;
  }): Promise<ProviderTelemetry[]> {
    const requestedProvider = normalizeProviderId(input?.providerId);
    if (input?.providerId && !requestedProvider) {
      throw new Error(`Unknown providerId: ${input.providerId}`);
    }

    const configured = this.options.listProviderConfigs();
    const configuredById = new Map(
      configured.map((entry) => [entry.providerId.trim().toLowerCase(), entry]),
    );

    if (requestedProvider && !configuredById.has(requestedProvider)) {
      throw new Error(`Unknown providerId: ${requestedProvider}`);
    }

    const targetConfigs = requestedProvider
      ? [configuredById.get(requestedProvider)!]
      : configured;
    return this.buildProviderTelemetryEntries(targetConfigs);
  }

  async getLocalUsageTelemetry(input?: {
    providerId?: string;
    providerIds?: string[];
  }): Promise<LocalProviderUsageTelemetry[]> {
    const requestedProvider = normalizeProviderId(input?.providerId);
    if (input?.providerId && !requestedProvider) {
      throw new Error(`Unknown providerId: ${input.providerId}`);
    }
    const hasProviderIdsBatch = input?.providerIds !== undefined;
    const requestedProviderIds = normalizeProviderIds(input?.providerIds);
    if (hasProviderIdsBatch && input.providerIds?.some((providerId) => !normalizeProviderId(providerId))) {
      throw new Error("providerIds must contain non-empty provider IDs");
    }
    if (requestedProvider && hasProviderIdsBatch) {
      throw new Error("providerId and providerIds are mutually exclusive");
    }

    const configured = this.options.listProviderConfigs();
    const configuredById = new Map(
      configured.map((entry) => [entry.providerId.trim().toLowerCase(), entry]),
    );

    if (requestedProvider && !configuredById.has(requestedProvider)) {
      throw new Error(`Unknown providerId: ${requestedProvider}`);
    }
    for (const providerId of requestedProviderIds) {
      if (!configuredById.has(providerId)) {
        throw new Error(`Unknown providerId: ${providerId}`);
      }
    }

    const targetConfigs = hasProviderIdsBatch
      ? requestedProviderIds.map((providerId) => configuredById.get(providerId)!)
      : requestedProvider
        ? [configuredById.get(requestedProvider)!]
        : configured;
    const targetProviderIds = targetConfigs
      .map((entry) => entry.providerId.trim().toLowerCase())
      .filter((providerId) => providerId.length > 0);
    const fallbackTelemetry = await this.buildProviderTelemetryEntries(targetConfigs);
    if (!this.localUsageTelemetryService) {
      const fetchedAt = new Date().toISOString();
      return buildLocalUsageTelemetryFallback(fallbackTelemetry, fetchedAt);
    }

    return this.localUsageTelemetryService.getTelemetry({
      providerIds: targetProviderIds,
      fallbackTelemetry,
    });
  }

  private async buildProviderTelemetryEntries(
    configs: PublicProviderRuntimeConfig[],
  ): Promise<ProviderTelemetry[]> {
    const usageByProvider = this.providerUsageById();

    return Promise.all(
      configs.map(async (config) => this.buildProviderTelemetryEntry(
        config,
        usageByProvider.get(config.providerId.trim().toLowerCase()),
      )),
    );
  }

  private async buildProviderTelemetryEntry(
    config: PublicProviderRuntimeConfig,
    usage?: ProviderUsageSnapshotPayload,
  ): Promise<ProviderTelemetry> {
    const providerId = config.providerId.trim().toLowerCase();
    const fallbackStatus = usage?.status ?? "unknown";
    const fetchedAt = new Date().toISOString();
    const probe = await this.probeLocalProviderTelemetry(config, usage);

    return {
      providerId,
      status: probe?.status ?? fallbackStatus,
      source: probe?.source ?? "usage_snapshot",
      fetchedAt,
      message: probe?.message ?? usage?.message,
      accountLabel: probe?.accountLabel,
      windows: probe?.windows ?? [],
      usage,
    };
  }

  private providerUsageById(): Map<string, ProviderUsageSnapshotPayload> {
    const usageByProvider = new Map<string, ProviderUsageSnapshotPayload>();
    if (!this.usageSnapshotService) {
      return usageByProvider;
    }

    try {
      const snapshot = this.usageSnapshotService.getSnapshot();
      for (const usage of snapshot.providerUsage) {
        const providerId = usage.providerId.trim().toLowerCase();
        if (!providerId) continue;
        usageByProvider.set(providerId, usage);
      }
    } catch (err) {
      this.logger.warn("Failed to load usage snapshot for provider telemetry", {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    return usageByProvider;
  }

  private async probeLocalProviderTelemetry(
    config: PublicProviderRuntimeConfig,
    usage?: ProviderUsageSnapshotPayload,
  ): Promise<LocalProviderTelemetryProbeResult | null> {
    const providerId = config.providerId.trim().toLowerCase();

    switch (providerId) {
      case "codex":
      case "codex-app-server":
        return this.probeCodexRateLimits(usage);

      case "claude":
        return this.probeClaudeCliStatus(usage);

      case "gemini":
        return this.probeGeminiCliStatus();

      case "lmstudio":
        return this.probeLmStudioRuntime(config);

      default:
        return null;
    }
  }

  private async probeCodexRateLimits(
    usage?: ProviderUsageSnapshotPayload,
  ): Promise<LocalProviderTelemetryProbeResult> {
    const executablePath = this.options.findExecutable(["codex"]);
    if (!executablePath) {
      return {
        source: "codex_app_server",
        status: "unavailable",
        message: "Codex CLI is not installed on the gateway host.",
      };
    }

    const probe = await this.options.queryCodexAppServer(executablePath);
    const accountPayload = isObjectRecord(probe.account) ? probe.account : null;
    const account = accountPayload && isObjectRecord(accountPayload.account)
      ? accountPayload.account
      : null;
    const accountPlan = asString(account?.planType);
    const accountEmail = asString(account?.email);
    const accountLabel = joinNonEmpty([accountPlan, accountEmail], " • ");

    const rateLimitsPayload = isObjectRecord(probe.rateLimits) ? probe.rateLimits : null;
    const windows = normalizeCodexTelemetryWindowsPayload(rateLimitsPayload);

    const status: ProviderUsageSnapshotPayload["status"] = windows.length > 0
      ? "available"
      : (probe.error ? "unavailable" : (usage?.status ?? "unknown"));

    return {
      source: "codex_app_server",
      status,
      accountLabel: accountLabel || undefined,
      windows,
      message: probe.error
        || (windows.length === 0
          ? "Codex app-server did not return rate-limit windows."
          : undefined),
    };
  }

  private async probeClaudeCliStatus(
    usage?: ProviderUsageSnapshotPayload,
  ): Promise<LocalProviderTelemetryProbeResult> {
    if (!this.options.findExecutable(["claude"])) {
      return {
        source: "claude_cli",
        status: "unavailable",
        message: "Claude CLI is not installed on the gateway host.",
      };
    }

    const credentials = await this.options.readClaudeOAuthAccessToken();
    if (credentials.accessToken) {
      try {
        const usageResult = await this.options.fetchClaudeOAuthUsage(credentials.accessToken);
        if (usageResult.windows.length > 0) {
          return {
            source: "claude_cli",
            status: "available",
            accountLabel: usageResult.accountLabel,
            windows: usageResult.windows,
            message: usageResult.message
              ?? `Claude OAuth quota windows loaded from ${credentials.source ?? "OAuth credentials"}.`,
          };
        }
      } catch (err) {
        return this.claudeCliFallbackStatus(
          usage,
          `Claude OAuth quota probe failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    if (credentials.message) {
      return this.claudeCliFallbackStatus(usage, credentials.message);
    }

    return this.claudeCliFallbackStatus(
      usage,
      "No Claude OAuth token found; API-key billing does not expose session or weekly quota windows.",
    );
  }

  private claudeCliFallbackStatus(
    usage: ProviderUsageSnapshotPayload | undefined,
    quotaMessage: string,
  ): LocalProviderTelemetryProbeResult {
    const status = usage?.status ?? "available";
    const hasRecentUsage = Boolean(
      usage && (usage.totalTokens > 0 || usage.spentUsd > 0 || usage.status === "available"),
    );

    return {
      source: "claude_cli",
      status,
      message: hasRecentUsage
        ? `Claude CLI is installed; ${quotaMessage} Recent usage indicates the runtime is active.`
        : `Claude CLI is installed; ${quotaMessage}`,
    };
  }

  private probeGeminiCliStatus(): LocalProviderTelemetryProbeResult {
    const executablePath = this.options.findExecutable(["gemini"]);
    if (!executablePath) {
      return {
        source: "gemini_cli",
        status: "unavailable",
        message: "Gemini CLI is not installed on the gateway host.",
      };
    }

    const result = spawnSync(executablePath, ["--version"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 1_500,
    });

    if (result.status !== 0) {
      return {
        source: "gemini_cli",
        status: "unknown",
        message: result.stderr?.trim() || "Unable to read Gemini CLI version.",
      };
    }

    const accountLabel = result.stdout
      ?.split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0);

    return {
      source: "gemini_cli",
      status: "available",
      accountLabel: accountLabel || undefined,
      message: "Gemini CLI does not expose quota windows via public commands.",
    };
  }

  private async probeLmStudioRuntime(
    config: PublicProviderRuntimeConfig,
  ): Promise<LocalProviderTelemetryProbeResult> {
    const baseURL = this.options.resolveProviderBaseURL("lmstudio", config.baseURL);
    const detection = await this.options.detectOpenAICompatibleModels(baseURL);

    if (!detection.serviceReachable) {
      return {
        source: "lmstudio_runtime",
        status: "unavailable",
        message: detection.detectionError || "LM Studio endpoint is not reachable.",
      };
    }

    return {
      source: "lmstudio_runtime",
      status: "available",
      message: detection.models.length > 0
        ? `Detected ${detection.models.length} model(s) from LM Studio runtime.`
        : "LM Studio endpoint is reachable but returned no models.",
    };
  }
}
