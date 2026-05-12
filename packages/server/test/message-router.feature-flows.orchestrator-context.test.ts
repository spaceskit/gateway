import { describe, expect, test } from "bun:test";
import { MessageTypes, type GatewayMessage } from "../src/protocol.js";
import { makeClient, makeMessage, makeRouter } from "./message-router.feature-flows-test-helpers.js";

describe("MessageRouter feature handlers", () => {
  test("routes orchestrator.command and orchestrator.get_command", async () => {
    const command = {
      commandId: "orch-1",
      correlationId: "corr-1",
      apiVersion: "v1",
      commandType: "create_space",
      targetSpaceId: "main-space",
      status: "completed",
      result: { created: true },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      events: [{
        status: "completed",
        event: { created: true },
        createdAt: new Date().toISOString(),
      }],
    };

    const broadcasts: GatewayMessage[] = [];
    const router = makeRouter({
      orchestratorCommandService: {
        submitCommand: async () => command,
        getCommand: () => command,
      },
      broadcastToSpace: (_spaceId: string, message: GatewayMessage) => {
        broadcasts.push(message);
      },
    });

    const submitResponse = await router.handle(
      makeClient(),
      makeMessage(MessageTypes.ORCHESTRATOR_COMMAND, {
        commandType: "create_space",
        targetSpaceId: "main-space",
      }),
    );
    expect(submitResponse?.type).toBe(MessageTypes.ORCHESTRATOR_COMMAND);
    expect(broadcasts.length).toBeGreaterThan(0);
    expect(broadcasts[0].type).toBe(MessageTypes.ORCHESTRATOR_EVENT);

    const getResponse = await router.handle(
      makeClient(),
      makeMessage(MessageTypes.ORCHESTRATOR_GET_COMMAND, {
        commandId: "orch-1",
      }),
    );
    expect(getResponse?.type).toBe(MessageTypes.ORCHESTRATOR_GET_COMMAND);
  });

  test("rejects orchestrator.command when targetSpaceId is missing", async () => {
    const router = makeRouter({
      orchestratorCommandService: {
        submitCommand: async () => {
          throw new Error("should not be reached");
        },
        getCommand: () => null,
      },
    });

    const response = await router.handle(
      makeClient(),
      makeMessage(MessageTypes.ORCHESTRATOR_COMMAND, {
        commandType: "create_space",
      }),
    );

    expect(response?.type).toBe(MessageTypes.ERROR);
    expect((response?.payload as any).code).toBe("INVALID_ARGUMENT");
    expect((response?.payload as any).message).toContain("targetSpaceId");
  });

  test("rejects orchestrator.command when shared-space write access is denied", async () => {
    let submitCalled = false;
    const router = makeRouter({
      orchestratorCommandService: {
        submitCommand: async () => {
          submitCalled = true;
          return {
            commandId: "orch-denied",
            correlationId: "corr-denied",
            apiVersion: "v1",
            commandType: "create_space",
            targetSpaceId: "space-protected",
            status: "completed",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            events: [],
          };
        },
        getCommand: () => null,
      },
      spaceSharingService: {
        evaluateAccess: () => ({
          allowed: false,
          enforced: true,
          mode: "read_only",
          reason: "Read-only participant cannot perform write actions",
        }),
      },
    });

    const response = await router.handle(
      makeClient({ publicKey: "principal-read-only" }),
      makeMessage(MessageTypes.ORCHESTRATOR_COMMAND, {
        commandType: "create_space",
        targetSpaceId: "space-protected",
      }),
    );

    expect(response?.type).toBe(MessageTypes.ERROR);
    expect((response?.payload as any).code).toBe("PERMISSION_DENIED");
    expect((response?.payload as any).message).toContain("Read-only participant");
    expect(submitCalled).toBe(false);
  });

  test("routes cross-space context operations", async () => {
    const router = makeRouter({
      spaceContextService: {
        linkSpaces: () => ({
          sourceSpaceId: "s1",
          targetSpaceId: "s2",
          mode: "pull",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }),
        unlinkSpaces: () => true,
        shareContext: () => ({
          transferId: "t1",
          sourceSpaceId: "s1",
          targetSpaceId: "s2",
          artifactId: "a1",
          status: "shared",
          createdAt: new Date().toISOString(),
        }),
        pullSharedContext: () => ({
          importedArtifacts: [{ sourceArtifactId: "a1", importedArtifactId: "a2" }],
          denied: [],
        }),
      },
    });

    const linkResponse = await router.handle(
      makeClient(),
      makeMessage(MessageTypes.SPACE_LINK, {
        sourceSpaceId: "s1",
        targetSpaceId: "s2",
      }),
    );
    expect(linkResponse?.type).toBe(MessageTypes.SPACE_LINK);

    const shareResponse = await router.handle(
      makeClient(),
      makeMessage(MessageTypes.SPACE_SHARE_CONTEXT, {
        sourceSpaceId: "s1",
        targetSpaceId: "s2",
        artifactId: "a1",
      }),
    );
    expect(shareResponse?.type).toBe(MessageTypes.SPACE_SHARE_CONTEXT);

    const pullResponse = await router.handle(
      makeClient(),
      makeMessage(MessageTypes.SPACE_PULL_SHARED_CONTEXT, {
        sourceSpaceId: "s1",
        targetSpaceId: "s2",
      }),
    );
    expect(pullResponse?.type).toBe(MessageTypes.SPACE_PULL_SHARED_CONTEXT);
  });
});
