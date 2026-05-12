import { describe, expect, test } from "bun:test";
import { makeService, makeStores } from "./space-admin-idempotency-test-helpers.js";

describe("SpaceAdminService idempotency", () => {
  test("adds, lists, and removes space resources", async () => {
    const stores = makeStores();
    const service = makeService(stores);

    await service.createSpace({
      spaceId: "space-resources-1",
      resourceId: "resource-resources-1",
      name: "Resource Space",
    });

    const added = await service.addResource({
      idempotencyKey: "resource-add-1",
      spaceId: "space-resources-1",
      uri: "file:///tmp/project",
      type: "folder",
      label: "Project",
    });
    const replayed = await service.addResource({
      idempotencyKey: "resource-add-1",
      spaceId: "space-resources-1",
      uri: "file:///tmp/project",
      type: "folder",
      label: "Project",
    });

    expect(added.resourceId).toBe(replayed.resourceId);
    const listed = await service.listResources("space-resources-1");
    expect(listed.length).toBe(1);
    expect(listed[0].uri).toBe("file:///tmp/project");
    expect(listed[0].type).toBe("folder");

    const removed = await service.removeResource({
      idempotencyKey: "resource-remove-1",
      spaceId: "space-resources-1",
      resourceId: added.resourceId,
    });
    const removedReplay = await service.removeResource({
      idempotencyKey: "resource-remove-1",
      spaceId: "space-resources-1",
      resourceId: added.resourceId,
    });

    expect(removed).toBe(true);
    expect(removedReplay).toBe(true);
    expect((await service.listResources("space-resources-1")).length).toBe(0);
  });

  test("rejects user-provided resourceId in reserved workspace prefix", async () => {
    const stores = makeStores();
    const service = makeService(stores, new Set(), {
      reservedResourcePrefixes: ["space-workspace-root-"],
    });

    await service.createSpace({
      spaceId: "space-reserved-resource",
      resourceId: "resource-reserved-resource",
      name: "Reserved Resource Space",
    });

    await expect(
      service.addResource({
        spaceId: "space-reserved-resource",
        resourceId: "space-workspace-root-space-reserved-resource",
        uri: "file:///tmp/workspace",
        type: "folder",
      }),
    ).rejects.toMatchObject({
      code: "INVALID_ARGUMENT",
    });
  });

  test("rejects removal of protected managed resource", async () => {
    const stores = makeStores();
    const protectedResourceIds = new Set<string>([
      "space-protected-resource:space-workspace-root-space-protected-resource",
    ]);
    const service = makeService(stores, new Set(), {
      protectedResourceIds,
    });

    await service.createSpace({
      spaceId: "space-protected-resource",
      resourceId: "resource-protected-resource",
      name: "Protected Resource Space",
    });

    await stores.upsertSpaceResource({
      resourceId: "space-workspace-root-space-protected-resource",
      spaceId: "space-protected-resource",
      uri: "file:///tmp/workspace",
      type: "folder",
    });

    await expect(
      service.removeResource({
        spaceId: "space-protected-resource",
        resourceId: "space-workspace-root-space-protected-resource",
      }),
    ).rejects.toMatchObject({
      code: "FAILED_PRECONDITION",
    });
  });
});
