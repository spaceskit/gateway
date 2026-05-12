import { describe, expect, test } from "bun:test";
import { makeService, makeStores } from "./space-admin-idempotency-test-helpers.js";

describe("SpaceAdminService idempotency", () => {
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
});
