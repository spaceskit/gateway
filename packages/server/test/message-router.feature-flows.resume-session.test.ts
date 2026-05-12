import { describe, expect, test } from "bun:test";
import { MessageTypes } from "../src/protocol.js";
import { makeClient, makeMessage, makeRouter } from "./message-router.feature-flows-test-helpers.js";

describe("MessageRouter feature handlers", () => {
  test("normalizes resume_feedback identifiers before dispatch", async () => {
    const resumeFeedbackCalls: Array<[string, string, string, string | undefined, Record<string, unknown> | undefined]> = [];
    const router = makeRouter({
      spaceManager: {
        executeTurn: async () => ({ turnId: "turn-1" }),
        resumeFeedback: async (
          spaceId: string,
          turnId: string,
          response: string,
          revision?: string,
          options?: Record<string, unknown>,
        ) => {
          resumeFeedbackCalls.push([spaceId, turnId, response, revision, options]);
        },
      },
    });

    const response = await router.handle(
      makeClient({ publicKey: "principal-1", deviceId: "device-1" }),
      makeMessage(MessageTypes.RESUME_FEEDBACK, {
        spaceUid: "  main-space  ",
        turnId: "  turn-1  ",
        response: "approve",
        revision: "  revise this  ",
        approvalGrant: {
          mode: "durable",
        },
      }),
    );

    expect(response?.type).toBe(MessageTypes.TURN_EVENT);
    expect((response?.payload as any).spaceId).toBe("main-space");
    expect((response?.payload as any).turnId).toBe("turn-1");
    expect(resumeFeedbackCalls).toEqual([
      ["main-space", "turn-1", "approve", "revise this", {
        approvalGrant: { mode: "durable" },
        principalId: "principal-1",
        deviceId: "device-1",
      }],
    ]);
  });

  test("pauses tracked continuity sessions on client disconnect", async () => {
    const pauseCalls: Array<[string, string, any]> = [];
    const router = makeRouter({
      sessionContinuityManager: {
        getOrCreate: async (spaceId: string, clientId: string, mode: string) => ({
          sessionId: "session-1",
          spaceId,
          clientId,
          continuityMode: mode,
          status: "active",
          lastActivityAt: new Date(),
        }),
        pause: async (spaceId: string, clientId: string, state?: unknown) => {
          pauseCalls.push([spaceId, clientId, state]);
        },
      },
      spaceManager: {
        executeTurn: async () => ({ turnId: "turn-disconnect" }),
        resumeFeedback: async () => {},
        getActiveSpaceState: () => ({
          agentStates: {
            "agent-a": {
              status: "active",
              lastTurnId: "turn-disconnect",
              messages: [{ role: "user", content: "hello" }],
            },
          },
          turnIds: ["turn-disconnect"],
        }),
      },
    });

    const client = makeClient({ id: "ws-client-1", publicKey: "principal-1", deviceId: "device-1" });
    await router.handle(
      client,
      makeMessage(MessageTypes.EXECUTE_TURN, {
        spaceUid: "main-space",
        input: "hello",
      }),
    );

    router.onClientDisconnected(client as any);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(pauseCalls.length).toBe(1);
    expect(pauseCalls[0][0]).toBe("main-space");
    expect(pauseCalls[0][1]).toBe("principal:principal-1");
    expect(pauseCalls[0][2]).toEqual({
      agentStates: {
        "agent-a": {
          status: "active",
          lastTurnId: "turn-disconnect",
          messages: [{ role: "user", content: "hello" }],
        },
      },
      turnIds: ["turn-disconnect"],
    });
  });

  test("restores checkpoints during session.resume", async () => {
    const restored: Array<{ spaceId: string; checkpointAgentIds: string[] }> = [];
    const router = makeRouter({
      sessionContinuityManager: {
        resume: async (spaceId: string, clientId: string) => ({
          sessionId: `${spaceId}:${clientId}:resume`,
          spaceId,
          clientId,
          continuityMode: "session",
          checkpointId: "checkpoint-1",
          status: "active",
          lastActivityAt: new Date(),
        }),
        loadCheckpoint: async (checkpointId: string) => ({
          checkpointId,
          spaceId: "main-space",
          stateJson: "{}",
          configJson: "{}",
          turnIds: ["turn-100"],
          agentStates: {
            "agent-a": { status: "active", lastTurnId: "turn-100", messages: [{ role: "user", content: "hello" }] },
          },
          createdAt: new Date(),
        }),
      },
      spaceManager: {
        executeTurn: async () => ({ turnId: "turn-1" }),
        resumeFeedback: async () => {},
        restoreFromCheckpoint: async (spaceId: string, checkpoint: { agentStates: Record<string, unknown> }) => {
          restored.push({ spaceId, checkpointAgentIds: Object.keys(checkpoint.agentStates) });
          return true;
        },
      },
    });

    const response = await router.handle(
      makeClient({ id: "ws-client-2", publicKey: "principal-2" }),
      makeMessage(MessageTypes.SESSION_RESUME, { spaceId: "main-space" }),
    );

    expect(response?.type).toBe(MessageTypes.SESSION_RESUME);
    expect((response?.payload as any).resumed).toBe(true);
    expect((response?.payload as any).checkpointId).toBe("checkpoint-1");
    expect((response?.payload as any).lastTurnId).toBe("turn-100");
    expect(restored).toEqual([{ spaceId: "main-space", checkpointAgentIds: ["agent-a"] }]);
  });

  test("rejects resume_feedback when spaceUid is blank after trimming", async () => {
    let called = false;
    const router = makeRouter({
      spaceManager: {
        executeTurn: async () => ({ turnId: "turn-1" }),
        resumeFeedback: async () => {
          called = true;
        },
      },
    });

    const response = await router.handle(
      makeClient(),
      makeMessage(MessageTypes.RESUME_FEEDBACK, {
        spaceUid: "   ",
        turnId: "turn-1",
        response: "approve",
      }),
    );

    expect(response?.type).toBe(MessageTypes.ERROR);
    expect((response?.payload as any).code).toBe("INVALID_ARGUMENT");
    expect((response?.payload as any).message).toContain("spaceUid, turnId, and response are required");
    expect(called).toBe(false);
  });
});
