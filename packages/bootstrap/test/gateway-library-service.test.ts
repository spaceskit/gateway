import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initDatabase } from "../../persistence/src/database.js";
import { GatewaySkillCatalogRepository } from "../../persistence/src/repositories/gateway-skill-catalog.js";
import { GatewayLinkedSkillIndexRepository } from "../../persistence/src/repositories/gateway-linked-skill-index.js";
import { GatewayLibraryService } from "../src/services/gateway-library-service.js";

const dbManagers: ReturnType<typeof initDatabase>[] = [];
const tempDirs: string[] = [];

beforeEach(() => {
  tempDirs.length = 0;
});

afterEach(() => {
  while (dbManagers.length > 0) {
    dbManagers.pop()?.close();
  }
  for (const dir of tempDirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  }
});

function createContext() {
  const db = initDatabase({
    path: ":memory:",
    runtimeGeneration: `test-gateway-library-${crypto.randomUUID()}`,
  });
  dbManagers.push(db);
  return {
    db,
    repository: new GatewaySkillCatalogRepository(db.db),
    linkedRepository: new GatewayLinkedSkillIndexRepository(db.db),
  };
}

function createSkillRoot(skillName: string, content: string) {
  const root = mkdtempSync(join(tmpdir(), "spaces-linked-skills-"));
  tempDirs.push(root);
  const skillDir = join(root, skillName);
  mkdirSync(skillDir, { recursive: true });
  const filePath = join(skillDir, "SKILL.md");
  writeFileSync(filePath, content, "utf8");
  return { root, filePath };
}

describe("GatewayLibraryService", () => {
  test("prioritizes linked entries before installed entries when applying list limits", () => {
    const context = createContext();
    const skill = createSkillRoot("brainstorming", [
      "---",
      "name: brainstorming",
      "---",
      "",
      "# brainstorming",
      "",
      "Use this before implementation.",
    ].join("\n"));

    context.repository.upsert({
      skillId: "installed-zeta",
      name: "Zeta Installed",
      description: "Installed catalog entry",
      contentMarkdown: "# installed",
      sourceKind: "installed",
      enabled: true,
    });

    const service = new GatewayLibraryService({
      repository: context.repository,
      linkedRepository: context.linkedRepository,
      scanRoots: [skill.root],
    });

    service.scanEntries();

    const entries = service.listEntries({
      includeContent: false,
      includeArchived: true,
      limit: 1,
    });

    expect(entries).toHaveLength(1);
    expect(entries[0]?.sourceKind).toBe("linked");
    expect(entries[0]?.name).toBe("brainstorming");
  });

  test("indexes linked local skills and lists lightweight linked entries", () => {
    const context = createContext();
    const skill = createSkillRoot("brainstorming", [
      "---",
      "name: brainstorming",
      "description: Explore intent before implementation.",
      "---",
      "",
      "# brainstorming",
      "",
      "Use this before implementation.",
    ].join("\n"));

    const service = new GatewayLibraryService({
      repository: context.repository,
      linkedRepository: context.linkedRepository,
      scanRoots: [skill.root],
    });

    service.scanEntries();

    const entries = service.listEntries({
      sourceKinds: ["linked"],
      includeContent: false,
      includeArchived: true,
    });

    expect(entries).toHaveLength(1);
    expect(entries[0]?.sourceKind).toBe("linked");
    expect(entries[0]?.skillId).toContain("linked.");
    expect(entries[0]?.contentMarkdown).toBeUndefined();
    expect(entries[0]?.syncState).toBe("ready");
  });

  test("refreshes linked skill content from disk on next use", async () => {
    const context = createContext();
    const skill = createSkillRoot("brainstorming", [
      "---",
      "name: brainstorming",
      "---",
      "",
      "# brainstorming",
      "",
      "Version A",
    ].join("\n"));

    const service = new GatewayLibraryService({
      repository: context.repository,
      linkedRepository: context.linkedRepository,
      scanRoots: [skill.root],
    });

    service.scanEntries();
    const entry = service.listEntries({ sourceKinds: ["linked"], includeArchived: true })[0];
    expect(entry?.skillId).toBeTruthy();

    const first = service.getActiveSkillMarkdownMap([entry!.skillId!]);
    expect(first.get(entry!.skillId!)).toContain("Version A");

    await Bun.sleep(20);
    writeFileSync(skill.filePath, [
      "---",
      "name: brainstorming",
      "---",
      "",
      "# brainstorming",
      "",
      "Version B",
    ].join("\n"), "utf8");

    const second = service.getActiveSkillMarkdownMap([entry!.skillId!]);
    expect(second.get(entry!.skillId!)).toContain("Version B");
  });
});
