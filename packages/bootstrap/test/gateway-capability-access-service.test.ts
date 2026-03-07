import { describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { initDatabase, GatewayCapabilityGrantRepository } from "@spaceskit/persistence";
import {
  GatewayCapabilityAccessService,
  GatewayCapabilityAccessError,
} from "../src/services/gateway-capability-access-service.js";

function cleanupDb(dbPath: string): void {
  rmSync(dbPath, { force: true });
  rmSync(`${dbPath}-wal`, { force: true });
  rmSync(`${dbPath}-shm`, { force: true });
}

describe("GatewayCapabilityAccessService", () => {
  test("supports startup seeds + principal/device scoped grant and revoke", () => {
    const dbPath = join(tmpdir(), `spaceskit-capability-access-${crypto.randomUUID()}.db`);
    const db = initDatabase({
      path: dbPath,
      runtimeGeneration: "test_gateway_capability_access",
    });

    try {
      const service = new GatewayCapabilityAccessService({
        repository: new GatewayCapabilityGrantRepository(db.db),
        profileId: "embedded",
      });

      const seeded = service.seedStartupGrants([
        "calendar.read",
        "shell.execute", // embedded profile should skip this
      ]);
      expect(seeded.applied).toContain("calendar.read");
      expect(seeded.skipped).toContain("shell.execute");

      const globalDecision = service.evaluateInvocation({
        capability: "calendar",
        operation: "getEvents",
      });
      expect(globalDecision.decision.decision).toBe("allow");

      const grant = service.grantCapability({
        principalId: "principal-a",
        deviceId: "device-a",
        capabilityId: "lists.write",
        reason: "User allowed reminder edits.",
      });
      expect(grant.capabilityId).toBe("lists.write");

      const allowedDecision = service.evaluateInvocation({
        principalId: "principal-a",
        deviceId: "device-a",
        capability: "lists",
        operation: "create_item",
      });
      expect(allowedDecision.decision.decision).toBe("allow");

      const otherDeviceDecision = service.evaluateInvocation({
        principalId: "principal-a",
        deviceId: "device-b",
        capability: "lists",
        operation: "create_item",
      });
      expect(otherDeviceDecision.decision.decision).toBe("prompt");

      const revoked = service.revokeCapability({
        principalId: "principal-a",
        deviceId: "device-a",
        capabilityId: "lists.write",
      });
      expect(revoked.revoked).toBe(true);

      const afterRevokeDecision = service.evaluateInvocation({
        principalId: "principal-a",
        deviceId: "device-a",
        capability: "lists",
        operation: "create_item",
      });
      expect(afterRevokeDecision.decision.decision).toBe("prompt");
    } finally {
      db.close();
      cleanupDb(dbPath);
    }
  });

  test("rejects runtime grants that violate profile hard-blocks", () => {
    const dbPath = join(tmpdir(), `spaceskit-capability-access-deny-${crypto.randomUUID()}.db`);
    const db = initDatabase({
      path: dbPath,
      runtimeGeneration: "test_gateway_capability_access_denied",
    });

    try {
      const service = new GatewayCapabilityAccessService({
        repository: new GatewayCapabilityGrantRepository(db.db),
        profileId: "embedded",
      });

      expect(() => {
        service.grantCapability({
          principalId: "principal-a",
          deviceId: "device-a",
          capabilityId: "shell.execute",
        });
      }).toThrowError(GatewayCapabilityAccessError);
    } finally {
      db.close();
      cleanupDb(dbPath);
    }
  });
});
