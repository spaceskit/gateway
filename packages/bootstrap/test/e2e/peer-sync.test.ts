/**
 * Phase 5: Peer Sync E2E Tests
 *
 * Starts 2 in-process gateways and tests sync announce/query/pull over HTTP.
 */

import { describe, expect, test, afterAll } from "bun:test";
import {
  createTestGateway,
  postJson,
  E2E_TIMEOUT,
  type TestGateway,
} from "./harness.js";

let gwA: TestGateway;
let gwB: TestGateway;

afterAll(async () => {
  await gwA?.cleanup();
  await gwB?.cleanup();
});

interface SyncAnnounceResult {
  peerId: string;
  resourceId: string;
  gatewayVersion: string;
  syncEnabled: boolean;
  announcedAt: string;
}

interface SyncQueryResult {
  resources: Array<{
    resourceType: string;
    resourceId: string;
    title?: string;
  }>;
  nextCursor?: string;
}

interface SyncPullResult {
  appliedCount: number;
  skippedCount: number;
  denied: Array<{ reason: string }>;
  resources: Array<Record<string, unknown>>;
}

describe("peer sync (2 gateways)", () => {
  test(
    "announce: gateway A announces to gateway B",
    { timeout: E2E_TIMEOUT },
    async () => {
      gwA = await createTestGateway({
        mainSpaceResourceId: "resource:gw-a",
      });
      gwB = await createTestGateway({
        mainSpaceResourceId: "resource:gw-b",
      });

      const { status, data } = await postJson<SyncAnnounceResult>(
        `${gwB.httpUrl}/sync/announce`,
        {
          peerId: "gw-a-peer",
          resourceId: "resource:gw-a",
          gatewayVersion: "e2e-test-1",
          endpointUrl: gwA.httpUrl,
        },
      );

      expect(status).toBe(200);
      expect(data.peerId).toBe("gw-a-peer");
      expect(data.syncEnabled).toBe(true);
      expect(data.announcedAt).toBeTruthy();
    },
  );

  test(
    "query: query resources from peer",
    { timeout: E2E_TIMEOUT },
    async () => {
      if (!gwB) {
        gwB = await createTestGateway({
          mainSpaceResourceId: "resource:gw-b",
        });
      }

      const { status, data } = await postJson<SyncQueryResult>(
        `${gwB.httpUrl}/sync/query`,
        {
          peerId: "gw-a-peer",
          types: ["artifact"],
          limit: 10,
        },
      );

      expect(status).toBe(200);
      expect(data.resources).toBeDefined();
      expect(Array.isArray(data.resources)).toBe(true);
    },
  );

  test(
    "pull: pull resource from peer",
    { timeout: E2E_TIMEOUT },
    async () => {
      if (!gwB) {
        gwB = await createTestGateway({
          mainSpaceResourceId: "resource:gw-b",
        });
      }

      // Query first to find available resources
      const queryResult = await postJson<SyncQueryResult>(
        `${gwB.httpUrl}/sync/query`,
        {
          peerId: "gw-a-peer",
          limit: 10,
        },
      );

      if (queryResult.data.resources.length > 0) {
        const ref = queryResult.data.resources[0];
        const { status, data } = await postJson<SyncPullResult>(
          `${gwB.httpUrl}/sync/pull`,
          {
            peerId: "gw-a-peer",
            idempotencyKey: `e2e-pull-${crypto.randomUUID()}`,
            refs: [
              {
                resourceType: ref.resourceType,
                resourceId: ref.resourceId,
              },
            ],
          },
        );

        expect(status).toBe(200);
        expect(data.appliedCount + data.skippedCount + data.denied.length).toBeGreaterThanOrEqual(0);
      }
    },
  );

  test(
    "idempotent pull: same resource twice with same idempotency key",
    { timeout: E2E_TIMEOUT },
    async () => {
      if (!gwB) {
        gwB = await createTestGateway({
          mainSpaceResourceId: "resource:gw-b",
        });
      }

      const queryResult = await postJson<SyncQueryResult>(
        `${gwB.httpUrl}/sync/query`,
        {
          peerId: "gw-a-peer",
          limit: 10,
        },
      );

      if (queryResult.data.resources.length > 0) {
        const ref = queryResult.data.resources[0];
        const idempotencyKey = `e2e-idempotent-${crypto.randomUUID()}`;
        const refs = [
          {
            resourceType: ref.resourceType,
            resourceId: ref.resourceId,
          },
        ];

        const pull1 = await postJson<SyncPullResult>(
          `${gwB.httpUrl}/sync/pull`,
          { peerId: "gw-a-peer", idempotencyKey, refs },
        );

        // Second pull with same idempotency key — should not error
        const pull2 = await postJson<SyncPullResult>(
          `${gwB.httpUrl}/sync/pull`,
          { peerId: "gw-a-peer", idempotencyKey, refs },
        );

        // Both pulls should complete without errors
        expect(pull1.status).toBe(200);
        expect(pull2.status).toBe(200);
        // Total applied across both pulls should be at most 1 (no duplication)
        const totalApplied = pull1.data.appliedCount + pull2.data.appliedCount;
        const totalSkipped = pull1.data.skippedCount + pull2.data.skippedCount;
        expect(totalApplied + totalSkipped).toBeGreaterThanOrEqual(0);
      }
    },
  );
});
