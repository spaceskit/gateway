import { afterEach, describe, expect, test } from "bun:test";
import { initDatabase } from "../src/database.js";
import { SpaceRepository } from "../src/repositories/spaces.js";
import { SpaceWorkspaceRepository } from "../src/repositories/space-workspaces.js";

const dbManagers: ReturnType<typeof initDatabase>[] = [];

afterEach(() => {
  while (dbManagers.length > 0) {
    dbManagers.pop()?.close();
  }
});

function createRepos() {
  const db = initDatabase({
    path: ":memory:",
    runtimeGeneration: `test-space-workspaces-${crypto.randomUUID()}`,
  });
  dbManagers.push(db);

  const spaces = new SpaceRepository(db.db);
  spaces.create({
    spaceId: "space-main",
    resourceId: "resource:main",
    name: "Main Space",
    spaceType: "space",
    goal: "",
    turnModel: "sequential_all",
  });

  return {
    workspaces: new SpaceWorkspaceRepository(db.db),
  };
}

describe("SpaceWorkspaceRepository", () => {
  test("upserts workspace bindings by space id", () => {
    const repos = createRepos();

    const first = repos.workspaces.upsert({
      spaceId: "space-main",
      explicitRoot: "",
      effectiveRoot: "/tmp/spaces/main",
      managedResourceId: "space-workspace-root-space-main",
      layoutVersion: 1,
    });

    expect(first.space_id).toBe("space-main");
    expect(first.explicit_root).toBe("");
    expect(first.effective_root).toBe("/tmp/spaces/main");
    expect(first.layout_version).toBe(1);

    const second = repos.workspaces.upsert({
      spaceId: "space-main",
      explicitRoot: "/tmp/explicit-root",
      effectiveRoot: "/tmp/explicit-root",
      managedResourceId: "space-workspace-root-space-main",
      layoutVersion: 2,
    });

    expect(second.space_id).toBe("space-main");
    expect(second.explicit_root).toBe("/tmp/explicit-root");
    expect(second.effective_root).toBe("/tmp/explicit-root");
    expect(second.layout_version).toBe(2);
    expect(second.created_at).toBe(first.created_at);
  });

  test("deletes workspace rows by space id", () => {
    const repos = createRepos();
    repos.workspaces.upsert({
      spaceId: "space-main",
      explicitRoot: "",
      effectiveRoot: "/tmp/spaces/main",
      managedResourceId: "space-workspace-root-space-main",
      layoutVersion: 1,
    });

    expect(repos.workspaces.delete("space-main")).toBe(true);
    expect(repos.workspaces.getBySpace("space-main")).toBeUndefined();
  });
});

