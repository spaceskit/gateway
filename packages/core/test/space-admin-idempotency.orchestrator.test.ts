import { describe, expect, test } from "bun:test";
import { makeService, makeStores } from "./space-admin-idempotency-test-helpers.js";

describe("SpaceAdminService idempotency", () => {
  test("sets orchestrator profile and replays with idempotency key", async () => {
    const stores = makeStores();
    const service = makeService(stores, new Set(["profile-main", "profile-orch"]));

    await service.createSpace({
      spaceId: "space-orch",
      resourceId: "resource-orch",
      name: "Orchestrated Space",
      initialAgents: [{
        agentId: "agent-main",
        profileId: "profile-main",
        isPrimary: true,
      }],
    });
    const updateCallsBefore = stores.updateSpaceConfigCalls;

    const first = await service.setSpaceOrchestrator({
      idempotencyKey: "orch-1",
      spaceId: "space-orch",
      profileId: "profile-orch",
    });
    const second = await service.setSpaceOrchestrator({
      idempotencyKey: "orch-1",
      spaceId: "space-orch",
      profileId: "profile-orch",
    });

    expect(first.orchestratorProfileId).toBe("profile-orch");
    expect(second.orchestratorProfileId).toBe("profile-orch");
    expect(stores.updateSpaceConfigCalls - updateCallsBefore).toBe(1);
  });

  test("setSpaceOrchestrator keeps a single coordinator and primary assignment", async () => {
    const stores = makeStores();
    const service = makeService(stores, new Set(["profile-main", "profile-alt"]));

    await service.createSpace({
      spaceId: "space-orchestrator-single",
      resourceId: "resource-orchestrator-single",
      name: "Single Orchestrator Space",
      initialAgents: [
        {
          agentId: "agent-main",
          profileId: "profile-main",
          role: "global_coordinator",
          isPrimary: true,
        },
        {
          agentId: "agent-alt",
          profileId: "profile-alt",
          role: "participant",
          turnOrder: 1,
        },
      ],
    });

    await service.setSpaceOrchestrator({
      spaceId: "space-orchestrator-single",
      profileId: "profile-alt",
    });

    const updated = await service.getSpace("space-orchestrator-single");
    expect(updated).not.toBeNull();

    const coordinators = updated!.agents.filter((assignment) => assignment.role === "global_coordinator");
    const primaries = updated!.agents.filter((assignment) => assignment.isPrimary);

    expect(updated!.orchestratorProfileId).toBe("profile-alt");
    expect(coordinators.map((entry) => entry.agentId)).toEqual(["agent-alt"]);
    expect(primaries.map((entry) => entry.agentId)).toEqual(["agent-alt"]);
  });

  test("rejects setting orchestrator to an unknown profile", async () => {
    const stores = makeStores();
    const service = makeService(stores, new Set(["profile-main"]));

    await service.createSpace({
      spaceId: "space-orch-invalid",
      resourceId: "resource-orch-invalid",
      name: "Orchestrated Space",
    });

    await expect(
      service.setSpaceOrchestrator({
        spaceId: "space-orch-invalid",
        profileId: "profile-missing",
      }),
    ).rejects.toMatchObject({
      code: "INVALID_ARGUMENT",
    });
  });

  test("rejects setting orchestrator to a non-moderator profile", async () => {
    const stores = makeStores();
    const service = makeService(
      stores,
      new Set(["profile-main", "profile-orch"]),
      { orchestratorCapableProfiles: new Set(["profile-main"]) },
    );

    await service.createSpace({
      spaceId: "space-orch-capability",
      resourceId: "resource-orch-capability",
      name: "Orchestrator Capability Space",
    });

    await expect(
      service.setSpaceOrchestrator({
        spaceId: "space-orch-capability",
        profileId: "profile-orch",
      }),
    ).rejects.toMatchObject({
      code: "INVALID_ARGUMENT",
    });
  });

  test("rejects profile swap to archived profile", async () => {
    const stores = makeStores();
    const service = makeService(
      stores,
      new Set(["profile-a", "profile-b"]),
      { archivedProfiles: new Set(["profile-b"]) },
    );

    await service.createSpace({
      spaceId: "space-swap-archived",
      resourceId: "resource-swap-archived",
      name: "Swap Space",
    });

    await service.addAgent({
      spaceId: "space-swap-archived",
      agentId: "agent-1",
      profileId: "profile-a",
    });

    await expect(
      service.updateAgentAssignment({
        spaceId: "space-swap-archived",
        agentId: "agent-1",
        profileId: "profile-b",
      }),
    ).rejects.toMatchObject({
      code: "INVALID_ARGUMENT",
    });
  });
});
