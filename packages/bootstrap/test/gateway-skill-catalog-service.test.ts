import { describe, expect, test } from "bun:test";
import { initDatabase, GatewaySkillCatalogRepository } from "@spaceskit/persistence";
import { GatewaySkillCatalogService } from "../src/services/gateway-skill-catalog-service.js";

function createService() {
  const db = initDatabase({
    path: ":memory:",
    runtimeGeneration: `test-gateway-skill-service-${crypto.randomUUID()}`,
  });
  const repository = new GatewaySkillCatalogRepository(db.db);
  const service = new GatewaySkillCatalogService({ repository });
  return { db, repository, service };
}

describe("GatewaySkillCatalogService", () => {
  test("upserts, lists, gets and deletes skills", () => {
    const context = createService();
    try {
      const upserted = context.service.upsertSkill({
        skillId: "custom/service-skill",
        name: "Service Skill",
        description: "service test",
        contentMarkdown: "content",
        sourceRef: "https://example.com/service-skill",
        tags: ["service", "test"],
        status: "active",
      });

      expect(upserted.created).toBe(true);
      expect(upserted.skill.skillId).toBe("custom/service-skill");

      const fetched = context.service.getSkill("custom/service-skill");
      expect(fetched?.name).toBe("Service Skill");

      const listed = context.service.listSkills({ query: "service", status: "all" });
      expect(listed.some((entry) => entry.skillId === "custom/service-skill")).toBe(true);

      expect(context.service.deleteSkill("custom/service-skill")).toBe(true);
      expect(context.service.getSkill("custom/service-skill")).toBeNull();
    } finally {
      context.db.close();
    }
  });

  test("builds active markdown map and excludes archived/missing skills", () => {
    const context = createService();
    try {
      context.repository.upsert({
        skillId: "custom/active",
        name: "Active",
        contentMarkdown: "active content",
        status: "active",
      });
      context.repository.upsert({
        skillId: "custom/archived",
        name: "Archived",
        contentMarkdown: "archived content",
        status: "archived",
      });

      const map = context.service.getActiveSkillMarkdownMap([
        "custom/active",
        "custom/archived",
        "custom/missing",
      ]);

      expect(map.get("custom/active")).toBe("active content");
      expect(map.has("custom/archived")).toBe(false);
      expect(map.has("custom/missing")).toBe(false);
    } finally {
      context.db.close();
    }
  });
});
