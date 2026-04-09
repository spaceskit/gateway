import type { GatewayCoreProfileId } from "@spaceskit/gateway-core";
import type { BootstrapState } from "./bootstrap-state.js";
import { evaluateSandboxSlo } from "./turn-helpers.js";

export function createHealthCheck(state: BootstrapState) {
  return async (context?: { debug?: boolean }) => {
    const { config } = state;
    const subsystems: Record<string, { status: "ok" | "degraded" | "error"; detail?: string }> = {};

    subsystems.database = state.db
      ? { status: "ok", detail: config.dbPath }
      : { status: "degraded", detail: "Running without persistence" };

    const memoryProviders = state.memoryRegistry.list();
    subsystems.memory = memoryProviders.length > 0
      ? { status: "ok", detail: `${memoryProviders.length} provider(s)` }
      : { status: "degraded", detail: "No memory providers" };

    const providerConfigList = state.gatewayAdminService.listProviderConfigs();
    if (state.modelRouter) {
      subsystems.modelRouter = { status: "ok", detail: `${config.modelProvider}/${config.defaultModelId}` };
    } else if (providerConfigList.length > 0) {
      const first = providerConfigList[0];
      subsystems.modelRouter = { status: "ok", detail: `${first.providerId}/${first.model} (from provider configs)` };
    } else {
      subsystems.modelRouter = { status: "degraded", detail: "No model runtime configured" };
    }

    subsystems.middleware = {
      status: "ok",
      detail: `${state.middleware.list().length} middleware registered`,
    };
    subsystems.checkpoint = state.checkpointManager ? { status: "ok" } : { status: "degraded", detail: "No checkpoint manager" };
    subsystems.deadLetterQueue = state.deadLetterQueue ? { status: "ok" } : { status: "degraded", detail: "No dead letter queue" };

    const sandboxSlo = evaluateSandboxSlo({
      succeeded: state.sandboxRuntimeState.succeeded,
      failed: state.sandboxRuntimeState.failed,
      minSuccessRate: config.sandboxSloMinSuccessRate,
      minSamples: config.sandboxSloMinSamples,
    });
    if (state.sandboxRuntimeState.backendMode === "disabled") {
      subsystems.sandbox = {
        status: state.sandboxRuntimeState.enforceSandboxRouting ? "degraded" : "ok",
        detail: state.sandboxRuntimeState.enforceSandboxRouting
          ? "Sandbox routing enforced but backend disabled"
          : "Sandbox routing disabled",
      };
    } else if (state.sandboxRuntimeState.backendMode === "unavailable") {
      subsystems.sandbox = { status: "error", detail: "Sandbox backend unavailable" };
    } else if (state.sandboxRuntimeState.backendMode === "passthrough") {
      subsystems.sandbox = {
        status: config.gatewayProfile === "external" ? "error" : "degraded",
        detail: "Sandbox host passthrough active",
      };
    } else if (config.sandboxSloEnforce && sandboxSlo.evaluated && !sandboxSlo.meetsSlo) {
      subsystems.sandbox = {
        status: "error",
        detail: `Sandbox SLO breached (${sandboxSlo.successRate.toFixed(3)} < ${config.sandboxSloMinSuccessRate.toFixed(3)})`,
      };
    } else {
      subsystems.sandbox = {
        status: "ok",
        detail: `mode=${state.sandboxRuntimeState.backendMode}, samples=${sandboxSlo.samples}, successRate=${sandboxSlo.successRate.toFixed(3)}`,
      };
    }

    const relaySnapshot = state.gatewayObservabilityService.getRelaySnapshot();
    if (!config.relayShareV2Enabled) {
      subsystems.relay = { status: "ok", detail: "Relay share v2 disabled" };
    } else if (config.relaySloEnforce && relaySnapshot.overall.sloEvaluated && !relaySnapshot.overall.sloMet) {
      subsystems.relay = {
        status: "error",
        detail: `Relay SLO breached (${relaySnapshot.overall.successRate.toFixed(3)} < ${config.relaySloMinSuccessRate.toFixed(3)})`,
      };
    } else {
      subsystems.relay = {
        status: "ok",
        detail: [
          `samples=${relaySnapshot.overall.samples}`,
          `successRate=${relaySnapshot.overall.successRate.toFixed(3)}`,
          `resolve=${relaySnapshot.resolve.succeeded}/${relaySnapshot.resolve.attempted}`,
          `join=${relaySnapshot.join.succeeded}/${relaySnapshot.join.attempted}`,
        ].join(", "),
      };
    }

    const hasError = Object.values(subsystems).some((entry) => entry.status === "error");
    const hasDegraded = Object.values(subsystems).some((entry) => entry.status === "degraded");
    const degradationReasons = Object.entries(subsystems)
      .filter(([, entry]) => entry.status === "degraded" || entry.status === "error")
      .map(([subsystem, entry]) => ({
        subsystem,
        status: entry.status as "degraded" | "error",
        detail: entry.detail,
      }));

    const payload: {
      status: "ok" | "degraded" | "error";
      uptime: number;
      clients: number;
      subsystems: Record<string, { status: "ok" | "degraded" | "error"; detail?: string }>;
      metadata: {
        gatewayId: string;
        gatewayProfile: GatewayCoreProfileId;
        gatewayUuid: string;
        spacesRoot?: string;
        mainSpaceId: string;
        mainSpaceName: string;
        mainSpaceResourceId: string;
        mainAgentId: string;
        mainProfileId: string;
        mainAgentStatus: "healthy" | "repaired" | "fallback" | "degraded";
      };
      degradation?: { reasons: Array<{ subsystem: string; status: "degraded" | "error"; detail?: string }> };
      debug?: Record<string, unknown>;
    } = {
      status: hasError ? "error" : hasDegraded ? "degraded" : "ok",
      uptime: Math.floor(process.uptime()),
      clients: state.server?.clientCount ?? 0,
      subsystems,
      metadata: {
        gatewayId: config.mainSpaceResourceId,
        gatewayProfile: config.gatewayProfile,
        gatewayUuid: state.gatewayUuid,
        spacesRoot: config.spacesRoot,
        mainSpaceId: config.mainSpaceId,
        mainSpaceName: config.mainSpaceName,
        mainSpaceResourceId: config.mainSpaceResourceId,
        mainAgentId: config.mainAgentId,
        mainProfileId: config.mainProfileId,
        mainAgentStatus: state.mainAgentHealthStatus,
      },
    };

    if (degradationReasons.length > 0) {
      payload.degradation = { reasons: degradationReasons };
    }

    const debugEnabled = config.healthDebug || context?.debug === true;
    if (debugEnabled) {
      const defaultMemoryProviderId = state.memoryRegistry.getDefault()?.id ?? null;
      const mcpStats = state.spaceMcpService.getHealthStats();
      payload.debug = {
        requestedViaQuery: context?.debug === true,
        enabledViaConfig: config.healthDebug,
        generatedAt: new Date().toISOString(),
        runtime: {
          host: config.host,
          port: config.port,
          dbPath: config.dbPath,
          spacesRoot: config.spacesRoot,
          gatewayUuid: state.gatewayUuid,
          gatewayProfile: config.gatewayProfile,
          modelProvider: config.modelProvider ?? null,
          defaultModelId: config.defaultModelId ?? null,
          appleFoundationProviderEnabled: config.enableAppleFoundationProvider,
          mcpEndpointConfigured: Boolean(config.mcpEndpoint),
          perSpaceMcpEndpointCount: mcpStats.configuredSpaceEndpoints,
          perSpaceMcpConnectedCount: mcpStats.connectedSpaceEndpoints,
          externalMcpBindingCount: mcpStats.externalBindings,
          mem0Configured: Boolean(config.mem0ApiKey),
          lettaConfigured: Boolean(config.lettaBaseUrl),
          checkpointEnabled: state.checkpointManager !== null,
          deadLetterQueueEnabled: state.deadLetterQueue !== null,
          sandbox: {
            enforceSandboxRouting: state.sandboxRuntimeState.enforceSandboxRouting,
            backendMode: state.sandboxRuntimeState.backendMode,
            routed: state.sandboxRuntimeState.routed,
            succeeded: state.sandboxRuntimeState.succeeded,
            failed: state.sandboxRuntimeState.failed,
            successRate: sandboxSlo.successRate,
            samples: sandboxSlo.samples,
            minSuccessRate: config.sandboxSloMinSuccessRate,
            minSamples: config.sandboxSloMinSamples,
            sloEvaluated: sandboxSlo.evaluated,
            sloMet: sandboxSlo.meetsSlo,
            sloEnforced: config.sandboxSloEnforce,
            belowSloSince: state.sandboxRuntimeState.belowSloSince ?? null,
            lastFailureAt: state.sandboxRuntimeState.lastFailureAt ?? null,
            lastFailureMessage: state.sandboxRuntimeState.lastFailureMessage ?? null,
          },
          relay: relaySnapshot,
        },
        memoryProviders: memoryProviders.map((provider: any) => ({
          id: provider.id,
          name: provider.name,
          available: provider.available,
          default: provider.id === defaultMemoryProviderId,
        })),
        degradationReasons,
      };
    }

    return payload;
  };
}
