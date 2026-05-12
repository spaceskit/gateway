import { describe, expect, test } from "bun:test";
import { makeService, makeStores } from "./space-admin-idempotency-test-helpers.js";

describe("SpaceAdminService onMissingIdempotencyKey", () => {
  test("does not fire when caller supplies an idempotency key", async () => {
    const stores = makeStores();
    const calls: string[] = [];
    const service = makeService(stores, new Set(), {
      onMissingIdempotencyKey: (endpoint) => calls.push(endpoint),
    });

    await service.createSpace({
      idempotencyKey: "create-with-key",
      spaceId: "space-with-key",
      resourceId: "resource-with-key",
      name: "With Key",
      initialAgents: [{ agentId: "agent-1", profileId: "profile-1", role: "participant" }],
    });

    expect(calls).toEqual([]);
  });

  test("fires per affected endpoint when key is omitted but idempotency is wired", async () => {
    const stores = makeStores();
    const calls: string[] = [];
    const service = makeService(stores, new Set(), {
      onMissingIdempotencyKey: (endpoint) => calls.push(endpoint),
    });

    // createSpace with initialAgents internally invokes both space.create
    // and space.add_agent through the same withIdempotency guard.
    await service.createSpace({
      spaceId: "space-no-key",
      resourceId: "resource-no-key",
      name: "No Key",
      initialAgents: [{ agentId: "agent-1", profileId: "profile-1", role: "participant" }],
    });

    expect(calls).toEqual(["space.create", "space.add_agent"]);
  });

  test("does not fire when load/save are not wired (no idempotency support)", async () => {
    const stores = makeStores();
    const calls: string[] = [];
    const service = makeService(stores, new Set(), {
      onMissingIdempotencyKey: (endpoint) => calls.push(endpoint),
      omitIdempotencyStore: true,
    });

    await service.createSpace({
      spaceId: "space-no-store",
      resourceId: "resource-no-store",
      name: "No Store",
      initialAgents: [{ agentId: "agent-1", profileId: "profile-1", role: "participant" }],
    });

    expect(calls).toEqual([]);
  });

  test("default (no callback supplied) is silent — no console output", async () => {
    const stores = makeStores();
    const service = makeService(stores);
    const originalWarn = console.warn;
    const warnings: unknown[][] = [];
    console.warn = ((...args: unknown[]) => {
      warnings.push(args);
    }) as typeof console.warn;

    try {
      await service.createSpace({
        spaceId: "space-default-silent",
        resourceId: "resource-default-silent",
        name: "Default Silent",
        initialAgents: [{ agentId: "agent-1", profileId: "profile-1", role: "participant" }],
      });
    } finally {
      console.warn = originalWarn;
    }

    expect(warnings).toEqual([]);
  });
});
