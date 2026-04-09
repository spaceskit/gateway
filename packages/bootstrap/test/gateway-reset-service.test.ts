import { describe, expect, test } from "bun:test";
import type { SpaceManager } from "@spaceskit/core";
import { Logger } from "@spaceskit/observability";
import { initDatabase } from "@spaceskit/persistence";
import { GatewayResetService } from "../src/services/gateway-reset-service.js";

function createContext() {
  const db = initDatabase({
    path: ":memory:",
    runtimeGeneration: `test-gateway-reset-${crypto.randomUUID()}`,
  });

  let deactivateAllCalls = 0;
  const deactivateCalls: string[] = [];
  const removedProviderIds: string[] = [];

  const service = new GatewayResetService({
    db: db.db,
    logger: new Logger({ minLevel: "error", module: "gateway-reset-test" }),
    spaceManager: {
      deactivateAll: () => {
        deactivateAllCalls += 1;
      },
      deactivate: (spaceId: string) => {
        deactivateCalls.push(spaceId);
      },
    } as unknown as SpaceManager,
    gatewayAdminService: {
      listProviderConfigs: () => [
        { providerId: "openai" },
        { providerId: "anthropic" },
      ],
      removeProviderConfig: (providerId: string) => {
        removedProviderIds.push(providerId);
      },
    },
    getGatewayId: () => "resource:main",
    getGatewayUuid: () => "11111111-2222-3333-4444-555555555555",
  });

  return {
    db,
    service,
    getDeactivateAllCalls: () => deactivateAllCalls,
    getDeactivateCalls: () => [...deactivateCalls],
    getRemovedProviderIds: () => [...removedProviderIds].sort(),
  };
}

function insertResettableRows(db: ReturnType<typeof initDatabase>["db"]): void {
  db.exec(
    `INSERT INTO spaces(
      space_id, resource_id, space_type, name, goal, status, turn_model,
      space_config_json, template_id, template_revision, created_at, updated_at
    ) VALUES (
      'space-reset-test', 'resource:main', 'room', 'Reset Test', 'goal', 'active', 'sequential_all',
      '{}', '', 0, datetime('now'), datetime('now')
    )`,
  );

  db.exec(
    `INSERT INTO knowledge_base_entries(
      entry_id, name, kind, uri, description, tags_json,
      scope_type, space_id, created_at, updated_at
    ) VALUES (
      'kb-reset-test', 'Reset Doc', 'web', 'https://example.com', 'desc', '[]',
      'global', NULL, datetime('now'), datetime('now')
    )`,
  );
}

function insertSpaceDefinitionRow(
  db: ReturnType<typeof initDatabase>["db"],
  spaceId: string,
): void {
  db.query(
    `INSERT INTO spaces(
      space_id, resource_id, space_type, name, goal, status, turn_model,
      space_config_json, template_id, template_revision, created_at, updated_at
    ) VALUES (
      ?, 'resource:main', 'room', ?, 'goal', 'active', 'sequential_all',
      '{}', '', 0, datetime('now'), datetime('now')
    )`,
  ).run(spaceId, `Space ${spaceId}`);
}

