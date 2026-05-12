import { MessageRouter } from "../src/message-router.js";
import { type GatewayMessage } from "../src/protocol.js";

export interface SpaceLike {
  id: string;
  resourceId: string;
  name: string;
  goal?: string;
  orchestratorProfileId?: string;
  turnModel: string;
  agents: Array<Record<string, unknown>>;
  capabilities: string[];
  capabilityOverrides: Record<string, string>;
  visibility: "shared" | "private";
  createdAt: string;
  updatedAt: string;
}

export const defaultSpace: SpaceLike = {
  id: "space-main",
  resourceId: "resource-main",
  name: "Main Space",
  goal: "Coordinate default flows",
  turnModel: "sequential_all",
  agents: [],
  capabilities: [],
  capabilityOverrides: {},
  visibility: "shared",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

export const defaultAssignment = {
  spaceId: "space-main",
  agentId: "agent-main",
  profileId: "profile-main",
  role: "participant",
  turnOrder: 0,
  isPrimary: true,
  assignedAt: new Date().toISOString(),
};

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
  spaceAdminService?: Record<string, unknown>,
  options: {
    broadcastToSpace?: (spaceId: string, msg: GatewayMessage) => void;
    spaceManager?: Record<string, unknown>;
    turnHistoryService?: Record<string, unknown>;
    spaceMemoryPolicyService?: Record<string, unknown>;
    spaceMcpService?: Record<string, unknown>;
    spaceWorkspaceService?: Record<string, unknown>;
    spaceQuotaService?: Record<string, unknown>;
  } = {},
): MessageRouter {
  const logger: any = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    child: () => logger,
  };

  return new MessageRouter({
    spaceManager: options.spaceManager ?? {
      executeTurn: async () => ({ turnId: "turn-1" }),
      resumeFeedback: async () => {},
      invalidateCache: () => {},
    } as any,
    spaceAdminService: spaceAdminService as any,
    capabilities: {
      invoke: async () => ({ ok: true }),
      register: () => {},
      deregister: () => {},
    } as any,
    logger,
    broadcastToSpace: options.broadcastToSpace,
    turnHistoryService: options.turnHistoryService as any,
    spaceMemoryPolicyService: options.spaceMemoryPolicyService as any,
    spaceMcpService: options.spaceMcpService as any,
    spaceWorkspaceService: options.spaceWorkspaceService as any,
    spaceQuotaService: options.spaceQuotaService as any,
  });
}
