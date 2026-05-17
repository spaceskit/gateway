import { describe, expect, test } from "bun:test";
import { makeService, makeStores } from "./space-admin-idempotency-test-helpers.js";

describe("SpaceAdminService idempotency", () => {
  test("does not recover missing normalized assignment row from stale config during update", async () => {
    const stores = makeStores();
    const service = makeService(
      stores,
      new Set(["profile-main", "profile-alt", "profile-secondary"]),
    );

    await service.createSpace({
      spaceId: "space-stale-recover",
      resourceId: "resource-stale-recover",
      name: "Stale Recover Space",
      initialAgents: [
        {
          agentId: "main-agent",
          profileId: "profile-main",
          role: "global_coordinator",
          isPrimary: true,
        },
        {
          agentId: "agent-secondary",
          profileId: "profile-secondary",
          role: "participant",
          turnOrder: 1,
        },
      ],
    });

    // Simulate partial drift: one assignment row disappears while stale config still has it.
    stores.deleteAssignment("space-stale-recover", "main-agent");

    await expect(service.updateAgentAssignment({
      spaceId: "space-stale-recover",
      agentId: "main-agent",
      profileId: "profile-alt",
      role: "global_coordinator",
      isPrimary: true,
      turnOrder: 0,
    })).rejects.toMatchObject({ code: "NOT_FOUND" });

    expect(stores.getAssignment("space-stale-recover", "main-agent")).toBeNull();
  });

  test("updating an assignment to coordinator demotes other coordinators and primaries", async () => {
    const stores = makeStores();
    const service = makeService(
      stores,
      new Set(["profile-main", "profile-secondary"]),
    );

    await service.createSpace({
      spaceId: "space-exclusive-coordinator",
      resourceId: "resource-exclusive-coordinator",
      name: "Exclusive Coordinator Space",
      initialAgents: [
        {
          agentId: "agent-main",
          profileId: "profile-main",
          role: "global_coordinator",
          isPrimary: true,
        },
        {
          agentId: "agent-secondary",
          profileId: "profile-secondary",
          role: "participant",
          turnOrder: 1,
        },
      ],
    });

    await service.updateAgentAssignment({
      spaceId: "space-exclusive-coordinator",
      agentId: "agent-secondary",
      role: "global_coordinator",
      isPrimary: true,
    });

    const updated = await service.getSpace("space-exclusive-coordinator");
    expect(updated).not.toBeNull();

    const coordinators = updated!.agents.filter((assignment) => assignment.role === "global_coordinator");
    const primaries = updated!.agents.filter((assignment) => assignment.isPrimary);

    expect(coordinators.map((entry) => entry.agentId)).toEqual(["agent-secondary"]);
    expect(primaries.map((entry) => entry.agentId)).toEqual(["agent-secondary"]);
  });

  test("does not repair missing normalized assignment rows while reading space state", async () => {
    const stores = makeStores();
    const service = makeService(
      stores,
      new Set(["profile-main", "profile-secondary"]),
    );

    await service.createSpace({
      spaceId: "space-stale-read-repair",
      resourceId: "resource-stale-read-repair",
      name: "Stale Read Repair Space",
      initialAgents: [
        {
          agentId: "main-agent",
          profileId: "profile-main",
          role: "global_coordinator",
          isPrimary: true,
        },
        {
          agentId: "agent-secondary",
          profileId: "profile-secondary",
          role: "participant",
          turnOrder: 1,
        },
      ],
    });

    stores.deleteAssignment("space-stale-read-repair", "main-agent");
    expect(stores.getAssignment("space-stale-read-repair", "main-agent")).toBeNull();

    const loaded = await service.getSpace("space-stale-read-repair");

    expect(loaded).not.toBeNull();
    expect(loaded?.agents.some((assignment) => assignment.agentId === "main-agent")).toBe(false);
    expect(stores.getAssignment("space-stale-read-repair", "main-agent")).toBeNull();
  });

  test("falls back to primary assignment profile when orchestrator is not set", async () => {
    const stores = makeStores();
    const service = makeService(stores);

    const created = await service.createSpace({
      spaceId: "space-fallback",
      resourceId: "resource-fallback",
      name: "Fallback Space",
      initialAgents: [{
        agentId: "agent-primary",
        profileId: "profile-primary",
        isPrimary: true,
      }],
    });

    expect(created.orchestratorProfileId).toBe("profile-primary");
  });
});
