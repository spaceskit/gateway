import { describe, expect, test } from "bun:test";
import {
  ArtifactRepository,
  SpaceRepository,
  initDatabase,
} from "@spaceskit/persistence";
import { SpaceArtifactService } from "../src/services/space-artifact-service.js";

describe("SpaceArtifactService", () => {
  test("lists and reads artifacts by space", () => {
    const db = initDatabase({
      path: ":memory:",
      runtimeGeneration: `test-artifacts-${crypto.randomUUID()}`,
    });
    try {
      const spaces = new SpaceRepository(db.db);
      spaces.create({
        spaceId: "space-main",
        resourceId: "resource-main",
        spaceType: "space",
        name: "Main",
        goal: "",
        turnModel: "sequential_all",
      });

      const artifacts = new ArtifactRepository(db.db);
      artifacts.create({
        artifactId: "artifact-1",
        spaceId: "space-main",
        resourceId: "resource-main",
        turnId: "turn-1",
        agentId: "agent-1",
        type: "summary",
        title: "Summary",
        mimeType: "text/plain",
        contentJson: JSON.stringify("hello"),
      });

      const service = new SpaceArtifactService({
        artifacts,
        spaces,
      });

      const listed = service.listArtifacts({
        spaceId: "space-main",
      });
      expect(listed.total).toBe(1);
      expect(listed.artifacts[0]?.artifactId).toBe("artifact-1");

      const detail = service.getArtifact({
        spaceId: "space-main",
        artifactId: "artifact-1",
      });
      expect(detail.artifactId).toBe("artifact-1");
    } finally {
      db.close();
    }
  });

  test("returns exact turn totals beyond capped page sizes", () => {
    const db = initDatabase({
      path: ":memory:",
      runtimeGeneration: `test-artifact-totals-${crypto.randomUUID()}`,
    });
    try {
      const spaces = new SpaceRepository(db.db);
      spaces.create({
        spaceId: "space-main",
        resourceId: "resource-main",
        spaceType: "space",
        name: "Main",
        goal: "",
        turnModel: "sequential_all",
      });

      const artifacts = new ArtifactRepository(db.db);
      for (let index = 0; index < 5105; index += 1) {
        artifacts.create({
          artifactId: `artifact-${index}`,
          spaceId: "space-main",
          resourceId: "resource-main",
          turnId: "turn-big",
          agentId: "agent-1",
          type: "summary",
          title: `Summary ${index}`,
          mimeType: "text/plain",
          contentJson: JSON.stringify(`payload-${index}`),
        });
      }

      const service = new SpaceArtifactService({
        artifacts,
        spaces,
      });

      const listed = service.listArtifacts({
        spaceId: "space-main",
        turnId: "turn-big",
        limit: 200,
        offset: 0,
      });

      expect(listed.artifacts.length).toBe(200);
      expect(listed.total).toBe(5105);
    } finally {
      db.close();
    }
  });
});
