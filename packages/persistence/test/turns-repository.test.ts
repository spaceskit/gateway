import { afterEach, describe, expect, test } from "bun:test";
import { initDatabase } from "../src/database.js";
import { SpaceRepository } from "../src/repositories/spaces.js";
import { TurnRepository } from "../src/repositories/turns.js";

const dbManagers: ReturnType<typeof initDatabase>[] = [];

afterEach(() => {
  while (dbManagers.length > 0) {
    dbManagers.pop()?.close();
  }
});

function createRepos() {
  const db = initDatabase({
    path: ":memory:",
    runtimeGeneration: `test-turns-repository-${crypto.randomUUID()}`,
  });
  dbManagers.push(db);

  const spaces = new SpaceRepository(db.db);
  spaces.create({
    spaceId: "space-main",
    resourceId: "resource-main",
    spaceType: "space",
    name: "Main Space",
    goal: "",
    turnModel: "sequential_all",
  });

  return {
    db: db.db,
    turns: new TurnRepository(db.db),
  };
}

describe("TurnRepository", () => {
  test("lists and counts turns strictly after a cursor turn", () => {
    const repos = createRepos();

    repos.turns.create({
      turnId: "turn-1",
      spaceId: "space-main",
      actorType: "agent",
      actorId: "agent-main",
      inputJson: JSON.stringify({ text: "one" }),
    });
    repos.turns.create({
      turnId: "turn-2",
      spaceId: "space-main",
      actorType: "agent",
      actorId: "agent-main",
      inputJson: JSON.stringify({ text: "two" }),
    });
    repos.turns.create({
      turnId: "turn-3",
      spaceId: "space-main",
      actorType: "agent",
      actorId: "agent-main",
      inputJson: JSON.stringify({ text: "three" }),
    });

    repos.db.query("UPDATE turns SET created_at = ? WHERE turn_id = ?").run("2026-03-01T00:00:00.000Z", "turn-1");
    const sharedTimestamp = "2026-03-02T00:00:00.000Z";
    repos.db.query("UPDATE turns SET created_at = ? WHERE turn_id IN (?, ?)").run(sharedTimestamp, "turn-2", "turn-3");

    const rows = repos.turns.listBySpaceAfterTurn("space-main", "turn-2", 50);
    expect(rows.map((row) => row.turn_id)).toEqual(["turn-3"]);
    expect(repos.turns.countBySpaceAfterTurn("space-main", "turn-2")).toBe(1);
  });

  test("returns empty delta when cursor turn does not exist", () => {
    const repos = createRepos();
    repos.turns.create({
      turnId: "turn-1",
      spaceId: "space-main",
      actorType: "agent",
      actorId: "agent-main",
      inputJson: JSON.stringify({ text: "one" }),
    });

    expect(repos.turns.listBySpaceAfterTurn("space-main", "missing-turn", 20)).toEqual([]);
    expect(repos.turns.countBySpaceAfterTurn("space-main", "missing-turn")).toBe(0);
  });

  test("lists turns for one agent bounded by created_at session boundary", () => {
    const repos = createRepos();

    repos.turns.create({
      turnId: "turn-1",
      spaceId: "space-main",
      actorType: "agent",
      actorId: "agent-main",
      inputJson: JSON.stringify({ text: "one" }),
    });
    repos.turns.create({
      turnId: "turn-2",
      spaceId: "space-main",
      actorType: "agent",
      actorId: "agent-main",
      inputJson: JSON.stringify({ text: "two" }),
    });
    repos.turns.create({
      turnId: "turn-3",
      spaceId: "space-main",
      actorType: "agent",
      actorId: "agent-other",
      inputJson: JSON.stringify({ text: "other-agent" }),
    });

    repos.db.query("UPDATE turns SET created_at = ? WHERE turn_id = ?").run("2026-03-01T00:00:00.000Z", "turn-1");
    repos.db.query("UPDATE turns SET created_at = ? WHERE turn_id = ?").run("2026-03-02T00:00:00.000Z", "turn-2");
    repos.db.query("UPDATE turns SET created_at = ? WHERE turn_id = ?").run("2026-03-03T00:00:00.000Z", "turn-3");

    const rows = repos.turns.listBySpaceAndAgentSince(
      "space-main",
      "agent-main",
      "2026-03-02T00:00:00.000Z",
      50,
    );
    expect(rows.map((row) => row.turn_id)).toEqual(["turn-2"]);
  });
});
