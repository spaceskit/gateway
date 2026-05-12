import { describe, expect, test } from "bun:test";
import { makeService, makeStores } from "./space-admin-idempotency-test-helpers.js";

describe("SpaceAdminService idempotency", () => {
  test("recovers missing normalized assignment row from legacy config during update", async () => {
    const stores = makeStores();
    const service = makeService(
      stores,
      new Set(["profile-main", "profile-alt", "profile-secondary"]),
    );

    await service.createSpace({
      spaceId: "space-legacy-recover",
      resourceId: "resource-legacy-recover",
      name: "Legacy Recover Space",
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

    // Simulate partial drift: one assignment row disappears while legacy config still has it.
    stores.deleteAssignment("space-legacy-recover", "main-agent");

    const updated = await service.updateAgentAssignment({
      spaceId: "space-legacy-recover",
      agentId: "main-agent",
      profileId: "profile-alt",
      role: "global_coordinator",
      isPrimary: true,
      turnOrder: 0,
    });

    expect(updated.agentId).toBe("main-agent");
    expect(updated.profileId).toBe("profile-alt");
    expect(stores.getAssignment("space-legacy-recover", "main-agent")?.profileId).toBe("profile-alt");
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

  test("repairs missing normalized assignment rows while reading space state", async () => {
    const stores = makeStores();
    const service = makeService(
      stores,
      new Set(["profile-main", "profile-secondary"]),
    );

    await service.createSpace({
      spaceId: "space-legacy-read-repair",
      resourceId: "resource-legacy-read-repair",
      name: "Legacy Read Repair Space",
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

    stores.deleteAssignment("space-legacy-read-repair", "main-agent");
    expect(stores.getAssignment("space-legacy-read-repair", "main-agent")).toBeNull();

    const repaired = await service.getSpace("space-legacy-read-repair");

    expect(repaired).not.toBeNull();
    expect(repaired?.agents.some((assignment) => assignment.agentId === "main-agent")).toBe(true);
    expect(stores.getAssignment("space-legacy-read-repair", "main-agent")).toBeDefined();
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
