// Server
export { GatewayServer } from "./gateway-server.js";
export { legacyEffectiveToolMatrixFromAccess } from "./effective-tool-matrix.js";

// Provider catalog helpers
export { classifyTier } from "./admin/provider-catalog/tier-classification.js";
export type { ModelTier } from "./admin/provider-catalog/tier-classification.js";
export type {
  GatewayServerOptions,
  ClientSession,
  HealthCheckContext,
  HealthStatus,
  SyncHttpHandler,
  SyncHttpError,
} from "./gateway-server.js";

// Protocol
export { MessageTypes } from "./protocol.js";
export type * from "./protocol.js";

// Message router
export { MessageRouter } from "./message-router.js";
export type {
  MessageRouterOptions,
  GatewayAdminService,
  GatewayResetService,
  SpaceWorkspaceService,
  SpaceMcpService,
} from "./message-router.js";

// A2A protocol bridge
export { A2AHandler } from "./a2a/a2a-handler.js";
export type { A2AHandlerOptions } from "./a2a/a2a-handler.js";
export type {
  A2AAgentCard,
  A2ATask,
  A2ATaskRequest,
  A2ATaskResponse,
  A2ATaskState,
  A2AMessage,
  A2APart,
  A2AArtifact,
  A2AStreamEvent,
  A2ACapabilities,
  A2ASkill,
  A2AAuthScheme,
} from "./a2a/types.js";

// A2A Push Notifications
export { A2APushNotificationHandler } from "./a2a/push-notification-handler.js";
export type { A2APushNotification, A2APushConfig, PushStatus } from "./a2a/push-notification-handler.js";

// Notification Handler
export { NotificationHandler } from "./notification-handler.js";

// Workflow Visualizer
export { WorkflowVisualizer, createDiagramHandler } from "./workflow-visualizer.js";
export type { WorkflowDiagram, TurnRecord } from "./workflow-visualizer.js";
