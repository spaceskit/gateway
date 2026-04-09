/**
 * Spaceskit bootstrap entry point.
 *
 * Run directly with Bun:
 *   bun run packages/bootstrap/src/index.ts
 */

import { resolve } from "node:path";
import { CapabilityRegistry, EventBus } from "@spaceskit/core";
import {
  capabilityGrantsFromIds,
  createGatewayCoreState,
} from "@spaceskit/gateway-core";
import { Logger, createFileOutput } from "@spaceskit/observability";
import type { BootstrapState, GatewayInstance } from "./bootstrap-state.js";
import { initializeAdminServices } from "./admin-services-phase.js";
import { initializeCollaborationServices } from "./collaboration-services-phase.js";
import {
  defaultSpacesRootForHost,
  loadConfig,
  resolveDbRootFolder,
  type GatewayConfig,
} from "./config.js";
import { initializeOrchestrationServices } from "./orchestration-phase.js";
import { initializePersistence } from "./persistence-phase.js";
import { initializePolicyRuntimeServices } from "./policy-runtime-phase.js";
import { initializeRuntimeSupport } from "./runtime-support-phase.js";
import {
  createShutdown,
  registerProcessSignals,
} from "./shutdown-phase.js";
import { initializeSpaceManager } from "./space-manager-phase.js";
import { initializeSpaceAdminService } from "./space-admin-phase.js";
import {
  enforceFreshBootstrapWorkspaceBuild,
  enforceStartupEnvValidation,
  enforceTransportPolicy,
  gatewayUuidSeed,
} from "./startup-guards.js";
import { startGatewayServer } from "./server-phase.js";
import { initializeTransportServices } from "./transport-phase.js";
import { deterministicUuid } from "./utils/uuid.js";
import { initializeWorkspaceAndMiddleware } from "./workspace-middleware-phase.js";
import { ExecutionAdapterFactory } from "./execution/execution-adapter-factory.js";

export { loadConfig, resolveGatewayProfile } from "./config.js";
export type { GatewayConfig } from "./config.js";
export type { GatewayInstance } from "./bootstrap-state.js";
export {
  buildDeterministicHandoffDigest,
  listTurnsForActiveSessionBoundary,
} from "./turn-history.js";

const SHOULD_ENFORCE_WORKSPACE_BUILD_FRESHNESS = import.meta.main;

function resolveSpacesRoot(config: GatewayConfig, databaseRootFolder?: string): string {
  const configuredRoot = config.spacesRoot?.trim();
  return resolve(configuredRoot || defaultSpacesRootForHost(config.gatewayProfile, databaseRootFolder));
}

function assertSecureStartupConfig(config: GatewayConfig, logger: Logger): void {
  if (config.skipAuth && config.gatewayProfile === "external") {
    logger.error(
      "CRITICAL: skipAuth is enabled on an external (production) gateway profile. " +
      "This is a severe security misconfiguration. Set SPACESKIT_SKIP_AUTH=false or " +
      "change SPACESKIT_GATEWAY_PROFILE to embedded for local development.",
      { gatewayProfile: config.gatewayProfile, skipAuth: config.skipAuth },
    );
    throw new Error(
      "Startup aborted: skipAuth=true is not permitted with gatewayProfile=external. " +
      "Remove SPACESKIT_SKIP_AUTH=true before starting in production.",
    );
  }

  if (config.gatewayProfile === "external" && config.httpPrincipalAuthStrictExplicitDisable) {
    logger.error(
      "CRITICAL: external gateways require strict signed HTTP principal verification. " +
      "Remove SPACESKIT_HTTP_PRINCIPAL_AUTH_STRICT=false from the environment.",
      {
        gatewayProfile: config.gatewayProfile,
        httpPrincipalAuthStrict: config.httpPrincipalAuthStrict,
        httpPrincipalAuthStrictExplicitDisable: config.httpPrincipalAuthStrictExplicitDisable,
      },
    );
    throw new Error(
      "Startup aborted: external gateways require strict signed HTTP principal auth. " +
      "Remove SPACESKIT_HTTP_PRINCIPAL_AUTH_STRICT=false before starting.",
    );
  }

  if (config.httpPrincipalAuthStrict && !config.httpPrincipalAuthHs256Secret) {
    logger.error(
      "CRITICAL: strict HTTP principal verification is enabled without an HS256 secret. " +
      "Set SPACESKIT_HTTP_PRINCIPAL_AUTH_HS256_SECRET before enabling strict mode.",
      { httpPrincipalAuthStrict: config.httpPrincipalAuthStrict },
    );
    throw new Error(
      "Startup aborted: SPACESKIT_HTTP_PRINCIPAL_AUTH_STRICT=true requires " +
      "SPACESKIT_HTTP_PRINCIPAL_AUTH_HS256_SECRET.",
    );
  }
}

