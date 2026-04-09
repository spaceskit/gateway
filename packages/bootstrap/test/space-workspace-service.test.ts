import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "bun:test";
import { initDatabase } from "../../persistence/src/database.js";
import { SpaceRepository } from "../../persistence/src/repositories/spaces.js";
import { SpaceResourceRepository } from "../../persistence/src/repositories/space-resources.js";
import { SpaceWorkspaceRepository } from "../../persistence/src/repositories/space-workspaces.js";
import { SpaceWorkspaceService } from "../src/services/space-workspace-service.js";

const TEST_SPACE_UID = "11111111-1111-1111-8111-111111111111";

function createContext() {
  const db = initDatabase({
    path: ":memory:",
    runtimeGeneration: `test-space-workspace-service-${crypto.randomUUID()}`,
  });

  const spaces = new SpaceRepository(db.db);
  spaces.create({
    spaceId: "space-main",
    resourceId: "resource-main",
    spaceType: "space",
    name: "Main Space",
    goal: "",
    turnModel: "sequential_all",
    configJson: JSON.stringify({
      spaceUid: TEST_SPACE_UID,
    }),
  });

  return {
    db,
    spaces,
    resources: new SpaceResourceRepository(db.db),
    workspaces: new SpaceWorkspaceRepository(db.db),
  };
}

