import { MessageRouter } from "../src/message-router.js";
import { type GatewayMessage } from "../src/protocol.js";

export function makeClient(overrides: Record<string, unknown> = {}): any {
  return {
    id: "client-1",
    authenticated: true,
    clientType: "sdk",
    subscribedSpaces: new Set<string>(),
    connectedAt: new Date(),
    ...overrides,
  };
}

export function makeMessage<T>(type: string, payload: T): GatewayMessage<T> {
  return {
    type,
    id: crypto.randomUUID(),
    ts: new Date().toISOString(),
    payload,
  };
}

export function makeRouter(options: {
  spaceManager?: Record<string, unknown>;
  gatewayPolicyService?: Record<string, unknown>;
  gatewayCapabilityAccessService?: Record<string, unknown>;
  gatewayAdminService?: Record<string, unknown>;
  usageSnapshotService?: Record<string, unknown>;
  connectorAdminService?: Record<string, unknown>;
  orchestratorCommandService?: Record<string, unknown>;
  spaceSharingService?: Record<string, unknown>;
  spaceContextService?: Record<string, unknown>;
  gatewaySyncService?: Record<string, unknown>;
  speechSessionService?: Record<string, unknown>;
  sessionContinuityManager?: Record<string, unknown>;
  broadcastToSpace?: (spaceId: string, message: GatewayMessage) => void;
} = {}): MessageRouter {
  const logger: any = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    child: () => logger,
  };
  const defaultSpaceManager: any = {
    executeTurn: async () => ({ turnId: "turn-1" }),
    resumeFeedback: async () => {},
  };

  return new MessageRouter({
    spaceManager: (options.spaceManager as any) ?? defaultSpaceManager,
    capabilities: {
      invoke: async () => ({ ok: true }),
      register: () => {},
      deregister: () => {},
    } as any,
    logger,
    gatewayAdminService: options.gatewayAdminService as any,
    gatewayPolicyService: options.gatewayPolicyService as any,
    gatewayCapabilityAccessService: options.gatewayCapabilityAccessService as any,
    usageSnapshotService: options.usageSnapshotService as any,
    connectorAdminService: options.connectorAdminService as any,
    orchestratorCommandService: options.orchestratorCommandService as any,
    spaceSharingService: options.spaceSharingService as any,
    spaceContextService: options.spaceContextService as any,
    gatewaySyncService: options.gatewaySyncService as any,
    speechSessionService: options.speechSessionService as any,
    sessionContinuityManager: options.sessionContinuityManager as any,
    broadcastToSpace: options.broadcastToSpace,
  });
}
