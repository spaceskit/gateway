import { describe, expect, test } from "bun:test";
import { MessageTypes, type GatewayMessage } from "../src/protocol.js";
import {
  defaultAssignment,
  defaultSpace,
  makeClient,
  makeMessage,
  makeRouter,
} from "./message-router.space-admin-test-helpers.js";

describe("MessageRouter space admin handlers", () => {
  test("routes space.update_agent_assignment", async () => {
    const updatedAssignment = { ...defaultAssignment, role: "global_coordinator" };
    const router = makeRouter({
      listAgentAssignments: async () => [defaultAssignment],
      updateAgentAssignment: async () => updatedAssignment,
      getSpace: async () => ({ ...defaultSpace, agents: [updatedAssignment] }),
    });

    const msg = makeMessage(MessageTypes.SPACE_UPDATE_AGENT_ASSIGNMENT, {
      spaceId: "space-main",
      agentId: "agent-main",
      role: "global_coordinator",
    });

    const response = await router.handle(makeClient(), msg);

    expect(response?.type).toBe(MessageTypes.SPACE_UPDATE_AGENT_ASSIGNMENT);
    expect((response?.payload as any).assignment.role).toBe("global_coordinator");
  });

  test("broadcasts space.agent_updated when assignment profile changes", async () => {
    const updatedAssignment = { ...defaultAssignment, profileId: "profile-next" };
    const broadcasts: GatewayMessage[] = [];
    const router = makeRouter({
      listAgentAssignments: async () => [defaultAssignment],
      updateAgentAssignment: async () => updatedAssignment,
      getSpace: async () => ({ ...defaultSpace, agents: [updatedAssignment] }),
    }, {
      broadcastToSpace: (_spaceId, message) => {
        broadcasts.push(message);
      },
    });

    const msg = makeMessage(MessageTypes.SPACE_UPDATE_AGENT_ASSIGNMENT, {
      spaceId: "space-main",
      agentId: "agent-main",
      profileId: "profile-next",
    });

    const response = await router.handle(makeClient(), msg);
    expect(response?.type).toBe(MessageTypes.SPACE_UPDATE_AGENT_ASSIGNMENT);
    expect(broadcasts.length).toBe(1);
    expect(broadcasts[0].type).toBe(MessageTypes.SPACE_AGENT_UPDATED);
    expect((broadcasts[0].payload as any).oldProfileId).toBe("profile-main");
    expect((broadcasts[0].payload as any).newProfileId).toBe("profile-next");
  });

  test("resets agent usage session when profile changes", async () => {
    const updatedAssignment = { ...defaultAssignment, profileId: "profile-next" };
    let resetCalled = false;
    let resetArgs: Record<string, string> | null = null;

    const router = makeRouter({
      listAgentAssignments: async () => [defaultAssignment],
      updateAgentAssignment: async () => updatedAssignment,
      getSpace: async () => ({ ...defaultSpace, agents: [updatedAssignment] }),
    }, {
      broadcastToSpace: () => {},
      spaceQuotaService: {
        resetAgentUsageSession: (spaceId: string, agentId: string, principalId: string) => {
          resetCalled = true;
          resetArgs = { spaceId, agentId, principalId };
          return { sessionId: "new-session" };
        },
      },
    });

    const msg = makeMessage(MessageTypes.SPACE_UPDATE_AGENT_ASSIGNMENT, {
      spaceId: "space-main",
      agentId: "agent-main",
      profileId: "profile-next",
    });

    const response = await router.handle(
      makeClient({ publicKey: "pk-user-1" }),
      msg,
    );

    expect(response?.type).toBe(MessageTypes.SPACE_UPDATE_AGENT_ASSIGNMENT);
    expect(resetCalled).toBe(true);
    expect(resetArgs).toEqual({
      spaceId: "space-main",
      agentId: "agent-main",
      principalId: "pk-user-1",
    });
  });

  test("does not reset usage session when profile stays the same", async () => {
    const updatedAssignment = { ...defaultAssignment, role: "global_coordinator" };
    let resetCalled = false;

    const router = makeRouter({
      listAgentAssignments: async () => [defaultAssignment],
      updateAgentAssignment: async () => updatedAssignment,
      getSpace: async () => ({ ...defaultSpace, agents: [updatedAssignment] }),
    }, {
      spaceQuotaService: {
        resetAgentUsageSession: () => {
          resetCalled = true;
          return { sessionId: "new-session" };
        },
      },
    });

    const msg = makeMessage(MessageTypes.SPACE_UPDATE_AGENT_ASSIGNMENT, {
      spaceId: "space-main",
      agentId: "agent-main",
      role: "global_coordinator",
    });

    await router.handle(makeClient({ publicKey: "pk-user-1" }), msg);
    expect(resetCalled).toBe(false);
  });

  test("resets usage session and broadcasts when resetSession=true without profile change", async () => {
    const updatedAssignment = { ...defaultAssignment, role: "global_coordinator" };
    let resetCalled = false;
    const broadcasts: GatewayMessage[] = [];

    const router = makeRouter({
      listAgentAssignments: async () => [defaultAssignment],
      updateAgentAssignment: async () => updatedAssignment,
      getSpace: async () => ({ ...defaultSpace, agents: [updatedAssignment] }),
    }, {
      broadcastToSpace: (_spaceId, message) => {
        broadcasts.push(message);
      },
      spaceQuotaService: {
        resetAgentUsageSession: () => {
          resetCalled = true;
          return { sessionId: "new-session" };
        },
      },
    });

    const msg = makeMessage(MessageTypes.SPACE_UPDATE_AGENT_ASSIGNMENT, {
      spaceId: "space-main",
      agentId: "agent-main",
      role: "global_coordinator",
      resetSession: true,
    });

    const response = await router.handle(makeClient({ publicKey: "pk-user-1" }), msg);

    expect(response?.type).toBe(MessageTypes.SPACE_UPDATE_AGENT_ASSIGNMENT);
    expect(resetCalled).toBe(true);
    expect(broadcasts.length).toBe(1);
    expect(broadcasts[0].type).toBe(MessageTypes.SPACE_AGENT_UPDATED);
    expect((broadcasts[0].payload as any).oldProfileId).toBe("profile-main");
    expect((broadcasts[0].payload as any).newProfileId).toBe("profile-main");
  });

  test("uses deterministic fallback principal for session reset when publicKey is missing", async () => {
    const updatedAssignment = { ...defaultAssignment, profileId: "profile-next" };
    let resetArgs: { spaceId: string; agentId: string; principalId: string } | null = null;

    const router = makeRouter({
      listAgentAssignments: async () => [defaultAssignment],
      updateAgentAssignment: async () => updatedAssignment,
      getSpace: async () => ({ ...defaultSpace, agents: [updatedAssignment] }),
    }, {
      spaceQuotaService: {
        resetAgentUsageSession: (spaceId: string, agentId: string, principalId: string) => {
          resetArgs = { spaceId, agentId, principalId };
          return { sessionId: "new-session" };
        },
      },
    });

    const msg = makeMessage(MessageTypes.SPACE_UPDATE_AGENT_ASSIGNMENT, {
      spaceId: "space-main",
      agentId: "agent-main",
      profileId: "profile-next",
    });

    const response = await router.handle(makeClient({ publicKey: undefined, deviceId: "device-abc" }), msg);

    expect(response?.type).toBe(MessageTypes.SPACE_UPDATE_AGENT_ASSIGNMENT);
    expect(resetArgs).toEqual({
      spaceId: "space-main",
      agentId: "agent-main",
      principalId: "device:device-abc",
    });
  });
});
