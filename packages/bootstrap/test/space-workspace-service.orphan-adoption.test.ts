import { mkdtemp, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "bun:test";
import { initDatabase } from "../../persistence/src/database.js";
import { SpaceRepository } from "../../persistence/src/repositories/spaces.js";
import { SpaceResourceRepository } from "../../persistence/src/repositories/space-resources.js";
import { SpaceWorkspaceRepository } from "../../persistence/src/repositories/space-workspaces.js";
import { SpaceWorkspaceService } from "../src/services/space-workspace-service.js";

// Reproduces the orphan-folder accumulation: when the DB is wiped but the on-disk managed folder
// survives, the seeder used to mint a brand-new "<slug>--<uid>" folder and leave the old one as a
// dead orphan. ensureWorkspace must now adopt the existing folder so a reset yields exactly one.

function seedSpace(db: ReturnType<typeof initDatabase>, configJson: string) {
  const spaces = new SpaceRepository(db.db);
  spaces.create({
    spaceId: "concierge-space",
    resourceId: "resource-concierge",
    spaceType: "concierge",
    name: "Embedded Concierge",
    goal: "",
    turnModel: "sequential_all",
    configJson,
  });
  return {
    db,
    spaces,
    resources: new SpaceResourceRepository(db.db),
    workspaces: new SpaceWorkspaceRepository(db.db),
  };
}

function newDb() {
  return initDatabase({
    path: ":memory:",
    runtimeGeneration: `test-orphan-adoption-${crypto.randomUUID()}`,
  });
}

async function countManagedFolders(root: string): Promise<number> {
  const entries = await readdir(root, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory()).length;
}

describe("SpaceWorkspaceService orphan adoption", () => {
  test("adopts the existing on-disk folder after a DB wipe instead of minting a new one", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "spaceskit-orphan-adopt-"));
    try {
      // First boot: provision the folder with one spaceUid.
      const ctx1 = seedSpace(newDb(), JSON.stringify({ spaceUid: "aaaaaaaa-1111-4111-8111-111111111111" }));
      const svc1 = new SpaceWorkspaceService({
        spaces: ctx1.spaces,
        resources: ctx1.resources,
        workspaces: ctx1.workspaces,
        spacesRoot: tempRoot,
      });
      const first = await svc1.ensureWorkspace("concierge-space");
      const firstRoot = first.effectiveWorkspaceRoot;
      expect(await countManagedFolders(tempRoot)).toBe(1);

      // Simulate a DB wipe: brand-new DB, same spaceId, NO stored spaceUid, NO workspace row.
      // The disk folder from the first boot remains.
      const ctx2 = seedSpace(newDb(), JSON.stringify({}));
      const svc2 = new SpaceWorkspaceService({
        spaces: ctx2.spaces,
        resources: ctx2.resources,
        workspaces: ctx2.workspaces,
        spacesRoot: tempRoot,
      });
      const second = await svc2.ensureWorkspace("concierge-space");

      // Same folder reused; no orphan created.
      expect(second.effectiveWorkspaceRoot).toBe(firstRoot);
      expect(await countManagedFolders(tempRoot)).toBe(1);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  test("repeated provisioning across many DB wipes never accumulates folders", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "spaceskit-orphan-loop-"));
    try {
      for (let i = 0; i < 4; i += 1) {
        // Each iteration is a fresh DB with no stored uid and no workspace row.
        const ctx = seedSpace(newDb(), JSON.stringify({}));
        const svc = new SpaceWorkspaceService({
          spaces: ctx.spaces,
          resources: ctx.resources,
          workspaces: ctx.workspaces,
          spacesRoot: tempRoot,
        });
        await svc.ensureWorkspace("concierge-space");
      }
      expect(await countManagedFolders(tempRoot)).toBe(1);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});
