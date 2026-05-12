import { describe, expect, test } from "bun:test";
import { MessageTypes } from "../src/protocol.js";
import {
  defaultSpace,
  makeClient,
  makeMessage,
  makeRouter,
} from "./message-router.space-admin-test-helpers.js";

describe("MessageRouter space admin handlers", () => {
  test("routes space resource CRUD handlers", async () => {
    const resource = {
      resourceId: "resource-1",
      spaceId: "space-main",
      uri: "file:///tmp/project",
      type: "folder",
      label: "Project",
      addedAt: new Date(),
    };

    const router = makeRouter({
      addResource: async () => resource,
      removeResource: async () => true,
      listResources: async () => [resource],
    });

    const addResponse = await router.handle(
      makeClient(),
      makeMessage(MessageTypes.SPACE_ADD_RESOURCE, {
        spaceId: "space-main",
        uri: "file:///tmp/project",
        type: "folder",
        label: "Project",
      }),
    );
    expect(addResponse?.type).toBe(MessageTypes.SPACE_ADD_RESOURCE);
    expect((addResponse?.payload as any).resource.resourceId).toBe("resource-1");

    const listResponse = await router.handle(
      makeClient(),
      makeMessage(MessageTypes.SPACE_LIST_RESOURCES, {
        spaceId: "space-main",
      }),
    );
    expect(listResponse?.type).toBe(MessageTypes.SPACE_LIST_RESOURCES);
    expect((listResponse?.payload as any).resources.length).toBe(1);

    const removeResponse = await router.handle(
      makeClient(),
      makeMessage(MessageTypes.SPACE_REMOVE_RESOURCE, {
        spaceId: "space-main",
        resourceId: "resource-1",
      }),
    );
    expect(removeResponse?.type).toBe(MessageTypes.SPACE_REMOVE_RESOURCE);
    expect((removeResponse?.payload as any).removed).toBe(true);
  });

  test("routes workspace get/set handlers", async () => {
    const workspace = {
      spaceId: "space-main",
      spaceUid: "11111111-1111-1111-8111-111111111111",
      mode: "managed",
      effectiveWorkspaceRoot: "/tmp/spaces/space-main",
      metaPath: "/tmp/spaces/space-main/.space",
      logsPath: "/tmp/spaces/space-main/.space/logs",
      workPath: "/tmp/spaces/space-main/.space/work",
      sharedContextPath: "/tmp/spaces/space-main/.space/shared-context",
      scratchpadsPath: "/tmp/spaces/space-main/.space/scratchpads",
      layoutVersion: 2,
      gitRepoDetected: false,
      metadataStatus: "ready",
      updatedAt: new Date().toISOString(),
    };

    const router = makeRouter(
      {
        getSpace: async () => ({
          ...defaultSpace,
          spaceUid: workspace.spaceUid,
        }),
      },
      {
        spaceWorkspaceService: {
          getWorkspace: async () => workspace,
          setWorkspace: async () => ({
            ...workspace,
            mode: "folder_bound",
            explicitWorkspaceRoot: "/tmp/explicit",
            effectiveWorkspaceRoot: "/tmp/explicit",
            metaPath: "/tmp/explicit/.space",
            logsPath: "/tmp/explicit/.space/logs",
            workPath: "/tmp/explicit/.space/work",
            sharedContextPath: "/tmp/explicit/.space/shared-context",
            scratchpadsPath: "/tmp/explicit/.space/scratchpads",
            gitRepoDetected: false,
          }),
          ensureWorkspace: async () => workspace,
        },
      },
    );

    const getResponse = await router.handle(
      makeClient(),
      makeMessage(MessageTypes.SPACE_GET_WORKSPACE, { spaceId: "space-main" }),
    );
    expect(getResponse?.type).toBe(MessageTypes.SPACE_GET_WORKSPACE);
    expect((getResponse?.payload as any).workspace.spaceId).toBe("space-main");

    const setResponse = await router.handle(
      makeClient(),
      makeMessage(MessageTypes.SPACE_SET_WORKSPACE, {
        spaceId: "space-main",
        workspaceRoot: "/tmp/explicit",
      }),
    );
    expect(setResponse?.type).toBe(MessageTypes.SPACE_SET_WORKSPACE);
    expect((setResponse?.payload as any).workspace.mode).toBe("folder_bound");
    expect((setResponse?.payload as any).workspace.explicitWorkspaceRoot).toBe("/tmp/explicit");
  });

  test("invalidates cached agent runtimes after workspace root changes", async () => {
    const workspace = {
      spaceId: "space-main",
      spaceUid: "11111111-1111-1111-8111-111111111111",
      mode: "managed",
      effectiveWorkspaceRoot: "/tmp/spaces/space-main",
      metaPath: "/tmp/spaces/space-main/.space",
      logsPath: "/tmp/spaces/space-main/.space/logs",
      workPath: "/tmp/spaces/space-main/.space/work",
      sharedContextPath: "/tmp/spaces/space-main/.space/shared-context",
      scratchpadsPath: "/tmp/spaces/space-main/.space/scratchpads",
      layoutVersion: 2,
      gitRepoDetected: false,
      metadataStatus: "ready",
      updatedAt: new Date().toISOString(),
    };
    const invalidatedSpaceIds: string[] = [];

    const router = makeRouter(
      {
        getSpace: async () => ({
          ...defaultSpace,
          spaceUid: workspace.spaceUid,
        }),
      },
      {
        spaceManager: {
          executeTurn: async () => ({ turnId: "turn-1" }),
          resumeFeedback: async () => {},
          invalidateCache: (spaceId: string) => {
            invalidatedSpaceIds.push(spaceId);
          },
        },
        spaceWorkspaceService: {
          getWorkspace: async () => workspace,
          setWorkspace: async () => ({
            ...workspace,
            mode: "folder_bound",
            explicitWorkspaceRoot: "/tmp/explicit",
            effectiveWorkspaceRoot: "/tmp/explicit",
            metaPath: "/tmp/explicit/.space",
            logsPath: "/tmp/explicit/.space/logs",
            workPath: "/tmp/explicit/.space/work",
            sharedContextPath: "/tmp/explicit/.space/shared-context",
            scratchpadsPath: "/tmp/explicit/.space/scratchpads",
            gitRepoDetected: false,
          }),
          ensureWorkspace: async () => workspace,
        },
      },
    );

    const response = await router.handle(
      makeClient(),
      makeMessage(MessageTypes.SPACE_SET_WORKSPACE, {
        spaceId: "space-main",
        workspaceRoot: "/tmp/explicit",
      }),
    );

    expect(response?.type).toBe(MessageTypes.SPACE_SET_WORKSPACE);
    expect(invalidatedSpaceIds).toEqual(["space-main"]);
  });
});
