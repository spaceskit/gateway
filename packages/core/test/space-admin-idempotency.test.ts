import { describe, expect, test } from "bun:test";
import {
  SpaceAdminService,
  type CreateSpaceStoreInput,
  type SpaceStoreRecord,
  type UpsertSpaceAssignmentStoreInput,
  type SpaceAssignmentStoreRecord,
  type SpaceSkillStoreRecord,
  type UpsertSpaceSkillStoreInput,
  type SpaceResourceStoreRecord,
  type UpsertSpaceResourceStoreInput,
} from "../src/spaces/space-admin-service.js";

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
    expect(stores.updateSpaceConfigCalls - updateCallsBefore).toBe(2);
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

  test("replays addSkillToSpace with same idempotency key without duplicate writes", async () => {
    const stores = makeStores();
    const service = makeService(stores);

    await service.createSpace({
      spaceId: "space-skills-1",
      resourceId: "resource-skills-1",
      name: "Skills Space",
    });

    const first = await service.addSkillToSpace({
      idempotencyKey: "skill-add-1",
      spaceId: "space-skills-1",
      skillId: "skill.code.review",
    });

    const second = await service.addSkillToSpace({
      idempotencyKey: "skill-add-1",
      spaceId: "space-skills-1",
      skillId: "skill.code.review",
    });

    expect(first).toEqual(["skill.code.review"]);
    expect(second).toEqual(["skill.code.review"]);
    expect(stores.upsertSpaceSkillCalls).toBe(1);
  });

  test("removeSkillFromSpace is idempotent and keeps final list stable", async () => {
    const stores = makeStores();
    const service = makeService(stores);

    await service.createSpace({
      spaceId: "space-skills-2",
      resourceId: "resource-skills-2",
      name: "Skills Space 2",
    });

    await service.addSkillToSpace({
      spaceId: "space-skills-2",
      skillId: "skill.sync.query",
    });

    const first = await service.removeSkillFromSpace({
      idempotencyKey: "skill-remove-1",
      spaceId: "space-skills-2",
      skillId: "skill.sync.query",
    });
    const second = await service.removeSkillFromSpace({
      idempotencyKey: "skill-remove-1",
      spaceId: "space-skills-2",
      skillId: "skill.sync.query",
    });

    expect(first.removed).toBe(true);
    expect(second.removed).toBe(true);
    expect(first.skills).toEqual([]);
    expect(second.skills).toEqual([]);
  });

  test("rejects removal of protected main-space skills", async () => {
    const stores = makeStores();
    const protectedSkillIds = new Set<string>([
      "main-space-protected:system/master-skill",
    ]);
    const service = makeService(stores, new Set(), {
      protectedSkillIds,
    });

    await service.createSpace({
      spaceId: "main-space-protected",
      resourceId: "resource-main-space-protected",
      name: "Main Space",
    });

    await service.addSkillToSpace({
      spaceId: "main-space-protected",
      skillId: "system/master-skill",
    });

    await expect(
      service.removeSkillFromSpace({
        spaceId: "main-space-protected",
        skillId: "system/master-skill",
      }),
    ).rejects.toMatchObject({
      code: "FAILED_PRECONDITION",
    });

    expect(stores.listSpaceSkills("main-space-protected").map((entry) => entry.skillId)).toEqual([
      "system/master-skill",
    ]);
  });

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