describe("SpaceWorkspaceService", () => {
  test("provisions managed workspace layout under .space and managed resource", async () => {
    const context = createContext();
    const tempRoot = await mkdtemp(join(tmpdir(), "spaceskit-workspace-default-"));
    const expectedRoot = join(tempRoot, "main-space--11111111");

    try {
      const service = new SpaceWorkspaceService({
        spaces: context.spaces,
        resources: context.resources,
        workspaces: context.workspaces,
        spacesRoot: tempRoot,
      });

      const workspace = await service.ensureWorkspace("space-main");
      expect(workspace.mode).toBe("managed");
      expect(workspace.effectiveWorkspaceRoot).toBe(expectedRoot);
      expect(workspace.metadataStatus).toBe("ready");
      expect(workspace.metaPath).toBe(join(workspace.effectiveWorkspaceRoot, ".space"));
      expect(workspace.gitRepoDetected).toBe(false);
      expect(context.workspaces.getBySpace("space-main")?.managed_folder_name).toBe("main-space--11111111");

      await expect(stat(workspace.metaPath)).resolves.toBeDefined();
      await expect(stat(workspace.logsPath)).resolves.toBeDefined();
      await expect(stat(workspace.workPath)).resolves.toBeDefined();
      await expect(stat(workspace.sharedContextPath)).resolves.toBeDefined();
      await expect(stat(workspace.scratchpadsPath)).resolves.toBeDefined();
      await expect(stat(join(workspace.metaPath, "manifest.json"))).resolves.toBeDefined();
      await expect(stat(join(workspace.metaPath, "space.json"))).resolves.toBeDefined();

      const managedResource = context.resources.get("space-main", "space-workspace-root-space-main");
      expect(managedResource).toBeDefined();
      expect(managedResource?.type).toBe("folder");
      expect(managedResource?.uri).toContain(workspace.effectiveWorkspaceRoot);
    } finally {
      context.db.close();
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  test("keeps the managed folder basename stable after later space renames", async () => {
    const context = createContext();
    const tempRoot = await mkdtemp(join(tmpdir(), "spaceskit-workspace-rename-"));

    try {
      const service = new SpaceWorkspaceService({
        spaces: context.spaces,
        resources: context.resources,
        workspaces: context.workspaces,
        spacesRoot: tempRoot,
      });

      const firstWorkspace = await service.ensureWorkspace("space-main");
      context.db.db
        .query("UPDATE spaces SET name = ?, updated_at = ? WHERE space_id = ?")
        .run("Renamed Space", new Date().toISOString(), "space-main");

      const secondWorkspace = await service.ensureWorkspace("space-main");
      expect(secondWorkspace.effectiveWorkspaceRoot).toBe(firstWorkspace.effectiveWorkspaceRoot);
      expect(context.workspaces.getBySpace("space-main")?.managed_folder_name).toBe("main-space--11111111");
    } finally {
      context.db.close();
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  test("setWorkspace provisions .space inside a folder-bound root and gitignores it for repos", async () => {
    const context = createContext();
    const tempRoot = await mkdtemp(join(tmpdir(), "spaceskit-workspace-switch-"));
    const explicitRoot = join(tempRoot, "custom-root");

    try {
      await mkdir(join(explicitRoot, ".git"), { recursive: true });
      const service = new SpaceWorkspaceService({
        spaces: context.spaces,
        resources: context.resources,
        workspaces: context.workspaces,
        spacesRoot: join(tempRoot, "gateway-spaces"),
      });

      const defaultWorkspace = await service.ensureWorkspace("space-main");
      const explicitWorkspace = await service.setWorkspace("space-main", explicitRoot);
      expect(explicitWorkspace.mode).toBe("folder_bound");
      expect(explicitWorkspace.explicitWorkspaceRoot).toBe(explicitRoot);
      expect(explicitWorkspace.effectiveWorkspaceRoot).toBe(explicitRoot);
      expect(explicitWorkspace.metadataStatus).toBe("ready");
      expect(explicitWorkspace.metaPath).toBe(join(explicitRoot, ".space"));
      expect(explicitWorkspace.gitRepoDetected).toBe(true);

      await expect(stat(defaultWorkspace.effectiveWorkspaceRoot)).resolves.toBeDefined();
      await expect(stat(explicitWorkspace.effectiveWorkspaceRoot)).resolves.toBeDefined();
      await expect(stat(join(explicitRoot, ".space", "space.json"))).resolves.toBeDefined();
      await expect(stat(join(explicitRoot, ".space", "policy.json"))).resolves.toBeDefined();
      await expect(stat(join(explicitRoot, ".space", "local.override.json"))).resolves.toBeDefined();
      const gitignore = await readFile(join(explicitRoot, ".gitignore"), "utf8");
      expect(gitignore).toContain(".space/");

      const managedResource = context.resources.get("space-main", "space-workspace-root-space-main");
      expect(managedResource?.uri).toContain(explicitRoot);
    } finally {
      context.db.close();
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  test("resets existing UUID-named managed roots onto friendly folder names", async () => {
    const context = createContext();
    const tempRoot = await mkdtemp(join(tmpdir(), "spaceskit-workspace-reset-"));
    const legacyRoot = join(tempRoot, TEST_SPACE_UID);
    const expectedRoot = join(tempRoot, "main-space--11111111");

    try {
      await mkdir(join(legacyRoot, ".space"), { recursive: true });
      await writeFile(join(legacyRoot, ".space", "space.json"), JSON.stringify({
        spaceId: "space-main",
        spaceUid: TEST_SPACE_UID,
        mode: "managed",
        effectiveWorkspaceRoot: legacyRoot,
      }), "utf8");
      context.workspaces.upsert({
        spaceId: "space-main",
        explicitRoot: "",
        effectiveRoot: legacyRoot,
        managedFolderName: "",
        managedResourceId: "space-workspace-root-space-main",
        layoutVersion: 2,
      });

      const service = new SpaceWorkspaceService({
        spaces: context.spaces,
        resources: context.resources,
        workspaces: context.workspaces,
        spacesRoot: tempRoot,
      });

      const workspace = await service.ensureWorkspace("space-main");
      expect(workspace.effectiveWorkspaceRoot).toBe(expectedRoot);
      expect(workspace.effectiveWorkspaceRoot).not.toBe(legacyRoot);
      expect(context.workspaces.getBySpace("space-main")?.managed_folder_name).toBe("main-space--11111111");
      expect(context.workspaces.getBySpace("space-main")?.effective_root).toBe(expectedRoot);
      expect(context.resources.get("space-main", "space-workspace-root-space-main")?.uri).toContain(expectedRoot);
      await expect(stat(legacyRoot)).resolves.toBeDefined();
      await expect(stat(expectedRoot)).resolves.toBeDefined();
    } finally {
      context.db.close();
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  test("falls back to the full uid suffix when the short friendly folder is already claimed", async () => {
    const context = createContext();
    const tempRoot = await mkdtemp(join(tmpdir(), "spaceskit-workspace-friendly-conflict-"));
    const shortCandidateRoot = join(tempRoot, "main-space--11111111");
    const fallbackRoot = join(tempRoot, `main-space--${TEST_SPACE_UID}`);

    try {
      await mkdir(join(shortCandidateRoot, ".space"), { recursive: true });
      await writeFile(join(shortCandidateRoot, ".space", "space.json"), JSON.stringify({
        spaceId: "space-other",
        spaceUid: "22222222-2222-2222-8222-222222222222",
      }), "utf8");

      const service = new SpaceWorkspaceService({
        spaces: context.spaces,
        resources: context.resources,
        workspaces: context.workspaces,
        spacesRoot: tempRoot,
      });

      const workspace = await service.ensureWorkspace("space-main");
      expect(workspace.effectiveWorkspaceRoot).toBe(fallbackRoot);
      expect(context.workspaces.getBySpace("space-main")?.managed_folder_name).toBe(
        `main-space--${TEST_SPACE_UID}`,
      );
    } finally {
      context.db.close();
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  test("appends metadata-only events into space logs/events.jsonl by default", async () => {
    const context = createContext();
    const tempRoot = await mkdtemp(join(tmpdir(), "spaceskit-workspace-logs-"));

    try {
      const service = new SpaceWorkspaceService({
        spaces: context.spaces,
        resources: context.resources,
        workspaces: context.workspaces,
        spacesRoot: tempRoot,
      });

      const workspace = await service.ensureWorkspace("space-main");
      await service.appendSpaceEventLog("space-main", {
        type: "space.turn_started",
        timestamp: new Date(),
        spaceId: "space-main",
        turnId: "turn-1",
        agentId: "agent-main",
        input: "do not persist this full prompt body",
        payload: { nested: "should not be fully persisted in non-debug mode" },
        eventType: "started",
      });

      const logContents = await readFile(join(workspace.logsPath, "events.jsonl"), "utf8");
      const lines = logContents.trim().split("\n");
      expect(lines.length).toBe(1);
      const parsed = JSON.parse(lines[0]) as Record<string, unknown>;
      const metadata = parsed.metadata as Record<string, unknown>;
      expect(parsed.type).toBe("space.turn_started");
      expect(metadata.input).toBeUndefined();
      expect(metadata.payload).toBeUndefined();
      expect(metadata.eventType).toBe("started");
    } finally {
      context.db.close();
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  test("fails when a folder-bound root is already claimed by another space", async () => {
    const context = createContext();
    const tempRoot = await mkdtemp(join(tmpdir(), "spaceskit-workspace-conflict-"));
    const explicitRoot = join(tempRoot, "claimed-root");

    try {
      await mkdir(join(explicitRoot, ".space"), { recursive: true });
      await writeFile(join(explicitRoot, ".space", "space.json"), JSON.stringify({
        spaceId: "space-other",
        spaceUid: "22222222-2222-2222-8222-222222222222",
      }), "utf8");

      const service = new SpaceWorkspaceService({
        spaces: context.spaces,
        resources: context.resources,
        workspaces: context.workspaces,
        spacesRoot: join(tempRoot, "gateway-spaces"),
      });

      await expect(service.setWorkspace("space-main", explicitRoot)).rejects.toMatchObject({
        code: "FAILED_PRECONDITION",
      });
    } finally {
      context.db.close();
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});