function createBootstrapState(config: GatewayConfig): BootstrapState {
  const databaseRootFolder = resolveDbRootFolder(config.dbPath);
  config.spacesRoot = resolveSpacesRoot(config, databaseRootFolder);

  const resolvedGatewayUuidSeed = gatewayUuidSeed(config);
  const logger = new Logger({
    minLevel: config.logLevel,
    module: "gateway",
    output: config.logFilePath
      ? createFileOutput({ filePath: config.logFilePath, tee: true })
      : undefined,
  });

  logger.info("Starting Spaceskit", {
    port: config.port,
    host: config.host,
    dbPath: config.dbPath,
    spacesRoot: config.spacesRoot,
    generation: config.runtimeGeneration,
    gatewayProfile: config.gatewayProfile,
    healthDebug: config.healthDebug,
    startupCapabilityGrants: config.gatewayCapabilityGrants,
    runtime: `Bun ${Bun.version}`,
  });

  assertSecureStartupConfig(config, logger);
  enforceStartupEnvValidation(config, logger);
  enforceTransportPolicy(config, logger);
  if (SHOULD_ENFORCE_WORKSPACE_BUILD_FRESHNESS) {
    enforceFreshBootstrapWorkspaceBuild(logger);
  }

  const eventBus = new EventBus();
  const configuredGrants = capabilityGrantsFromIds(config.gatewayCapabilityGrants, "startup_config");

  return {
    config,
    databaseRootFolder: databaseRootFolder ?? null,
    resolvedGatewayUuidSeed,
    gatewayUuid: deterministicUuid(resolvedGatewayUuidSeed, "spaceskit.gateway.uuid"),
    logger,
    configuredGrants,
    gatewayCoreState: createGatewayCoreState({ profileId: config.gatewayProfile }),
    appliedCapabilityGrants: [],
    skippedCapabilityGrants: [],
    invalidCapabilityGrants: configuredGrants.invalid,
    eventBus,
    capabilities: new CapabilityRegistry(eventBus),
    executionAdapterFactory: new ExecutionAdapterFactory(),
    db: null,
    server: null,
    connectorAdminService: null,
    configReloader: null,
    deadLetterQueue: null,
    modelRouter: null,
    orchestratorCommandService: null,
  };
}

export async function startGateway(
  configOverride?: Partial<GatewayConfig>,
): Promise<GatewayInstance> {
  const mergedConfig = { ...loadConfig(), ...configOverride };
  if (configOverride?.conciergeSpaceId && configOverride.conciergeSpaceResourceId === undefined) {
    mergedConfig.conciergeSpaceResourceId = `system.concierge.backing-space.${mergedConfig.conciergeSpaceId}`;
  }
  const state = createBootstrapState(mergedConfig);

  await initializePersistence(state);
  initializeWorkspaceAndMiddleware(state);
  initializeSpaceAdminService(state);
  await initializeRuntimeSupport(state);
  await initializeAdminServices(state);
  await initializePolicyRuntimeServices(state);
  initializeCollaborationServices(state);
  initializeSpaceManager(state);
  await initializeOrchestrationServices(state);
  initializeTransportServices(state);
  await startGatewayServer(state);

  const shutdown = createShutdown(state);
  registerProcessSignals(shutdown);

  return {
    config: state.config,
    logger: state.logger,
    eventBus: state.eventBus,
    capabilities: state.capabilities,
    middleware: state.middleware,
    spaceManager: state.spaceManager,
    spaceAdminService: state.spaceAdminService,
    gatewayAdminService: state.gatewayAdminService,
    connectorAdminService: state.connectorAdminService,
    memoryRegistry: state.memoryRegistry,
    notificationService: state.notificationService,
    checkpointManager: state.checkpointManager ?? null,
    deadLetterQueue: state.deadLetterQueue ?? null,
    modelRouter: state.modelRouter ?? null,
    orchestratorCommandService: state.orchestratorCommandService ?? null,
    pluginSystem: state.pluginSystem,
    agentVersionManager: state.agentVersionManager,
    configReloader: state.configReloader ?? null,
    db: state.db ?? null,
    server: state.server ?? null,
    shutdown,
  };
}

if (import.meta.main) {
  startGateway().catch((error) => {
    console.error("Fatal error starting gateway:", error);
    process.exit(1);
  });
}
