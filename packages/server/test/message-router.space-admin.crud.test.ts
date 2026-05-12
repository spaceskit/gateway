import { describe, expect, test } from "bun:test";
import { MessageTypes } from "../src/protocol.js";
import {
  defaultAssignment,
  defaultSpace,
  makeClient,
  makeMessage,
  makeRouter,
  type SpaceLike,
} from "./message-router.space-admin-test-helpers.js";

describe("MessageRouter space admin handlers", () => {
  test("returns NOT_AVAILABLE when space admin service is not configured", async () => {
    const router = makeRouter(undefined);
    const msg = makeMessage(MessageTypes.SPACE_LIST, {});
    const response = await router.handle(makeClient(), msg);

    expect(response).not.toBeNull();
    expect(response?.type).toBe(MessageTypes.ERROR);
    expect((response?.payload as any).code).toBe("FAILED_PRECONDITION");
    expect((response?.payload as any).retryable).toBe(false);
    expect((response?.payload as any).correlationId).toBe(msg.id);
  });

  test("validates required fields for space.create", async () => {
    const router = makeRouter({
      createSpace: async () => defaultSpace,
    });
    const msg = makeMessage(MessageTypes.SPACE_CREATE, { name: "Missing Resource" });
    const response = await router.handle(makeClient(), msg);

    expect(response?.type).toBe(MessageTypes.ERROR);
    expect((response?.payload as any).code).toBe("INVALID_ARGUMENT");
    expect((response?.payload as any).correlationId).toBe(msg.id);
  });

  test("routes space.create and returns created space", async () => {
    let receivedInput: any = null;
    const createdSpace: SpaceLike = { ...defaultSpace, id: "space-created", name: "Created Space" };

    const router = makeRouter({
      createSpace: async (input: any) => {
        receivedInput = input;
        return createdSpace;
      },
    });

    const msg = makeMessage(MessageTypes.SPACE_CREATE, {
      resourceId: "resource-a",
      name: "Created Space",
      spaceType: "space",
      visibility: "shared",
      thinkingCapturePolicy: "FULL",
      initialAgents: [
        {
          agentId: "agent-a",
          profileId: "profile-a",
          role: "participant",
          turnOrder: 0,
          isPrimary: true,
        },
      ],
    });

    const response = await router.handle(makeClient(), msg);

    expect(response?.type).toBe(MessageTypes.SPACE_CREATE);
    expect(response?.replyTo).toBe(msg.id);
    expect((response?.payload as any).space.id).toBe("space-created");
    expect(receivedInput).not.toBeNull();
    expect(receivedInput.resourceId).toBe("resource-a");
    expect(receivedInput.thinkingCapturePolicy).toBe("FULL");
    expect(receivedInput.initialAgents.length).toBe(1);
    expect(receivedInput.initialAgents[0].agentId).toBe("agent-a");
  });

  test("filters invalid statuses for space.list before invoking service", async () => {
    let receivedOptions: any = null;
    const router = makeRouter({
      listSpaces: async (options: any) => {
        receivedOptions = options;
        return [];
      },
    });

    const msg = makeMessage(MessageTypes.SPACE_LIST, {
      statuses: ["created", "active", "nope", "failed"],
      limit: 5,
    });

    const response = await router.handle(makeClient(), msg);

    expect(response?.type).toBe(MessageTypes.SPACE_LIST);
    expect((response?.payload as any).spaces).toEqual([]);
    expect(receivedOptions.statuses).toEqual(["created", "active", "failed"]);
    expect(receivedOptions.limit).toBe(5);
  });

  test("routes space.add_agent and includes updated space", async () => {
    const router = makeRouter({
      addAgent: async () => defaultAssignment,
      getSpace: async () => ({ ...defaultSpace, agents: [defaultAssignment] }),
    });

    const msg = makeMessage(MessageTypes.SPACE_ADD_AGENT, {
      spaceId: "space-main",
      agentId: "agent-main",
      profileId: "profile-main",
    });

    const response = await router.handle(makeClient(), msg);

    expect(response?.type).toBe(MessageTypes.SPACE_ADD_AGENT);
    expect((response?.payload as any).assignment.agentId).toBe("agent-main");
    expect((response?.payload as any).space.id).toBe("space-main");
  });

  test("validates required fields for space.add_agent", async () => {
    const router = makeRouter({
      addAgent: async () => defaultAssignment,
      getSpace: async () => defaultSpace,
    });

    const msg = makeMessage(MessageTypes.SPACE_ADD_AGENT, {
      spaceId: "space-main",
      agentId: "agent-main",
    });

    const response = await router.handle(makeClient(), msg);

    expect(response?.type).toBe(MessageTypes.ERROR);
    expect((response?.payload as any).code).toBe("INVALID_ARGUMENT");
  });

  test("routes space.remove_agent and returns removal response", async () => {
    const router = makeRouter({
      removeAgent: async () => true,
      getSpace: async () => ({ ...defaultSpace, agents: [] }),
    });

    const msg = makeMessage(MessageTypes.SPACE_REMOVE_AGENT, {
      spaceId: "space-main",
      agentId: "agent-main",
    });

    const response = await router.handle(makeClient(), msg);

    expect(response?.type).toBe(MessageTypes.SPACE_REMOVE_AGENT);
    expect((response?.payload as any).removed).toBe(true);
    expect((response?.payload as any).spaceId).toBe("space-main");
  });
});
