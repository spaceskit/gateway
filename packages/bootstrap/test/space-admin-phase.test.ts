import { describe, expect, test } from "bun:test";
import {
  SpaceRepository,
  ToolAccessPolicyRepository,
  initDatabase,
} from "@spaceskit/persistence";
import { EventBus, CapabilityRegistry } from "@spaceskit/core";
import { initializeSpaceAdminService } from "../src/space-admin-phase.js";

const logger = {
  info() {},
  warn() {},
  error() {},
} as const;

describe("initializeSpaceAdminService", () => {
  test("seeds new spaces with a read_only guest access preset", async () => {
    const db = initDatabase({
      path: ":memory:",
      runtimeGeneration: `test-space-admin-phase-${crypto.randomUUID()}`,
    });

    try {
      const spaceRepo = new SpaceRepository(db.db);
      const toolAccessPolicyRepo = new ToolAccessPolicyRepository(db.db);
      const state = {
        config: {
          mainSpaceId: "space-main",
        },
        logger,
        eventBus: new EventBus(),
        capabilities: new CapabilityRegistry(new EventBus()),
        spaceRepo,
        toolAccessPolicyRepo,
      } as any;

      initializeSpaceAdminService(state);

      await state.spaceAdminService.createSpace({
        idempotencyKey: "space-new",
        spaceId: "space-new",
        resourceId: "resource-new",
        name: "New Space",
      });

      expect(toolAccessPolicyRepo.get("space", "space-new")?.guest_access_preset).toBe("read_only");
    } finally {
      db.close();
    }
  });
});
