import { describe, expect, test } from "bun:test";
import { MessageTypes } from "../src/protocol.js";
import {
  defaultAssignment,
  defaultSpace,
  makeClient,
  makeMessage,
  makeRouter,
} from "./message-router.space-admin-test-helpers.js";

describe("MessageRouter space admin handlers", () => {
  test("routes space.list_agent_assignments", async () => {
    const router = makeRouter({
      listAgentAssignments: async () => [defaultAssignment],
    });

    const msg = makeMessage(MessageTypes.SPACE_LIST_AGENT_ASSIGNMENTS, {
      spaceId: "space-main",
    });

    const response = await router.handle(makeClient(), msg);

    expect(response?.type).toBe(MessageTypes.SPACE_LIST_AGENT_ASSIGNMENTS);
    expect((response?.payload as any).assignments.length).toBe(1);
    expect((response?.payload as any).assignments[0].agentId).toBe("agent-main");
  });

  test("routes space.add_skill and returns updated skills", async () => {
    const router = makeRouter({
      addSkillToSpace: async () => ["skill.code.review", "skill.sync.query"],
      getSpace: async () => ({ ...defaultSpace, skillIds: ["skill.code.review", "skill.sync.query"] }),
    });

    const msg = makeMessage(MessageTypes.SPACE_ADD_SKILL, {
      spaceId: "space-main",
      skillId: "skill.sync.query",
    });

    const response = await router.handle(makeClient(), msg);

    expect(response?.type).toBe(MessageTypes.SPACE_ADD_SKILL);
    expect((response?.payload as any).spaceId).toBe("space-main");
    expect((response?.payload as any).skillId).toBe("skill.sync.query");
    expect((response?.payload as any).skills).toEqual(["skill.code.review", "skill.sync.query"]);
  });

  test("validates required fields for space.add_skill", async () => {
    const router = makeRouter({
      addSkillToSpace: async () => [],
    });

    const msg = makeMessage(MessageTypes.SPACE_ADD_SKILL, {
      spaceId: "space-main",
    });

    const response = await router.handle(makeClient(), msg);

    expect(response?.type).toBe(MessageTypes.ERROR);
    expect((response?.payload as any).code).toBe("INVALID_ARGUMENT");
  });

  test("routes space.remove_skill and returns removal response", async () => {
    const router = makeRouter({
      removeSkillFromSpace: async () => ({ removed: true, skills: ["skill.code.review"] }),
      getSpace: async () => ({ ...defaultSpace, skillIds: ["skill.code.review"] }),
    });

    const msg = makeMessage(MessageTypes.SPACE_REMOVE_SKILL, {
      spaceId: "space-main",
      skillId: "skill.sync.query",
    });

    const response = await router.handle(makeClient(), msg);

    expect(response?.type).toBe(MessageTypes.SPACE_REMOVE_SKILL);
    expect((response?.payload as any).removed).toBe(true);
    expect((response?.payload as any).skills).toEqual(["skill.code.review"]);
  });

  test("routes space.list_skills", async () => {
    const router = makeRouter({
      listSpaceSkills: async () => ["skill.code.review"],
    });

    const msg = makeMessage(MessageTypes.SPACE_LIST_SKILLS, {
      spaceId: "space-main",
    });

    const response = await router.handle(makeClient(), msg);

    expect(response?.type).toBe(MessageTypes.SPACE_LIST_SKILLS);
    expect((response?.payload as any).spaceId).toBe("space-main");
    expect((response?.payload as any).skills).toEqual(["skill.code.review"]);
  });
});
