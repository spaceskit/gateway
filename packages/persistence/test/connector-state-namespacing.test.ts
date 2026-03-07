import { afterEach, describe, expect, test } from "bun:test";
import { initDatabase } from "../src/database.js";

const dbManagers: ReturnType<typeof initDatabase>[] = [];

afterEach(() => {
  while (dbManagers.length > 0) {
    dbManagers.pop()?.close();
  }
});

function createDatabase() {
  const db = initDatabase({
    path: ":memory:",
    runtimeGeneration: `test-provider-connection-states-${crypto.randomUUID()}`,
  });
  dbManagers.push(db);
  return db;
}

describe("Provider connection state table namespacing", () => {
  test("renames connector_states to provider_connection_states", () => {
    const db = createDatabase();

    const tableNames = db.db.query(
      "SELECT name FROM sqlite_master WHERE type = 'table'",
    ).all() as Array<{ name: string }>;

    expect(tableNames.some((row) => row.name === "provider_connection_states")).toBe(true);
    expect(tableNames.some((row) => row.name === "connector_states")).toBe(false);
  });

  test("applies provider connection index naming", () => {
    const db = createDatabase();

    const indexNames = db.db.query(
      "SELECT name FROM sqlite_master WHERE type = 'index'",
    ).all() as Array<{ name: string }>;

    expect(indexNames.some((row) => row.name === "idx_provider_connection_provider")).toBe(true);
    expect(indexNames.some((row) => row.name === "idx_connector_provider")).toBe(false);
  });
});
