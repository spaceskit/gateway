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

export function makeRouter(
  gatewayAdminService?: Record<string, unknown>,
  gatewayKnowledgeBaseService?: Record<string, unknown>,
  gatewayResetService?: Record<string, unknown>,
  spaceSharingService?: Record<string, unknown>,
  spaceManagerOverrides?: Record<string, unknown>,
  spaceQuotaService?: Record<string, unknown>,
  broadcastToSpace?: (spaceUid: string, msg: GatewayMessage) => void,
  conciergeEscalationService?: Record<string, unknown>,
): MessageRouter {
  const logger: any = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    child: () => logger,
  };

  return new MessageRouter({
    spaceManager: {
      executeTurn: async () => ({ turnId: "turn-1" }),
      resumeFeedback: async () => {},
      invalidateCache: () => {},
      ...spaceManagerOverrides,
    } as any,
    spaceAdminService: undefined,
    gatewayAdminService: gatewayAdminService as any,
    gatewayKnowledgeBaseService: gatewayKnowledgeBaseService as any,
    gatewayResetService: gatewayResetService as any,
    spaceSharingService: spaceSharingService as any,
    spaceQuotaService: spaceQuotaService as any,
    capabilities: {
      invoke: async () => ({ ok: true }),
      register: () => {},
      deregister: () => {},
    } as any,
    logger,
    conciergeEscalationService: conciergeEscalationService as any,
    broadcastToSpace,
  });
}
