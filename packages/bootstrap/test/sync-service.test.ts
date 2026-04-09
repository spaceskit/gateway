import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";
import {
  initDatabase,
  ArtifactRepository,
  SpaceRepository,
  SyncRuntimeRepository,
} from "@spaceskit/persistence";
import {
  BASIC_SPACE_ALIAS,
  BASIC_SPACE_ARTIFACT_TYPE,
  BASIC_SPACE_TAG,
  basicSpaceArtifactId,
} from "../src/services/basic-space-export.js";
import { evaluateSyncBoundaryPolicy } from "../src/services/share-boundary-policy.js";
import { DefaultGatewaySyncService } from "../src/services/sync-service.js";

function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

function createTestContext() {
  const db = initDatabase({
    path: ":memory:",
    runtimeGeneration: `test-sync-${crypto.randomUUID()}`,
  });

  return {
    db,
    artifacts: new ArtifactRepository(db.db),
    spaces: new SpaceRepository(db.db),
    sync: new SyncRuntimeRepository(db.db),
  };
}

function ensureSpace(
  context: ReturnType<typeof createTestContext>,
  input: { spaceId: string; resourceId: string },
): void {
  context.spaces.create({
    spaceId: input.spaceId,
    resourceId: input.resourceId,
    spaceType: "space",
    name: input.spaceId,
    goal: "test-space",
  });
}

