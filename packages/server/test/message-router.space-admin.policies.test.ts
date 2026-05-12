import { describe, expect, test } from "bun:test";
import { MessageTypes } from "../src/protocol.js";
import {
  defaultSpace,
  makeClient,
  makeMessage,
  makeRouter,
} from "./message-router.space-admin-test-helpers.js";

describe("MessageRouter space admin handlers", () => {
  test("routes space.set_orchestrator", async () => {
    const router = makeRouter({
      setSpaceOrchestrator: async () => ({
        ...defaultSpace,
        orchestratorProfileId: "profile-orchestrator",
      }),
    });

    const msg = makeMessage(MessageTypes.SPACE_SET_ORCHESTRATOR, {
      spaceId: "space-main",
      profileId: "profile-orchestrator",
    });

    const response = await router.handle(makeClient(), msg);

    expect(response?.type).toBe(MessageTypes.SPACE_SET_ORCHESTRATOR);
    expect((response?.payload as any).space.orchestratorProfileId).toBe("profile-orchestrator");
  });

  test("routes space.set_thinking_capture_policy", async () => {
    let received: { spaceId: string; policy: string } | null = null;
    const router = makeRouter({
      getSpace: async () => defaultSpace,
    }, {
      spaceMemoryPolicyService: {
        setThinkingCapturePolicy: async (spaceId: string, policy: string) => {
          received = { spaceId, policy };
          return policy;
        },
        getThinkingCapturePolicy: () => "FULL",
        getSpaceMemoryPolicy: () => ({
          experienceCapture: "INHERIT",
          privacyMode: "STANDARD",
        }),
      },
    });

    const msg = makeMessage(MessageTypes.SPACE_SET_THINKING_CAPTURE_POLICY, {
      spaceId: "space-main",
      thinkingCapturePolicy: "FULL",
    });

    const response = await router.handle(makeClient(), msg);

    expect(response?.type).toBe(MessageTypes.SPACE_SET_THINKING_CAPTURE_POLICY);
    expect(received).toEqual({
      spaceId: "space-main",
      policy: "FULL",
    });
    expect((response?.payload as any).space.thinkingCapturePolicy).toBe("FULL");
  });

  test("routes space.get_memory_policy", async () => {
    const router = makeRouter({
      getSpace: async () => defaultSpace,
    }, {
      spaceMemoryPolicyService: {
        getThinkingCapturePolicy: () => "SUMMARY",
        getSpaceMemoryPolicy: () => ({
          experienceCapture: "DISABLED",
          privacyMode: "INCOGNITO_SESSION",
        }),
      },
    });

    const msg = makeMessage(MessageTypes.SPACE_GET_MEMORY_POLICY, {
      spaceId: "space-main",
    });

    const response = await router.handle(makeClient(), msg);

    expect(response?.type).toBe(MessageTypes.SPACE_GET_MEMORY_POLICY);
    expect((response?.payload as any).memoryPolicy).toEqual({
      experienceCapture: "DISABLED",
      privacyMode: "INCOGNITO_SESSION",
    });
  });

  test("routes space.set_memory_policy", async () => {
    let received: any = null;
    const router = makeRouter({
      getSpace: async () => defaultSpace,
    }, {
      spaceMemoryPolicyService: {
        setSpaceMemoryPolicy: async (spaceId: string, memoryPolicy: Record<string, string>) => {
          received = { spaceId, memoryPolicy };
          return undefined;
        },
        getThinkingCapturePolicy: () => "SUMMARY",
        getSpaceMemoryPolicy: () => ({
          experienceCapture: "DISABLED",
          privacyMode: "STANDARD",
        }),
      },
    });

    const msg = makeMessage(MessageTypes.SPACE_SET_MEMORY_POLICY, {
      spaceId: "space-main",
      memoryPolicy: {
        experienceCapture: "DISABLED",
        privacyMode: "STANDARD",
      },
    });

    const response = await router.handle(makeClient(), msg);

    expect(response?.type).toBe(MessageTypes.SPACE_SET_MEMORY_POLICY);
    expect(received).toEqual({
      spaceId: "space-main",
      memoryPolicy: {
        experienceCapture: "DISABLED",
        privacyMode: "STANDARD",
      },
    });
    expect((response?.payload as any).space.memoryPolicy).toEqual({
      experienceCapture: "DISABLED",
      privacyMode: "STANDARD",
    });
  });

  test("routes space.end_incognito_session", async () => {
    const router = makeRouter({
      getSpace: async () => defaultSpace,
    }, {
      spaceMemoryPolicyService: {
        endIncognitoSession: async () => ({
          ended: true,
          purged: true,
          reason: "manual",
          purgedAt: "2026-03-20T09:00:00.000Z",
          sessionId: "session-1",
        }),
        getThinkingCapturePolicy: () => "FULL",
        getSpaceMemoryPolicy: () => ({
          experienceCapture: "INHERIT",
          privacyMode: "STANDARD",
        }),
      },
    });

    const msg = makeMessage(MessageTypes.SPACE_END_INCOGNITO_SESSION, {
      spaceId: "space-main",
    });

    const response = await router.handle(makeClient(), msg);

    expect(response?.type).toBe(MessageTypes.SPACE_END_INCOGNITO_SESSION);
    expect((response?.payload as any).ended).toBe(true);
    expect((response?.payload as any).reason).toBe("manual");
    expect((response?.payload as any).sessionId).toBe("session-1");
  });

  test("validates required fields for space.set_orchestrator", async () => {
    const router = makeRouter({
      setSpaceOrchestrator: async () => defaultSpace,
    });

    const msg = makeMessage(MessageTypes.SPACE_SET_ORCHESTRATOR, {
      spaceId: "space-main",
    });

    const response = await router.handle(makeClient(), msg);

    expect(response?.type).toBe(MessageTypes.ERROR);
    expect((response?.payload as any).code).toBe("INVALID_ARGUMENT");
  });
});
