import { describe, expect, test } from "bun:test";
import { makeService, makeStores } from "./space-admin-idempotency-test-helpers.js";

describe("SpaceAdminService idempotency", () => {
  test("replays createSpace with same idempotency key without duplicate inserts", async () => {
    const stores = makeStores();
    const service = makeService(stores);

    const first = await service.createSpace({
      idempotencyKey: "create-1",
      spaceId: "space-1",
      resourceId: "resource-1",
      name: "Main",
      initialAgents: [{
        agentId: "agent-1",
        profileId: "profile-1",
        role: "participant",
      }],
    });

    const second = await service.createSpace({
      idempotencyKey: "create-1",
      spaceId: "space-1",
      resourceId: "resource-1",
      name: "Main",
      initialAgents: [{
        agentId: "agent-1",
        profileId: "profile-1",
        role: "participant",
      }],
    });

    expect(first.id).toBe("space-1");
    expect(second.id).toBe("space-1");
    expect(stores.createSpaceCalls).toBe(1);
  });

  test("accepts caller-provided UUIDv7 for spaceUid", async () => {
    const stores = makeStores();
    const service = makeService(stores);
    const providedSpaceUid = "018f3f76-8f16-7cc0-8d2c-7f7f8d4a56ab";

    const created = await service.createSpace({
      spaceId: "space-v7",
      spaceUid: providedSpaceUid,
      resourceId: "resource-v7",
      name: "Space V7",
    });

    expect(created.spaceUid).toBe(providedSpaceUid);

    const loaded = await service.getSpace("space-v7");
    expect(loaded?.spaceUid).toBe(providedSpaceUid);
  });

  test("persists thinking capture policy from createSpace config", async () => {
    const stores = makeStores();
    const service = makeService(stores);

    const created = await service.createSpace({
      spaceId: "space-thinking",
      resourceId: "resource-thinking",
      name: "Thinking Space",
      thinkingCapturePolicy: "FULL",
    });

    expect(created.thinkingCapturePolicy).toBe("FULL");

    const row = stores.getSpace("space-thinking");
    expect(row?.spaceConfigJson).not.toBeNull();
    expect(JSON.parse(row?.spaceConfigJson ?? "{}")).toMatchObject({
      thinkingCapturePolicy: "FULL",
    });

    const loaded = await service.getSpace("space-thinking");
    expect(loaded?.thinkingCapturePolicy).toBe("FULL");
  });

  test("replays addAgent with same idempotency key without duplicate writes", async () => {
    const stores = makeStores();
    const service = makeService(stores);

    await service.createSpace({
      spaceId: "space-2",
      resourceId: "resource-2",
      name: "Space 2",
    });

    const first = await service.addAgent({
      idempotencyKey: "add-1",
      spaceId: "space-2",
      agentId: "agent-2",
      profileId: "profile-2",
    });
    const second = await service.addAgent({
      idempotencyKey: "add-1",
      spaceId: "space-2",
      agentId: "agent-2",
      profileId: "profile-2",
    });

    expect(first.agentId).toBe("agent-2");
    expect(second.agentId).toBe("agent-2");
    expect(stores.upsertAssignmentCalls).toBe(1);
  });

  test("archives a space and excludes it from the default list", async () => {
    const stores = makeStores();
    const service = makeService(stores);

    await service.createSpace({
      spaceId: "space-archive",
      resourceId: "resource-archive",
      name: "Archive Me",
    });

    const archived = await service.archiveSpace({
      spaceId: "space-archive",
    });

    expect(archived.status).toBe("archived");
    expect(archived.archivedAt).toBeInstanceOf(Date);
    expect((await service.listSpaces()).map((space) => space.id)).not.toContain("space-archive");
    expect((await service.listSpaces({ statuses: ["archived"] })).map((space) => space.id)).toContain("space-archive");
  });

  test("soft-deletes a space and excludes it from default and archived lists", async () => {
    const stores = makeStores();
    const service = makeService(stores);

    await service.createSpace({
      spaceId: "space-delete",
      resourceId: "resource-delete",
      name: "Delete Me",
    });

    const deleted = await service.deleteSpace({
      spaceId: "space-delete",
    });

    expect(deleted.status).toBe("deleted");
    expect(deleted.deletedAt).toBeInstanceOf(Date);
    expect((await service.listSpaces()).map((space) => space.id)).not.toContain("space-delete");
    expect((await service.listSpaces({ statuses: ["archived"] })).map((space) => space.id)).not.toContain("space-delete");
    expect((await service.listSpaces({ statuses: ["deleted"] })).map((space) => space.id)).toContain("space-delete");
  });

  test("different idempotency keys create different spaces", async () => {
    const stores = makeStores();
    const service = makeService(stores);

    const first = await service.createSpace({
      idempotencyKey: "key-alpha",
      spaceId: "space-alpha",
      resourceId: "resource-alpha",
      name: "Alpha",
    });

    const second = await service.createSpace({
      idempotencyKey: "key-beta",
      spaceId: "space-beta",
      resourceId: "resource-beta",
      name: "Beta",
    });

    expect(first.id).toBe("space-alpha");
    expect(second.id).toBe("space-beta");
    expect(stores.createSpaceCalls).toBe(2);
  });

  test("createSpace without idempotency key always creates new space", async () => {
    const stores = makeStores();
    const service = makeService(stores);

    const first = await service.createSpace({
      spaceId: "space-no-key-1",
      resourceId: "resource-no-key-1",
      name: "No Key 1",
    });

    const second = await service.createSpace({
      spaceId: "space-no-key-2",
      resourceId: "resource-no-key-2",
      name: "No Key 2",
    });

    expect(first.id).toBe("space-no-key-1");
    expect(second.id).toBe("space-no-key-2");
    expect(stores.createSpaceCalls).toBe(2);
  });

  test("rejects replay with same idempotency key but different payload", async () => {
    const stores = makeStores();
    const service = makeService(stores);

    await service.createSpace({
      idempotencyKey: "create-conflict",
      spaceId: "space-conflict",
      resourceId: "resource-conflict",
      name: "Original",
    });

    await expect(
      service.createSpace({
        idempotencyKey: "create-conflict",
        spaceId: "space-conflict",
        resourceId: "resource-conflict",
        name: "Different Name",
      }),
    ).rejects.toMatchObject({
      code: "FAILED_PRECONDITION",
    });
  });
});