function makeService(
  stores: ReturnType<typeof makeStores>,
  knownProfiles: Set<string> = new Set(),
  options: {
    archivedProfiles?: Set<string>;
    orchestratorCapableProfiles?: Set<string>;
    protectedSkillIds?: Set<string>;
    reservedResourcePrefixes?: string[];
    protectedResourceIds?: Set<string>;
  } = {},
): SpaceAdminService {
  const archivedProfiles = options.archivedProfiles ?? new Set<string>();
  const orchestratorCapableProfiles = options.orchestratorCapableProfiles ?? knownProfiles;
  return new SpaceAdminService({
    createSpaceRow: async (input) => stores.createSpace(input),
    getSpaceRow: async (spaceId) => stores.getSpace(spaceId),
    listSpaceRows: async (query) => stores.listSpaces(query.statuses),
    archiveSpaceRow: async (spaceId, archivedAt) => stores.archiveSpace(spaceId, archivedAt),
    deleteSpaceRow: async (spaceId, deletedAt) => stores.deleteSpace(spaceId, deletedAt),
    updateSpaceConfigJson: async (spaceId, configJson) => {
      stores.updateSpaceConfig(spaceId, configJson);
    },
    profileExists: async (profileId) => {
      if (knownProfiles.size === 0) return true;
      return knownProfiles.has(profileId);
    },
    profileArchived: async (profileId) => archivedProfiles.has(profileId),
    profileCanModerate: async (profileId) => {
      if (knownProfiles.size === 0) return true;
      return orchestratorCapableProfiles.has(profileId);
    },
    getAssignmentRow: async (spaceId, agentId) => stores.getAssignment(spaceId, agentId),
    listAssignmentRows: async (spaceId) => stores.listAssignments(spaceId),
    upsertAssignmentRow: async (input) => stores.upsertAssignment(input),
    deleteAssignmentRow: async (spaceId, agentId) => stores.deleteAssignment(spaceId, agentId),
    listSpaceSkillRows: async (spaceId) => stores.listSpaceSkills(spaceId),
    upsertSpaceSkillRow: async (input) => stores.upsertSpaceSkill(input),
    deleteSpaceSkillRow: async (spaceId, skillId) => stores.deleteSpaceSkill(spaceId, skillId),
    isProtectedSpaceSkill: options.protectedSkillIds
      ? async (spaceId, skillId) => options.protectedSkillIds!.has(`${spaceId}:${skillId}`)
      : undefined,
    listSpaceResourceRows: async (spaceId) => stores.listSpaceResources(spaceId),
    upsertSpaceResourceRow: async (input) => stores.upsertSpaceResource(input),
    deleteSpaceResourceRow: async (spaceId, resourceId) => stores.deleteSpaceResource(spaceId, resourceId),
    reservedSpaceResourceIdPrefixes: options.reservedResourcePrefixes,
    isProtectedSpaceResource: options.protectedResourceIds
      ? async (spaceId, resourceId) => options.protectedResourceIds!.has(`${spaceId}:${resourceId}`)
      : undefined,
    loadIdempotencyRecord: async (principalId, endpoint, idempotencyKey) =>
      stores.loadIdempotency(principalId, endpoint, idempotencyKey),
    saveIdempotencyRecord: async (record) => {
      stores.saveIdempotency(record.principalId, record.endpoint, record.idempotencyKey, {
        requestHash: record.requestHash,
        responseType: record.responseType,
        responsePayload: record.responsePayload,
      });
    },
  });
}

