import { describe, expect, test } from "bun:test";
import { CONCIERGE_SKILLS } from "../src/seed/main-space-system-skills.js";

describe("main space system skills", () => {
  test("concierge operations prompt requires Workbench mutation context for direct approvals", () => {
    const operationsSkill = CONCIERGE_SKILLS.find((skill) => skill.skillId === "role/concierge-operations");

    expect(operationsSkill?.contentMarkdown).toContain("requestedMutation");
    expect(operationsSkill?.contentMarkdown).toContain("queueItemId");
    expect(operationsSkill?.contentMarkdown).toContain("runId");
    expect(operationsSkill?.contentMarkdown).toContain("stage");
    expect(operationsSkill?.contentMarkdown).toContain("source=workbench");
  });
});
