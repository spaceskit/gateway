import { describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { initDatabase, ToolApprovalGrantRepository } from "@spaceskit/persistence";
import { ToolApprovalGrantService } from "../src/services/tool-approval-grant-service.js";

function cleanupDb(dbPath: string): void {
  rmSync(dbPath, { force: true });
  rmSync(`${dbPath}-wal`, { force: true });
  rmSync(`${dbPath}-shm`, { force: true });
}

describe("ToolApprovalGrantService", () => {
  test("matches global-device grants and respects expiry", () => {
    const dbPath = join(tmpdir(), `spaceskit-tool-approval-${crypto.randomUUID()}.db`);
    const db = initDatabase({
      path: dbPath,
      runtimeGeneration: "test_tool_approval_grants",
    });
    let currentTime = new Date("2026-03-09T10:00:00.000Z");

    try {
      const service = new ToolApprovalGrantService({
        repository: new ToolApprovalGrantRepository(db.db),
        now: () => currentTime,
      });

      service.grantApproval({
        principalId: "principal-1",
        spaceId: "space-1",
        toolId: "tool-a",
        mode: "time_window",
        expiresAt: "2026-03-09T10:15:00.000Z",
      });

      expect(service.hasActiveGrant({
        principalId: "principal-1",
        deviceId: "device-1",
        spaceId: "space-1",
        toolId: "tool-a",
      })).toBe(true);

      currentTime = new Date("2026-03-09T10:16:00.000Z");
      expect(service.hasActiveGrant({
        principalId: "principal-1",
        deviceId: "device-1",
        spaceId: "space-1",
        toolId: "tool-a",
      })).toBe(false);
    } finally {
      db.close();
      cleanupDb(dbPath);
    }
  });

  test("revokes durable space-scoped grants", () => {
    const dbPath = join(tmpdir(), `spaceskit-tool-approval-revoke-${crypto.randomUUID()}.db`);
    const db = initDatabase({
      path: dbPath,
      runtimeGeneration: "test_tool_approval_grants_revoke",
    });

    try {
      const service = new ToolApprovalGrantService({
        repository: new ToolApprovalGrantRepository(db.db),
      });

      service.grantApproval({
        principalId: "principal-1",
        deviceId: "device-1",
        spaceId: "space-1",
        toolId: "tool-a",
        mode: "durable",
      });

      expect(service.listGrants({
        principalId: "principal-1",
        deviceId: "device-1",
        spaceId: "space-1",
      })).toHaveLength(1);

      const revoked = service.revokeGrant({
        principalId: "principal-1",
        deviceId: "device-1",
        spaceId: "space-1",
        toolId: "tool-a",
      });

      expect(revoked.revoked).toBe(true);
      expect(service.hasActiveGrant({
        principalId: "principal-1",
        deviceId: "device-1",
        spaceId: "space-1",
        toolId: "tool-a",
      })).toBe(false);
    } finally {
      db.close();
      cleanupDb(dbPath);
    }
  });
});
