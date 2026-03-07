import { describe, expect, test } from "bun:test";
import {
  initDatabase,
  ArtifactRepository,
  SpaceContextTransferRepository,
  SpaceLinkRepository,
  SpaceRepository,
} from "@spaceskit/persistence";
import {
  BASIC_SPACE_ALIAS,
  BASIC_SPACE_ARTIFACT_TYPE,
  basicSpaceArtifactId,
} from "../src/services/basic-space-export.js";
import { evaluateCrossSpaceBoundaryPolicy } from "../src/services/share-boundary-policy.js";
import { SpaceContextService } from "../src/services/space-context-service.js";

function createContext() {
  const db = initDatabase({
    path: ":memory:",
    runtimeGeneration: `test-space-context-${crypto.randomUUID()}`,
  });

  return {
    db,
    artifacts: new ArtifactRepository(db.db),
    links: new SpaceLinkRepository(db.db),
    transfers: new SpaceContextTransferRepository(db.db),
    spaces: new SpaceRepository(db.db),
  };
}

function ensureSpace(
  context: ReturnType<typeof createContext>,
  input: { spaceId: string; resourceId: string; name: string },
): void {
  context.spaces.create({
    spaceId: input.spaceId,
    resourceId: input.resourceId,
    spaceType: "room",
    name: input.name,
    goal: `${input.name} goal`,
  });
}

describe("SpaceContextService", () => {
  test("shares basic.md alias and imports generated metadata artifact", () => {
    const context = createContext();
    try {
      ensureSpace(context, {
        spaceId: "source-space",
        resourceId: "resource-main",
        name: "Source Space",
      });
      ensureSpace(context, {
        spaceId: "target-space",
        resourceId: "resource-main",
        name: "Target Space",
      });

      const service = new SpaceContextService({
        links: context.links,
        transfers: context.transfers,
        artifacts: context.artifacts,
        spaces: context.spaces,
      });

      service.linkSpaces("source-space", "target-space");
      const transfer = service.shareContext("source-space", "target-space", BASIC_SPACE_ALIAS);

      expect(transfer.artifactId).toBe(basicSpaceArtifactId("source-space"));
      const sourceBasicArtifact = context.artifacts.getById(transfer.artifactId);
      expect(sourceBasicArtifact).toBeDefined();
      expect(sourceBasicArtifact?.artifact_type).toBe(BASIC_SPACE_ARTIFACT_TYPE);

      const pulled = service.pullSharedContext("source-space", "target-space");
      expect(pulled.denied).toEqual([]);
      expect(pulled.importedArtifacts.length).toBe(1);

      const importedArtifacts = context.artifacts.listBySpace("target-space");
      expect(importedArtifacts.length).toBe(1);
      expect(importedArtifacts[0].artifact_type).toBe(BASIC_SPACE_ARTIFACT_TYPE);
    } finally {
      context.db.close();
    }
  });

  test("denies non-basic share by default", () => {
    const context = createContext();
    try {
      ensureSpace(context, {
        spaceId: "source-space",
        resourceId: "resource-main",
        name: "Source Space",
      });
      ensureSpace(context, {
        spaceId: "target-space",
        resourceId: "resource-main",
        name: "Target Space",
      });

      context.artifacts.create({
        artifactId: "artifact-note-source",
        spaceId: "source-space",
        resourceId: "resource-main",
        type: "note",
        title: "Sensitive note",
        contentJson: JSON.stringify({ text: "not shareable by default" }),
        tagsJson: JSON.stringify(["private"]),
        visibility: "shared",
      });

      const service = new SpaceContextService({
        links: context.links,
        transfers: context.transfers,
        artifacts: context.artifacts,
        spaces: context.spaces,
      });

      service.linkSpaces("source-space", "target-space");
      expect(() => service.shareContext("source-space", "target-space", "artifact-note-source"))
        .toThrow("basic.md");
    } finally {
      context.db.close();
    }
  });

  test("allows non-basic share/import when cross-space artifact tags are allowlisted", () => {
    const context = createContext();
    try {
      ensureSpace(context, {
        spaceId: "source-space",
        resourceId: "resource-main",
        name: "Source Space",
      });
      ensureSpace(context, {
        spaceId: "target-space",
        resourceId: "resource-main",
        name: "Target Space",
      });

      context.artifacts.create({
        artifactId: "artifact-note-allow",
        spaceId: "source-space",
        resourceId: "resource-main",
        type: "note",
        title: "Allowlisted note",
        contentJson: JSON.stringify({ text: "allowed by policy" }),
        tagsJson: JSON.stringify(["allow-cross"]),
        visibility: "shared",
      });

      const globalFlags = {
        crossSpaceAllowedArtifactTags: ["allow-cross"],
      } satisfies Record<string, unknown>;

      const service = new SpaceContextService({
        links: context.links,
        transfers: context.transfers,
        artifacts: context.artifacts,
        spaces: context.spaces,
        evaluateSharePolicy: (policyContext) => evaluateCrossSpaceBoundaryPolicy({
          globalFlags,
          sourceSpaceId: policyContext.sourceSpaceId,
          targetSpaceId: policyContext.targetSpaceId,
          artifactId: policyContext.artifactId,
          operation: "share",
          artifactType: policyContext.artifactType,
          title: policyContext.title,
          tags: policyContext.tags,
          isGeneratedBasic: policyContext.isGeneratedBasic,
        }),
        evaluateImportPolicy: (policyContext) => evaluateCrossSpaceBoundaryPolicy({
          globalFlags,
          sourceSpaceId: policyContext.sourceSpaceId,
          targetSpaceId: policyContext.targetSpaceId,
          artifactId: policyContext.artifactId,
          operation: "import",
          artifactType: policyContext.artifactType,
          title: policyContext.title,
          tags: policyContext.tags,
          isGeneratedBasic: policyContext.isGeneratedBasic,
        }),
      });

      service.linkSpaces("source-space", "target-space");
      const transfer = service.shareContext("source-space", "target-space", "artifact-note-allow");
      expect(transfer.artifactId).toBe("artifact-note-allow");

      const pulled = service.pullSharedContext("source-space", "target-space");
      expect(pulled.denied).toEqual([]);
      expect(pulled.importedArtifacts.length).toBe(1);

      const importedArtifacts = context.artifacts.listBySpace("target-space");
      expect(importedArtifacts.length).toBe(1);
      expect(importedArtifacts[0].artifact_type).toBe("note");
    } finally {
      context.db.close();
    }
  });
});
