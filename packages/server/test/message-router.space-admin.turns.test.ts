import { describe, expect, test } from "bun:test";
import { MessageTypes } from "../src/protocol.js";
import {
  defaultSpace,
  makeClient,
  makeMessage,
  makeRouter,
} from "./message-router.space-admin-test-helpers.js";

describe("MessageRouter space admin handlers", () => {
  test("routes space.list_turns with deterministic pagination metadata", async () => {
    const createdAt = new Date().toISOString();
    const completedAt = new Date().toISOString();
    const router = makeRouter(
      {
        getSpace: async (spaceId: string) => ({
          ...defaultSpace,
          id: spaceId,
          spaceUid: "11111111-1111-1111-8111-111111111111",
        }),
      },
      {
        turnHistoryService: {
          listSpaceTurns: async (input: { spaceId: string; limit: number; offset: number }) => {
            expect(input.spaceId).toBe("space-main");
            expect(input.limit).toBe(2);
            expect(input.offset).toBe(0);
            return {
              turns: [
                {
                  turnId: "turn-1",
                  agentId: "agent-main",
                  status: "completed",
                  inputText: "hello",
                  outputText: "world",
                  promptTokens: 11,
                  completionTokens: 7,
                  totalTokens: 18,
                  createdAt,
                  completedAt,
                },
                {
                  turnId: "turn-2",
                  agentId: "agent-main",
                  status: "completed",
                  inputText: "hi",
                  outputText: "there",
                  promptTokens: 13,
                  completionTokens: 5,
                  totalTokens: 18,
                  createdAt,
                  completedAt,
                },
              ],
              total: 5,
            };
          },
        },
      },
    );

    const response = await router.handle(
      makeClient(),
      makeMessage(MessageTypes.SPACE_LIST_TURNS, {
        spaceId: "space-main",
        limit: 2,
        offset: 0,
      }),
    );

    expect(response?.type).toBe(MessageTypes.SPACE_LIST_TURNS);
    expect((response?.payload as any).spaceId).toBe("space-main");
    expect((response?.payload as any).spaceUid).toBe("11111111-1111-1111-8111-111111111111");
    expect((response?.payload as any).turns.length).toBe(2);
    expect((response?.payload as any).turns[0].promptTokens).toBe(11);
    expect((response?.payload as any).turns[0].completionTokens).toBe(7);
    expect((response?.payload as any).turns[0].totalTokens).toBe(18);
    expect((response?.payload as any).total).toBe(5);
    expect((response?.payload as any).nextOffset).toBe(2);
  });

  test("routes space.list_turns cursor delta reads via lastSeenTurnId", async () => {
    const createdAt = new Date().toISOString();
    const router = makeRouter(
      {
        getSpace: async (spaceId: string) => ({
          ...defaultSpace,
          id: spaceId,
          spaceUid: "11111111-1111-1111-8111-111111111111",
        }),
      },
      {
        turnHistoryService: {
          listSpaceTurns: async (input: {
            spaceId: string;
            limit: number;
            offset: number;
            lastSeenTurnId?: string;
          }) => {
            expect(input.spaceId).toBe("space-main");
            expect(input.limit).toBe(20);
            expect(input.offset).toBe(0);
            expect(input.lastSeenTurnId).toBe("turn-seen-1");
            return {
              turns: [
                {
                  turnId: "turn-2",
                  agentId: "agent-main",
                  status: "completed",
                  inputText: "delta input",
                  outputText: "delta output",
                  promptTokens: 4,
                  completionTokens: 6,
                  totalTokens: 10,
                  createdAt,
                  completedAt: createdAt,
                },
              ],
              total: 1,
            };
          },
        },
      },
    );

    const response = await router.handle(
      makeClient(),
      makeMessage(MessageTypes.SPACE_LIST_TURNS, {
        spaceId: "space-main",
        limit: 20,
        offset: 999,
        lastSeenTurnId: "turn-seen-1",
      }),
    );

    expect(response?.type).toBe(MessageTypes.SPACE_LIST_TURNS);
    expect((response?.payload as any).turns.length).toBe(1);
    expect((response?.payload as any).total).toBe(1);
    expect((response?.payload as any).nextOffset).toBeUndefined();
  });

  test("validates required space identifier for space.list_turns", async () => {
    const router = makeRouter(
      {
        getSpace: async () => ({ ...defaultSpace, spaceUid: "space-uid-main" }),
      },
      {
        turnHistoryService: {
          listSpaceTurns: async () => ({ turns: [], total: 0 }),
        },
      },
    );

    const response = await router.handle(
      makeClient(),
      makeMessage(MessageTypes.SPACE_LIST_TURNS, {
        limit: 100,
        offset: 0,
      }),
    );

    expect(response?.type).toBe(MessageTypes.ERROR);
    expect((response?.payload as any).code).toBe("INVALID_ARGUMENT");
  });

  test("returns NOT_AVAILABLE when turn history service is not configured", async () => {
    const router = makeRouter({
      getSpace: async () => ({ ...defaultSpace, spaceUid: "space-uid-main" }),
    });

    const response = await router.handle(
      makeClient(),
      makeMessage(MessageTypes.SPACE_LIST_TURNS, {
        spaceId: "space-main",
        limit: 100,
        offset: 0,
      }),
    );

    expect(response?.type).toBe(MessageTypes.ERROR);
    expect((response?.payload as any).code).toBe("FAILED_PRECONDITION");
  });

  test("maps space admin typed errors into protocol error responses", async () => {
    const router = makeRouter({
      createSpace: async () => {
        throw {
          code: "ALREADY_EXISTS",
          message: "Space already exists",
        };
      },
    });

    const msg = makeMessage(MessageTypes.SPACE_CREATE, {
      resourceId: "resource-a",
      name: "Existing Space",
    });

    const response = await router.handle(makeClient(), msg);

    expect(response?.type).toBe(MessageTypes.ERROR);
    expect((response?.payload as any).code).toBe("ALREADY_EXISTS");
    expect((response?.payload as any).message).toContain("already");
  });
});
