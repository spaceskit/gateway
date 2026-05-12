import { describe, expect, test } from "bun:test";
import { MessageTypes } from "../src/protocol.js";
import { makeClient, makeMessage, makeRouter } from "./message-router.feature-flows-test-helpers.js";

describe("MessageRouter feature handlers", () => {
  test("routes execute_turn with implicit owner full_access context", async () => {
    const executeTurnCalls: Array<[string, string, string | undefined, any]> = [];
    const router = makeRouter({
      spaceSharingService: {
        evaluateAccess: () => ({ allowed: true, enforced: false, mode: "collaborator" }),
        getActiveParticipant: () => null,
      },
      spaceManager: {
        executeTurn: async (
          spaceId: string,
          input: string,
          targetAgentId?: string,
          identity?: {
            principalId?: string;
            deviceId?: string;
            mode?: string;
            effort?: string;
          },
        ) => {
          executeTurnCalls.push([spaceId, input, targetAgentId, identity]);
          return { turnId: "turn-context" };
        },
        resumeFeedback: async () => {},
      },
    });

    const response = await router.handle(
      makeClient({ publicKey: "principal-1", deviceId: "device-1" }),
      makeMessage(MessageTypes.EXECUTE_TURN, {
        spaceUid: "main-space",
        input: "hello",
        mode: "plan",
        effort: "high",
        accessMode: "full_access",
      }),
    );

    expect(response?.type).toBe(MessageTypes.TURN_EVENT);
    expect(executeTurnCalls).toEqual([
      [
        "main-space",
        "hello",
        undefined,
        {
          principalId: "principal-1",
          deviceId: "device-1",
          executionOrigin: "owner",
          accessMode: "full_access",
          mode: "plan",
          effort: "high",
        },
      ],
    ]);
  });

  test("preserves full_access for implicit owner in an unshared space", async () => {
    const executeTurnCalls: Array<[string, string, string | undefined, any]> = [];
    const router = makeRouter({
      spaceSharingService: {
        evaluateAccess: () => ({ allowed: true, enforced: false, mode: "collaborator" }),
        getActiveParticipant: () => null,
      },
      spaceManager: {
        executeTurn: async (
          spaceId: string,
          input: string,
          targetAgentId?: string,
          identity?: {
            principalId?: string;
            deviceId?: string;
            executionOrigin?: string;
            accessMode?: string;
          },
        ) => {
          executeTurnCalls.push([spaceId, input, targetAgentId, identity]);
          return { turnId: "turn-full-access" };
        },
        resumeFeedback: async () => {},
      },
    });

    const response = await router.handle(
      makeClient({ publicKey: "principal-1", deviceId: "device-1" }),
      makeMessage(MessageTypes.EXECUTE_TURN, {
        spaceUid: "main-space",
        input: "hello",
        accessMode: "full_access",
      }),
    );

    expect(response?.type).toBe(MessageTypes.TURN_EVENT);
    expect(executeTurnCalls).toEqual([
      [
        "main-space",
        "hello",
        undefined,
        {
          principalId: "principal-1",
          deviceId: "device-1",
          executionOrigin: "owner",
          accessMode: "full_access",
          mode: undefined,
          effort: undefined,
        },
      ],
    ]);
  });

  test("creates continuity sessions using stable principal identity during execute_turn", async () => {
    const continuityCalls: Array<[string, string, string]> = [];
    const router = makeRouter({
      sessionContinuityManager: {
        getOrCreate: async (spaceId: string, clientId: string, mode: string) => {
          continuityCalls.push([spaceId, clientId, mode]);
          return {
            sessionId: "session-1",
            spaceId,
            clientId,
            continuityMode: mode,
            status: "active",
            lastActivityAt: new Date(),
          };
        },
      },
      spaceManager: {
        executeTurn: async () => ({ turnId: "turn-1" }),
        resumeFeedback: async () => {},
      },
    });

    await router.handle(
      makeClient({ id: "ws-client-1", publicKey: "principal-1", deviceId: "device-1" }),
      makeMessage(MessageTypes.EXECUTE_TURN, {
        spaceUid: "main-space",
        input: "hello",
      }),
    );

    expect(continuityCalls).toEqual([
      ["main-space", "principal:principal-1", "session"],
    ]);
  });

  test("normalizes execute_turn identifiers before dispatch", async () => {
    const executeTurnCalls: Array<[string, string, string | undefined]> = [];
    const router = makeRouter({
      spaceManager: {
        executeTurn: async (
          spaceId: string,
          input: string,
          targetAgentId?: string,
        ) => {
          executeTurnCalls.push([spaceId, input, targetAgentId]);
          return { turnId: "turn-normalized" };
        },
        resumeFeedback: async () => {},
      },
    });

    const response = await router.handle(
      makeClient(),
      makeMessage(MessageTypes.EXECUTE_TURN, {
        spaceUid: "  main-space  ",
        input: "hello",
        targetAgentId: "   ",
      }),
    );

    expect(response?.type).toBe(MessageTypes.TURN_EVENT);
    expect((response?.payload as any).spaceId).toBe("main-space");
    expect(executeTurnCalls).toEqual([
      ["main-space", "hello", undefined],
    ]);
  });

  test("forwards per-turn topology, reply, and target agent subset into execute_turn", async () => {
    const executeTurnCalls: Array<[string, string, string | undefined, any]> = [];
    const router = makeRouter({
      spaceSharingService: {
        evaluateAccess: () => ({ allowed: true, enforced: false, mode: "collaborator" }),
        getActiveParticipant: () => null,
      },
      spaceManager: {
        executeTurn: async (
          spaceId: string,
          input: string,
          targetAgentId?: string,
          identity?: Record<string, unknown>,
        ) => {
          executeTurnCalls.push([spaceId, input, targetAgentId, identity]);
          return { turnId: "turn-topology-contract" };
        },
        resumeFeedback: async () => {},
      },
    });

    const response = await router.handle(
      makeClient({ publicKey: "principal-1", deviceId: "device-1" }),
      makeMessage(MessageTypes.EXECUTE_TURN, {
        spaceUid: "main-space",
        input: "discuss the plan",
        targetAgentIds: [" plan-coordinator ", "plan-codex-architect", "plan-coordinator"],
        replyToTurnId: " root-turn ",
        conversationTopology: "broadcast_team",
      }),
    );

    expect(response?.type).toBe(MessageTypes.TURN_EVENT);
    expect(executeTurnCalls).toEqual([
      [
        "main-space",
        "discuss the plan",
        undefined,
        {
          principalId: "principal-1",
          deviceId: "device-1",
          executionOrigin: "owner",
          accessMode: "default",
          mode: undefined,
          effort: undefined,
          targetAgentIds: ["plan-coordinator", "plan-codex-architect"],
          replyToTurnId: "root-turn",
          conversationTopology: "broadcast_team",
        },
      ],
    ]);
  });

  test("marks execute_turn identity as guest for invite-joined participants", async () => {
    const executeTurnCalls: Array<[string, string, string | undefined, any]> = [];
    const router = makeRouter({
      spaceManager: {
        executeTurn: async (
          spaceId: string,
          input: string,
          targetAgentId?: string,
          identity?: { principalId?: string; deviceId?: string; executionOrigin?: string },
        ) => {
          executeTurnCalls.push([spaceId, input, targetAgentId, identity]);
          return { turnId: "turn-guest-origin" };
        },
        resumeFeedback: async () => {},
      },
      spaceSharingService: {
        evaluateAccess: () => ({ allowed: true, enforced: true, mode: "collaborator" }),
        getActiveParticipant: () => ({
          participantId: "participant-1",
          mode: "collaborator",
          joinedViaInviteId: "invite-123",
        }),
      },
    });

    const response = await router.handle(
      makeClient({ publicKey: "guest-principal", deviceId: "device-guest" }),
      makeMessage(MessageTypes.EXECUTE_TURN, {
        spaceUid: "main-space",
        input: "guest turn",
      }),
    );

    expect(response?.type).toBe(MessageTypes.TURN_EVENT);
    expect(executeTurnCalls).toEqual([
      [
        "main-space",
        "guest turn",
        undefined,
        { principalId: "guest-principal", deviceId: "device-guest", executionOrigin: "guest", accessMode: "default" },
      ],
    ]);
  });

  test("rejects execute_turn when spaceUid is blank after trimming", async () => {
    let called = false;
    const router = makeRouter({
      spaceManager: {
        executeTurn: async () => {
          called = true;
          return { turnId: "turn-should-not-run" };
        },
        resumeFeedback: async () => {},
      },
    });

    const response = await router.handle(
      makeClient(),
      makeMessage(MessageTypes.EXECUTE_TURN, {
        spaceUid: "   ",
        input: "hello",
      }),
    );

    expect(response?.type).toBe(MessageTypes.ERROR);
    expect((response?.payload as any).code).toBe("INVALID_ARGUMENT");
    expect((response?.payload as any).message).toContain("spaceUid and input are required");
    expect(called).toBe(false);
  });
});
