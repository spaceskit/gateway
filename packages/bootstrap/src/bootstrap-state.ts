import type {
  AgentVersionManager,
  CapabilityRegistry,
  CheckpointManager,
  ConfigHotReloader,
  DeadLetterQueue,
  EventBus,
  MemoryProviderRegistry,
  MiddlewarePipeline,
  ModelRouter,
  NotificationService,
  PluginSystem,
  SpaceAdminService,
  SpaceManager,
} from "@spaceskit/core";
import type { Logger } from "@spaceskit/observability";
import type { DatabaseManager } from "@spaceskit/persistence";
import type { GatewayServer } from "@spaceskit/server";
import type { ConnectorAdminService } from "./services/connector-admin-service.js";
import type { GatewayConfig } from "./config.js";
import type { DefaultGatewayAdminService } from "./gateway-admin-service.js";

export interface GatewayInstance {
  config: GatewayConfig;
  logger: Logger;
  eventBus: EventBus;
  capabilities: CapabilityRegistry;
  middleware: MiddlewarePipeline;
  spaceManager: SpaceManager;
  spaceAdminService: SpaceAdminService;
  gatewayAdminService: DefaultGatewayAdminService;
  connectorAdminService: ConnectorAdminService | null;
  memoryRegistry: MemoryProviderRegistry;
  notificationService: NotificationService;
  checkpointManager: CheckpointManager | null;
  deadLetterQueue: DeadLetterQueue | null;
  modelRouter: ModelRouter | null;
  orchestratorCommandService: any;
  pluginSystem: PluginSystem;
  agentVersionManager: AgentVersionManager;
  configReloader: ConfigHotReloader<GatewayConfig> | null;
  db: DatabaseManager | null;
  server: GatewayServer | null;
  shutdown: () => Promise<void>;
}

export interface BootstrapState {
  config: GatewayConfig;
  databaseRootFolder: string | null;
  resolvedGatewayUuidSeed: string;
  gatewayUuid: string;
  logger: Logger;
  configuredGrants: any;
  gatewayCoreState: any;
  appliedCapabilityGrants: string[];
  skippedCapabilityGrants: string[];
  invalidCapabilityGrants: string[];
  eventBus: EventBus;
  capabilities: CapabilityRegistry;
  executionAdapterFactory: any;
  [key: string]: any;
}