describe("GatewayResetService", () => {
  test("wipes resettable tables and provider configs", async () => {
    const ctx = createContext();
    try {
      insertResettableRows(ctx.db.db);

      const beforeSpaces = ctx.db.db.query("SELECT COUNT(*) AS count FROM spaces")
        .get() as { count: number };
      const beforeKb = ctx.db.db.query("SELECT COUNT(*) AS count FROM knowledge_base_entries")
        .get() as { count: number };
      expect(beforeSpaces.count).toBeGreaterThan(0);
      expect(beforeKb.count).toBeGreaterThan(0);

      const result = await ctx.service.factoryResetGateway({
        confirmation: "DELETE resource:main",
        requestedBy: "principal-test",
      });

      const afterSpaces = ctx.db.db.query("SELECT COUNT(*) AS count FROM spaces")
        .get() as { count: number };
      const afterKb = ctx.db.db.query("SELECT COUNT(*) AS count FROM knowledge_base_entries")
        .get() as { count: number };

      expect(afterSpaces.count).toBe(0);
      expect(afterKb.count).toBe(0);
      expect(ctx.getDeactivateAllCalls()).toBe(1);
      expect(ctx.getRemovedProviderIds()).toEqual(["anthropic", "openai"]);

      expect(result.gatewayId).toBe("resource:main");
      expect(result.gatewayUuid).toBe("11111111-2222-3333-4444-555555555555");
      expect(result.tablesCleared).toBeGreaterThan(0);
      expect(result.rowsDeleted).toBeGreaterThanOrEqual(2);
    } finally {
      ctx.db.close();
    }
  });

  test("preserves protected tables", async () => {
    const ctx = createContext();
    try {
      ctx.db.db.exec(
        `CREATE TABLE IF NOT EXISTS gateway_runtime_metadata (
          singleton_id INTEGER PRIMARY KEY,
          gateway_uuid TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )`,
      );
      ctx.db.db.exec(
        `INSERT INTO gateway_runtime_metadata(singleton_id, gateway_uuid, updated_at)
         VALUES (1, 'preserved-gateway-uuid', datetime('now'))
         ON CONFLICT(singleton_id)
         DO UPDATE SET gateway_uuid = excluded.gateway_uuid, updated_at = excluded.updated_at`,
      );

      ctx.db.db.exec(
        `INSERT OR IGNORE INTO connector_families(
          family_id, display_name, kind, runtime, trust_class, embedded_enabled,
          capability_types_json, features_json, created_at, updated_at
        ) VALUES (
          'family-preserved', 'Preserved Family', 'capability', 'adapter', 'embedded_safe', 1,
          '[]', '{}', datetime('now'), datetime('now')
        )`,
      );

      const beforeSchemaVersion = ctx.db.db.query("SELECT COUNT(*) AS count FROM schema_version")
        .get() as { count: number };
      const beforeRuntimeGeneration = ctx.db.db.query("SELECT COUNT(*) AS count FROM runtime_generation")
        .get() as { count: number };
      const beforeRuntimeMetadata = ctx.db.db.query(
        "SELECT gateway_uuid FROM gateway_runtime_metadata WHERE singleton_id = 1",
      ).get() as { gateway_uuid: string } | null;
      const beforeConnectorFamilyCount = ctx.db.db.query(
        "SELECT COUNT(*) AS count FROM connector_families WHERE family_id = 'family-preserved'",
      ).get() as { count: number };

      await ctx.service.factoryResetGateway({
        confirmation: "DELETE resource:main",
        requestedBy: "principal-test",
      });

      const afterSchemaVersion = ctx.db.db.query("SELECT COUNT(*) AS count FROM schema_version")
        .get() as { count: number };
      const afterRuntimeGeneration = ctx.db.db.query("SELECT COUNT(*) AS count FROM runtime_generation")
        .get() as { count: number };
      const afterRuntimeMetadata = ctx.db.db.query(
        "SELECT gateway_uuid FROM gateway_runtime_metadata WHERE singleton_id = 1",
      ).get() as { gateway_uuid: string } | null;
      const afterConnectorFamilyCount = ctx.db.db.query(
        "SELECT COUNT(*) AS count FROM connector_families WHERE family_id = 'family-preserved'",
      ).get() as { count: number };

      expect(afterSchemaVersion.count).toBe(beforeSchemaVersion.count);
      expect(afterRuntimeGeneration.count).toBe(beforeRuntimeGeneration.count);
      expect(afterRuntimeMetadata?.gateway_uuid).toBe(beforeRuntimeMetadata?.gateway_uuid);
      expect(afterConnectorFamilyCount.count).toBe(beforeConnectorFamilyCount.count);
    } finally {
      ctx.db.close();
    }
  });

  test("re-seeds singleton defaults", async () => {
    const ctx = createContext();
    try {
      ctx.db.db.exec(
        `UPDATE entitlement_state
         SET tier = 'ENTERPRISE', updated_at = datetime('now')
         WHERE singleton_id = 1`,
      );
      ctx.db.db.exec(
        `UPDATE usage_budget_policy
         SET soft_cap_usd = 999, hard_cap_usd = 1999, updated_at = datetime('now')
         WHERE singleton_id = 1`,
      );
      ctx.db.db.exec("DELETE FROM user_preferences WHERE singleton_id = 1");

      await ctx.service.factoryResetGateway({
        confirmation: "DELETE resource:main",
        requestedBy: "principal-test",
      });

      const entitlement = ctx.db.db.query(
        "SELECT tier FROM entitlement_state WHERE singleton_id = 1",
      ).get() as { tier: string } | null;
      const budget = ctx.db.db.query(
        "SELECT soft_cap_usd, hard_cap_usd FROM usage_budget_policy WHERE singleton_id = 1",
      ).get() as { soft_cap_usd: number; hard_cap_usd: number } | null;
      const preferences = ctx.db.db.query(
        "SELECT COUNT(*) AS count FROM user_preferences WHERE singleton_id = 1",
      ).get() as { count: number };
      const defaultPersona = ctx.db.db.query(
        "SELECT persona_id, is_default, archived FROM personas WHERE persona_id = 'persona-default'",
      ).get() as {
        persona_id: string;
        is_default: number;
        archived: number;
      } | null;
      const defaultPersonaRevisionCount = ctx.db.db.query(
        "SELECT COUNT(*) AS count FROM persona_revisions WHERE persona_id = 'persona-default'",
      ).get() as { count: number };

      expect(entitlement?.tier).toBe("FREE");
      expect(budget?.soft_cap_usd).toBe(20);
      expect(budget?.hard_cap_usd).toBe(50);
      expect(preferences.count).toBe(1);
      expect(defaultPersona?.persona_id).toBe("persona-default");
      expect(defaultPersona?.is_default).toBe(1);
      expect(defaultPersona?.archived).toBe(0);
      expect(defaultPersonaRevisionCount.count).toBe(1);
    } finally {
      ctx.db.close();
    }
  });

  test("rejects invalid confirmation phrase", async () => {
    const ctx = createContext();
    try {
      insertResettableRows(ctx.db.db);

      const beforeSpaces = ctx.db.db.query("SELECT COUNT(*) AS count FROM spaces")
        .get() as { count: number };

      await expect(
        ctx.service.factoryResetGateway({
          confirmation: "DELETE wrong-gateway-id",
          requestedBy: "principal-test",
        }),
      ).rejects.toMatchObject({
        code: "INVALID_ARGUMENT",
      });

      const afterSpaces = ctx.db.db.query("SELECT COUNT(*) AS count FROM spaces")
        .get() as { count: number };
      expect(afterSpaces.count).toBe(beforeSpaces.count);
    } finally {
      ctx.db.close();
    }
  });

  test("resets successfully when FTS virtual tables exist", async () => {
    const ctx = createContext();
    try {
      ctx.db.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
          id,
          content,
          tags
        )
      `);
      ctx.db.db.exec(`INSERT INTO memory_fts(id, content, tags) VALUES ('m1', 'hello world', 'test')`);

      const beforeCount = ctx.db.db.query("SELECT COUNT(*) AS count FROM memory_fts")
        .get() as { count: number };
      expect(beforeCount.count).toBe(1);

      await expect(
        ctx.service.factoryResetGateway({
          confirmation: "DELETE resource:main",
          requestedBy: "principal-test",
        }),
      ).resolves.toBeDefined();

      const afterCount = ctx.db.db.query("SELECT COUNT(*) AS count FROM memory_fts")
        .get() as { count: number };
      expect(afterCount.count).toBe(0);
    } finally {
      ctx.db.close();
    }
  });

  test("space reset clears scoped rows but preserves the spaces definition row", async () => {
    const ctx = createContext();
    try {
      insertSpaceDefinitionRow(ctx.db.db, "space-reset-target");
      insertSpaceDefinitionRow(ctx.db.db, "space-keep");

      ctx.db.db.exec(
        `CREATE TABLE IF NOT EXISTS space_reset_probe (
          probe_id TEXT PRIMARY KEY,
          space_id TEXT,
          source_space_id TEXT,
          payload TEXT
        )`,
      );
      ctx.db.db.exec(
        `INSERT INTO space_reset_probe(probe_id, space_id, source_space_id, payload)
         VALUES
          ('probe-target-space-id', 'space-reset-target', NULL, 'delete'),
          ('probe-target-source-space-id', NULL, 'space-reset-target', 'delete'),
          ('probe-keep', 'space-keep', NULL, 'keep')`,
      );

      const result = await ctx.service.resetSpace({
        spaceId: "space-reset-target",
        requestedBy: "principal-test",
      });

      const targetSpaceRows = ctx.db.db.query(
        "SELECT COUNT(*) AS count FROM spaces WHERE space_id = 'space-reset-target'",
      ).get() as { count: number };
      const untouchedSpaceRows = ctx.db.db.query(
        "SELECT COUNT(*) AS count FROM spaces WHERE space_id = 'space-keep'",
      ).get() as { count: number };
      const remainingTargetProbeRows = ctx.db.db.query(
        `SELECT COUNT(*) AS count
         FROM space_reset_probe
         WHERE space_id = 'space-reset-target' OR source_space_id = 'space-reset-target'`,
      ).get() as { count: number };
      const remainingKeepProbeRows = ctx.db.db.query(
        "SELECT COUNT(*) AS count FROM space_reset_probe WHERE space_id = 'space-keep'",
      ).get() as { count: number };

      expect(result.spaceId).toBe("space-reset-target");
      expect(result.tablesCleared).toBeGreaterThan(0);
      expect(result.rowsDeleted).toBeGreaterThanOrEqual(2);
      expect(targetSpaceRows.count).toBe(1);
      expect(untouchedSpaceRows.count).toBe(1);
      expect(remainingTargetProbeRows.count).toBe(0);
      expect(remainingKeepProbeRows.count).toBe(1);
      expect(ctx.getDeactivateCalls()).toEqual(["space-reset-target"]);
      expect(ctx.getDeactivateAllCalls()).toBe(0);
    } finally {
      ctx.db.close();
    }
  });

  test("space reset rejects blank space identifiers", async () => {
    const ctx = createContext();
    try {
      await expect(
        ctx.service.resetSpace({
          spaceId: "   ",
          requestedBy: "principal-test",
        }),
      ).rejects.toMatchObject({
        code: "INVALID_ARGUMENT",
      });
      expect(ctx.getDeactivateCalls()).toEqual([]);
    } finally {
      ctx.db.close();
    }
  });
});