function makeStores() {
  const now = () => new Date().toISOString();
  const spaces = new Map<string, SpaceStoreRecord>();
  const assignments = new Map<string, SpaceAssignmentStoreRecord>();
  const spaceSkills = new Map<string, SpaceSkillStoreRecord>();
  const spaceResources = new Map<string, SpaceResourceStoreRecord>();
  const idempotency = new Map<string, { requestHash: string; responseType: string; responsePayload: string }>();

  let createSpaceCalls = 0;
  let upsertAssignmentCalls = 0;
  let upsertSpaceSkillCalls = 0;
  let updateSpaceConfigCalls = 0;

  return {
    get createSpaceCalls() {
      return createSpaceCalls;
    },
    get upsertAssignmentCalls() {
      return upsertAssignmentCalls;
    },
    get upsertSpaceSkillCalls() {
      return upsertSpaceSkillCalls;
    },
    get updateSpaceConfigCalls() {
      return updateSpaceConfigCalls;
    },
    createSpace(input: CreateSpaceStoreInput): SpaceStoreRecord {
      createSpaceCalls += 1;
      const row: SpaceStoreRecord = {
        spaceId: input.spaceId,
        resourceId: input.resourceId,
        spaceType: input.spaceType,
        name: input.name,
        goal: input.goal,
        status: "created",
        turnModel: input.turnModel,
        spaceConfigJson: input.configJson ?? null,
        templateId: input.templateId ?? "",
        templateRevision: input.templateRevision ?? 0,
        archivedAt: null,
        deletedAt: null,
        createdAt: now(),
        updatedAt: now(),
      };
      spaces.set(row.spaceId, row);
      return row;
    },
    getSpace(spaceId: string): SpaceStoreRecord | null {
      return spaces.get(spaceId) ?? null;
    },
    listSpaces(statuses?: string[]): SpaceStoreRecord[] {
      const rows = Array.from(spaces.values());
      if (statuses && statuses.length > 0) {
        return rows.filter((row) => statuses.includes(row.status));
      }
      return rows.filter((row) => row.status !== "archived" && row.status !== "deleted");
    },
    archiveSpace(spaceId: string, archivedAt: string): SpaceStoreRecord | null {
      const row = spaces.get(spaceId);
      if (!row) return null;
      row.status = "archived";
      row.archivedAt = archivedAt;
      row.deletedAt = null;
      row.updatedAt = archivedAt;
      return row;
    },
    deleteSpace(spaceId: string, deletedAt: string): SpaceStoreRecord | null {
      const row = spaces.get(spaceId);
      if (!row) return null;
      row.status = "deleted";
      row.deletedAt = deletedAt;
      row.updatedAt = deletedAt;
      return row;
    },
    updateSpaceConfig(spaceId: string, configJson: string): void {
      const row = spaces.get(spaceId);
      if (!row) return;
      updateSpaceConfigCalls += 1;
      row.spaceConfigJson = configJson;
      row.updatedAt = now();
    },
    getAssignment(spaceId: string, agentId: string): SpaceAssignmentStoreRecord | null {
      return assignments.get(`${spaceId}:${agentId}`) ?? null;
    },
    listAssignments(spaceId: string): SpaceAssignmentStoreRecord[] {
      return Array.from(assignments.values()).filter((entry) => entry.spaceId === spaceId);
    },
    upsertAssignment(input: UpsertSpaceAssignmentStoreInput): SpaceAssignmentStoreRecord {
      upsertAssignmentCalls += 1;
      const row: SpaceAssignmentStoreRecord = {
        spaceId: input.spaceId,
        agentId: input.agentId,
        profileId: input.profileId,
        securityScopeJson: input.securityScopeJson ?? null,
        role: input.role ?? "participant",
        turnOrder: input.turnOrder ?? 0,
        isPrimary: input.isPrimary ? 1 : 0,
        assignedAt: input.assignedAt ?? now(),
        updatedAt: now(),
      };
      assignments.set(`${row.spaceId}:${row.agentId}`, row);
      return row;
    },
    deleteAssignment(spaceId: string, agentId: string): boolean {
      return assignments.delete(`${spaceId}:${agentId}`);
    },
    listSpaceSkills(spaceId: string): SpaceSkillStoreRecord[] {
      return Array.from(spaceSkills.values())
        .filter((entry) => entry.spaceId === spaceId)
        .sort((lhs, rhs) => lhs.addedAt.localeCompare(rhs.addedAt));
    },
    upsertSpaceSkill(input: UpsertSpaceSkillStoreInput): SpaceSkillStoreRecord {
      upsertSpaceSkillCalls += 1;
      const key = `${input.spaceId}:${input.skillId}`;
      const existing = spaceSkills.get(key);
      if (existing) {
        return existing;
      }
      const row: SpaceSkillStoreRecord = {
        spaceId: input.spaceId,
        skillId: input.skillId,
        addedAt: input.addedAt ?? now(),
      };
      spaceSkills.set(key, row);
      return row;
    },
    deleteSpaceSkill(spaceId: string, skillId: string): boolean {
      return spaceSkills.delete(`${spaceId}:${skillId}`);
    },
    listSpaceResources(spaceId: string): SpaceResourceStoreRecord[] {
      return Array.from(spaceResources.values())
        .filter((entry) => entry.spaceId === spaceId)
        .sort((lhs, rhs) => lhs.addedAt.localeCompare(rhs.addedAt));
    },
    upsertSpaceResource(input: UpsertSpaceResourceStoreInput): SpaceResourceStoreRecord {
      const key = `${input.spaceId}:${input.resourceId}`;
      const row: SpaceResourceStoreRecord = {
        resourceId: input.resourceId,
        spaceId: input.spaceId,
        uri: input.uri,
        type: input.type,
        label: input.label ?? "",
        addedAt: input.addedAt ?? now(),
      };
      spaceResources.set(key, row);
      return row;
    },
    deleteSpaceResource(spaceId: string, resourceId: string): boolean {
      return spaceResources.delete(`${spaceId}:${resourceId}`);
    },
    loadIdempotency(
      principalId: string,
      endpoint: string,
      idempotencyKey: string,
    ): { requestHash: string; responseType: string; responsePayload: string } | null {
      return idempotency.get(`${principalId}:${endpoint}:${idempotencyKey}`) ?? null;
    },
    saveIdempotency(
      principalId: string,
      endpoint: string,
      idempotencyKey: string,
      record: { requestHash: string; responseType: string; responsePayload: string },
    ): void {
      idempotency.set(`${principalId}:${endpoint}:${idempotencyKey}`, record);
    },
  };
}