describe("DefaultGatewaySyncService", () => {
  test("defaults query responses to generated basic.md exports with pagination", () => {
    const context = createTestContext();
    try {
      ensureSpace(context, { spaceId: "space-a", resourceId: "resource-main" });
      ensureSpace(context, { spaceId: "space-b", resourceId: "resource-main" });

      context.artifacts.create({
        artifactId: "artifact-note-a",
        spaceId: "space-a",
        resourceId: "resource-main",
        type: "note",
        title: "First shared note",
        contentJson: JSON.stringify({ text: "one" }),
        tagsJson: JSON.stringify(["sync", "alpha"]),
        visibility: "shared",
      });
      context.artifacts.create({
        artifactId: "artifact-note-b",
        spaceId: "space-b",
        resourceId: "resource-main",
        type: "note",
        title: "Second shared note",
        contentJson: JSON.stringify({ text: "two" }),
        tagsJson: JSON.stringify(["sync", "beta"]),
        visibility: "shared",
      });

      const secret = "peer-secret";
      const service = new DefaultGatewaySyncService(context.sync, context.artifacts, {
        spaceRepo: context.spaces,
      });
      service.announcePeer({
        peerId: "peer-a",
        resourceId: "resource-main",
        gatewayVersion: "v1",
        authSecretHash: hashSecret(secret),
      });

      const firstPage = service.queryResources({
        peerId: "peer-a",
        types: ["artifact"],
        tags: [BASIC_SPACE_TAG],
        limit: 1,
      }, secret);

      expect(firstPage.resources.length).toBe(1);
      expect(firstPage.resources[0].resourceId.startsWith("artifact-basic-")).toBe(true);
      expect(firstPage.nextCursor).toBeDefined();

      const secondPage = service.queryResources({
        peerId: "peer-a",
        types: ["artifact"],
        tags: [BASIC_SPACE_TAG],
        cursor: firstPage.nextCursor,
        limit: 1,
      }, secret);

      expect(secondPage.resources.length).toBe(1);
      expect(secondPage.resources[0].resourceId.startsWith("artifact-basic-")).toBe(true);
      expect(secondPage.resources[0].resourceId).not.toBe(firstPage.resources[0].resourceId);

      const full = service.queryResources({
        peerId: "peer-a",
        types: ["artifact"],
        limit: 20,
      }, secret);
      expect(full.resources.length).toBe(2);
      expect(full.resources.every((resource) => resource.resourceId.startsWith("artifact-basic-"))).toBe(true);
      expect(full.resources.some((resource) => resource.resourceId === "artifact-note-a")).toBe(false);
      expect(full.resources.some((resource) => resource.resourceId === "artifact-note-b")).toBe(false);
    } finally {
      context.db.close();
    }
  });

  test("defaults pull responses to basic.md and denies non-basic artifact refs", () => {
    const context = createTestContext();
    try {
      ensureSpace(context, { spaceId: "space-a", resourceId: "resource-main" });
      context.artifacts.create({
        artifactId: "artifact-note-a",
        spaceId: "space-a",
        resourceId: "resource-main",
        type: "note",
        title: "Note",
        contentJson: JSON.stringify({ text: "content" }),
        tagsJson: JSON.stringify(["sync"]),
        visibility: "shared",
      });

      const secret = "peer-secret";
      const service = new DefaultGatewaySyncService(context.sync, context.artifacts, {
        spaceRepo: context.spaces,
      });
      service.announcePeer({
        peerId: "peer-a",
        resourceId: "resource-main",
        gatewayVersion: "v1",
        authSecretHash: hashSecret(secret),
      });

      const response = service.pullResources({
        peerId: "peer-a",
        idempotencyKey: "pull-basic-1",
        refs: [
          { resourceType: "artifact", resourceId: "artifact-note-a" },
          { resourceType: "artifact", resourceId: basicSpaceArtifactId("space-a") },
        ],
      }, secret);

      expect(response.appliedCount).toBe(1);
      expect(response.skippedCount).toBe(0);
      expect(response.apiVersion).toBe("v2");
      expect(response.denied.length).toBe(1);
      expect(response.denied[0].reason.toLowerCase()).toContain("basic.md");
      expect(response.provenance.length).toBe(2);
      expect(response.provenance.some((entry) => entry.status === "applied")).toBe(true);
      expect(response.provenance.some((entry) => entry.status === "denied")).toBe(true);

      expect(response.resources.length).toBe(1);
      const payload = response.resources[0];
      expect(payload.ref.resourceId).toBe(basicSpaceArtifactId("space-a"));
      const content = payload.content as Record<string, unknown>;
      expect(content.type).toBe(BASIC_SPACE_ARTIFACT_TYPE);
      expect(content.title).toBe(BASIC_SPACE_ALIAS);
      expect(typeof content.contentJson).toBe("string");
    } finally {
      context.db.close();
    }
  });

  test("allows non-basic artifacts when artifact tags are allowlisted", () => {
    const context = createTestContext();
    try {
      ensureSpace(context, { spaceId: "space-a", resourceId: "resource-main" });
      context.artifacts.create({
        artifactId: "artifact-allow-tag",
        spaceId: "space-a",
        resourceId: "resource-main",
        type: "note-private",
        title: "Allowed by tag",
        contentJson: JSON.stringify({ text: "allowed" }),
        tagsJson: JSON.stringify(["allow-tag"]),
        visibility: "shared",
      });

      const flags = {
        syncAllowedArtifactTags: ["allow-tag"],
      } satisfies Record<string, unknown>;

      const secret = "peer-secret";
      const service = new DefaultGatewaySyncService(context.sync, context.artifacts, {
        spaceRepo: context.spaces,
        evaluateQueryPolicy: (contextPolicy) => evaluateSyncBoundaryPolicy({
          globalFlags: flags,
          peerId: contextPolicy.peerId,
          resourceType: contextPolicy.resourceType,
          resourceId: contextPolicy.resourceId,
          operation: "query",
          artifactType: contextPolicy.artifactType,
          title: contextPolicy.title,
          tags: contextPolicy.tags,
          isGeneratedBasic: contextPolicy.isGeneratedBasic,
        }),
        evaluatePullPolicy: (contextPolicy) => evaluateSyncBoundaryPolicy({
          globalFlags: flags,
          peerId: contextPolicy.peerId,
          resourceType: contextPolicy.resourceType,
          resourceId: contextPolicy.resourceId,
          operation: "pull",
          artifactType: contextPolicy.artifactType,
          title: contextPolicy.title,
          tags: contextPolicy.tags,
          isGeneratedBasic: contextPolicy.isGeneratedBasic,
        }),
      });

      service.announcePeer({
        peerId: "peer-a",
        resourceId: "resource-main",
        gatewayVersion: "v1",
        authSecretHash: hashSecret(secret),
      });

      const query = service.queryResources({
        peerId: "peer-a",
        types: ["artifact"],
        tags: ["allow-tag"],
        limit: 10,
      }, secret);

      expect(query.resources.some((resource) => resource.resourceId === "artifact-allow-tag")).toBe(true);

      const pull = service.pullResources({
        peerId: "peer-a",
        idempotencyKey: "pull-allow-tag",
        refs: [
          { resourceType: "artifact", resourceId: "artifact-allow-tag" },
        ],
      }, secret);

      expect(pull.appliedCount).toBe(1);
      expect(pull.denied.length).toBe(0);
      expect(pull.resources[0].ref.resourceId).toBe("artifact-allow-tag");
    } finally {
      context.db.close();
    }
  });

  test("imports remote basic.md resources via syncFromPeer and remains idempotent", async () => {
    const context = createTestContext();
    try {
      context.spaces.create({
        spaceId: "target-space",
        resourceId: "resource:target",
        spaceType: "space",
        name: "Target",
        goal: "Receive imports",
      });

      const remoteSpaceId = "remote-main-space";
      const remoteBasicId = basicSpaceArtifactId(remoteSpaceId);

      const secret = "remote-shared-secret";
      const fetchCalls: string[] = [];
      const fetchImpl: typeof fetch = async (input, init) => {
        const url = typeof input === "string" ? input : input.toString();
        fetchCalls.push(url);

        const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
        if (url.endsWith("/sync/query")) {
          expect(body.peerId).toBe("local-gateway");
          return Response.json({
            resources: [
              {
                resourceType: "artifact",
                resourceId: remoteBasicId,
                title: BASIC_SPACE_ALIAS,
                tags: [BASIC_SPACE_TAG, `space:${remoteSpaceId}`],
              },
            ],
          });
        }

        if (url.endsWith("/sync/pull")) {
          expect(body.peerId).toBe("local-gateway");
          return Response.json({
            resources: [
              {
                ref: {
                  resourceType: "artifact",
                  resourceId: remoteBasicId,
                  title: BASIC_SPACE_ALIAS,
                  tags: [BASIC_SPACE_TAG, `space:${remoteSpaceId}`],
                },
                content: {
                  type: BASIC_SPACE_ARTIFACT_TYPE,
                  title: BASIC_SPACE_ALIAS,
                  contentJson: JSON.stringify({
                    kind: BASIC_SPACE_ARTIFACT_TYPE,
                    version: "v1",
                    markdown: "# basic.md\nspace_id: remote-main-space",
                    metadata: {
                      space_id: remoteSpaceId,
                      name: "Remote Main Space",
                      goal: "Remote context",
                      status: "active",
                      updated_at: new Date().toISOString(),
                    },
                  }),
                  tags: [BASIC_SPACE_TAG, `space:${remoteSpaceId}`],
                },
              },
            ],
            denied: [],
            appliedCount: 1,
            skippedCount: 0,
          });
        }

        return new Response(JSON.stringify({ code: "NOT_FOUND", message: "unknown route" }), {
          status: 404,
          headers: { "content-type": "application/json" },
        });
      };

      const service = new DefaultGatewaySyncService(context.sync, context.artifacts, {
        spaceRepo: context.spaces,
        localPeerId: "local-gateway",
        resolvePeerSecret: () => secret,
        fetchImpl,
      });

      service.announcePeer({
        peerId: "peer-remote",
        resourceId: "resource-remote",
        gatewayVersion: "v1",
        endpointUrl: "http://127.0.0.1:9999",
        authSecretHash: hashSecret(secret),
      });

      const first = await service.syncFromPeer({
        peerId: "peer-remote",
        targetSpaceId: "target-space",
      });

      expect(first.pages).toBe(1);
      expect(first.queriedCount).toBe(1);
      expect(first.pulledCount).toBe(1);
      expect(first.importedCount).toBe(1);

      const importedRows = context.artifacts.listBySpace("target-space");
      expect(importedRows.length).toBe(1);
      expect(importedRows[0].artifact_type).toBe(BASIC_SPACE_ARTIFACT_TYPE);
      expect(importedRows[0].title).toBe(BASIC_SPACE_ALIAS);
      expect(importedRows[0].artifact_id.startsWith("artifact-sync-")).toBe(true);

      const importedPayload = JSON.parse(importedRows[0].content_json) as Record<string, unknown>;
      expect(importedPayload.kind).toBe(BASIC_SPACE_ARTIFACT_TYPE);

      const second = await service.syncFromPeer({
        peerId: "peer-remote",
        targetSpaceId: "target-space",
      });

      expect(second.importedCount).toBe(0);
      expect(second.skippedCount).toBeGreaterThanOrEqual(1);
      expect(fetchCalls.filter((url) => url.endsWith("/sync/query")).length).toBe(2);
      expect(fetchCalls.filter((url) => url.endsWith("/sync/pull")).length).toBe(2);
    } finally {
      context.db.close();
    }
  });

  test("requires valid inbound secret when peer has auth hash", () => {
    const context = createTestContext();
    try {
      const secret = "peer-secret";
      const service = new DefaultGatewaySyncService(context.sync, context.artifacts, {
        spaceRepo: context.spaces,
      });
      expect(() => service.queryResources({ peerId: "unknown-peer" })).toThrow("Sync peer not found");

      service.announcePeer({
        peerId: "peer-secure",
        resourceId: "resource-main",
        gatewayVersion: "v1",
        authSecretHash: hashSecret(secret),
      });

      expect(() => service.queryResources({ peerId: "peer-secure" })).toThrow("Sync secret required");
      expect(() => service.queryResources({ peerId: "peer-secure" }, "wrong")).toThrow("Invalid sync secret");

      const result = service.queryResources({ peerId: "peer-secure" }, secret);
      expect(Array.isArray(result.resources)).toBe(true);
    } finally {
      context.db.close();
    }
  });
});
