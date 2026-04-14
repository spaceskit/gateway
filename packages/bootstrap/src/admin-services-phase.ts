import { join } from "node:path";
import type { BootstrapState } from "./bootstrap-state.js";
import { probeAppleFoundationAvailability } from "./config.js";
import { DefaultGatewayAdminService } from "./gateway-admin-service.js";
import { LocalExecutableResolver } from "./execution/local-executable-resolver.js";
import { AccessGrantService } from "./services/access-grant-service.js";
import { CliToolService } from "./services/cli-tool-service.js";
import { ConnectorAdminService } from "./services/connector-admin-service.js";
import { InterconnectorCatalogService } from "./services/interconnector-catalog-service.js";
import { ProviderSecretRefService } from "./services/provider-secret-ref-service.js";
import { SpaceMcpService } from "./services/space-mcp-service.js";
import { ToolApprovalGrantService } from "./services/tool-approval-grant-service.js";

export async function initializeAdminServices(state: BootstrapState): Promise<void> {
  const {
    config,
    logger,
    databaseRootFolder,
    capabilities,
    spaceAdminService,
    profileRepo,
    providerSecretRefRepo,
    spaceMcpEndpointRepo,
    spaceExternalAgentBindingRepo,
    connectorFamilyRepo,
    connectorInstanceRepo,
    connectorBindingRepo,
    connectorPolicyRepo,
    connectorSecretRefRepo,
    auditEventsRepo,
    accessGrantRepo,
    toolApprovalGrantRepo,
    providerConfigRepo,
    gatewayRuntimeDefaultsRepo,
    integrationRequestRepo,
    spaceWorkspaceService,
  } = state;

  if (config.gatewayProfile === "external" && !Bun.env.SPACESKIT_SECRET_REF_MASTER_KEY?.trim()) {
    logger.error("CRITICAL: SPACESKIT_SECRET_REF_MASTER_KEY is required for external gateway profile but is not set");
    throw new Error("SPACESKIT_SECRET_REF_MASTER_KEY is required for external gateway profile");
  }

  const providerSecretRefService = providerSecretRefRepo
    ? new ProviderSecretRefService({
      repository: providerSecretRefRepo,
      logger: logger.child({ module: "provider-secret-refs" }),
      masterKey: Bun.env.SPACESKIT_SECRET_REF_MASTER_KEY,
    })
    : undefined;

  const spaceMcpService = new SpaceMcpService({
    capabilities,
    spaceAdminService,
    profileRepo,
    endpointRepo: spaceMcpEndpointRepo,
    bindingRepo: spaceExternalAgentBindingRepo,
    providerSecretRefService,
    gatewayProfile: config.gatewayProfile,
    logger: logger.child({ module: "space-mcp" }),
    globalFallback: config.mcpEndpoint
      ? {
        transport: config.mcpEndpoint.startsWith("http") ? "sse" : "stdio",
        endpoint: config.mcpEndpoint,
        secretRef: Bun.env.SPACESKIT_MCP_SECRET_REF,
      }
      : undefined,
  });

  try {
    await spaceMcpService.initialize();
  } catch (error) {
    logger.warn("Space MCP service initialization failed", error as Record<string, unknown>);
  }

  const cliToolManifestRoot = join(databaseRootFolder ?? config.spacesRoot, "cli-tools");
  const cliToolService = spaceWorkspaceService
    ? new CliToolService({
      capabilities,
      logger: logger.child({ module: "cli-tools" }),
      gatewayProfile: config.gatewayProfile,
      manifestRoot: cliToolManifestRoot,
      executableResolver: new LocalExecutableResolver(),
      workspaceService: spaceWorkspaceService,
    })
    : null;

  const interconnectorCatalogService = new InterconnectorCatalogService({
    enabled: true,
    gatewayProfile: config.gatewayProfile,
    manifestRoot: cliToolManifestRoot,
    logger: logger.child({ module: "interconnectors" }),
    cliToolService,
  });

  const interconnectorStartup = await interconnectorCatalogService.prepareStartup();

  if (cliToolService) {
    await cliToolService.initialize();
    await interconnectorCatalogService.applyHealth();
    logger.info("CLI tool service initialized", {
      manifestRoot: cliToolManifestRoot,
      gatewayProfile: config.gatewayProfile,
    });
  }
  logger.info("Interconnector catalog prepared", {
    manifestRoot: cliToolManifestRoot,
    gatewayProfile: config.gatewayProfile,
    detectedBundles: interconnectorStartup.bundleIds,
    detected: interconnectorStartup.detected,
  });

  const toolApprovalGrantService = toolApprovalGrantRepo
    ? new ToolApprovalGrantService({ repository: toolApprovalGrantRepo })
    : null;
  const accessGrantService = accessGrantRepo
    ? new AccessGrantService({ repository: accessGrantRepo })
    : null;
  const appleFoundationAvailability = await probeAppleFoundationAvailability(
    logger.child({ module: "apple-foundation-provider" }),
    config.enableAppleFoundationProvider,
  );

  const gatewayAdminService = new DefaultGatewayAdminService({
    logger: logger.child({ module: "gateway-admin" }),
    profileRepo,
    spaceAdminService,
    spaceRepo: state.spaceRepo ?? undefined,
    mainSpaceId: config.mainSpaceId,
    mainSpaceName: config.mainSpaceName,
    mainSpaceResourceId: config.mainSpaceResourceId,
    mainSpaceGoal: config.mainSpaceGoal,
    mainProfileId: config.mainProfileId,
    mainAgentId: config.mainAgentId,
    conciergeSpaceId: config.conciergeSpaceId,
    conciergeSpaceName: config.conciergeSpaceName,
    conciergeSpaceResourceId: config.conciergeSpaceResourceId,
    conciergeSpaceGoal: config.conciergeSpaceGoal,
    conciergeProfileId: config.conciergeProfileId,
    conciergeAgentId: config.conciergeAgentId,
    mainAgentSwapEnabled: config.mainAgentSwapEnabled,
    mainAgentAutoRepairEnabled: config.mainAgentAutoRepairEnabled,
    providerSecretRefService,
    providerConfigRepo: providerConfigRepo ?? undefined,
    gatewayRuntimeDefaultsRepo: gatewayRuntimeDefaultsRepo ?? undefined,
    integrationRequestRepo: integrationRequestRepo ?? undefined,
    cliToolService: cliToolService ?? undefined,
    interconnectorCatalogService,
    accessGrantService: accessGrantService ?? undefined,
    toolApprovalGrantService: toolApprovalGrantService ?? undefined,
    gatewayProfile: config.gatewayProfile,
    defaultProviderId: config.modelProvider,
    defaultModelId: config.defaultModelId,
    defaultApiKey: config.apiKey,
    enableAppleFoundationProvider: config.enableAppleFoundationProvider,
    appleFoundationAvailability,
  });
  logger.info("Gateway admin service initialized");

  const seededProviders = gatewayAdminService.listProviderConfigs();
  if (seededProviders.length === 0) {
    logger.warn(
      "No execution credentials or local runtimes detected. Agent runs will fail. " +
      "Set OPENROUTER_API_KEY, OPENAI_API_KEY, GROQ_API_KEY, TOGETHER_API_KEY, or MISTRAL_API_KEY, or configure a supported CLI/local runtime.",
    );
  }

  const connectorAdminService = connectorFamilyRepo
    && connectorInstanceRepo
    && connectorBindingRepo
    && connectorPolicyRepo
    && connectorSecretRefRepo
    ? new ConnectorAdminService({
      logger: logger.child({ module: "connector-admin" }),
      gatewayProfile: config.gatewayProfile,
      familyRepo: connectorFamilyRepo,
      instanceRepo: connectorInstanceRepo,
      bindingRepo: connectorBindingRepo,
      policyRepo: connectorPolicyRepo,
      secretRefRepo: connectorSecretRefRepo,
      auditRepo: auditEventsRepo,
      defaultTargetSpaceId: config.mainSpaceId,
      enableWhatsappFamily: config.enableWhatsappConnectorFamily,
      enableDiscordFamily: config.enableDiscordConnectorFamily,
    })
    : null;

  if (connectorAdminService) {
    logger.info("Connector admin service initialized", {
      profile: config.gatewayProfile,
    });
  }

  Object.assign(state, {
    accessGrantService,
    appleFoundationAvailability,
    cliToolService,
    connectorAdminService,
    interconnectorCatalogService,
    gatewayAdminService,
    providerSecretRefService,
    seededProviders,
    spaceMcpService,
    toolApprovalGrantService,
  });
}
