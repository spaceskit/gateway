import type { Database } from "bun:sqlite";
import type { SpaceManager } from "@spaceskit/core";
import type { Logger } from "@spaceskit/observability";
import { seedStatements } from "@spaceskit/persistence";
import type {
  GatewayFactoryResetPayload,
  GatewayFactoryResetResponsePayload,
  SpaceResetPayload,
  SpaceResetResponsePayload,
} from "@spaceskit/server";

const PRESERVED_TABLES = new Set([
  "schema_version",
  "runtime_generation",
  "gateway_runtime_metadata",
  "connector_families",
]);

const SPACE_RESET_EXCLUDED_TABLES = new Set([
  "spaces",
]);

type SQLiteTableType = "table" | "virtual" | "view" | "shadow";

interface SQLiteTableListRow {
  name?: string;
  type?: SQLiteTableType | string;
}

interface GatewayProviderConfigAdminService {
  listProviderConfigs: () => Array<{ providerId: string }>;
  removeProviderConfig: (providerId: string) => void;
}

export interface GatewayResetServiceOptions {
  db: Database;
  logger: Logger;
  spaceManager: SpaceManager;
  gatewayAdminService: GatewayProviderConfigAdminService;
  getGatewayId: () => string;
  getGatewayUuid?: () => string | undefined;
}

export class GatewayResetService {
  private readonly db: Database;
  private readonly logger: Logger;
  private readonly spaceManager: SpaceManager;
  private readonly gatewayAdminService: GatewayProviderConfigAdminService;
  private readonly getGatewayId: () => string;
  private readonly getGatewayUuid?: () => string | undefined;

  constructor(options: GatewayResetServiceOptions) {
    this.db = options.db;
    this.logger = options.logger;
    this.spaceManager = options.spaceManager;
    this.gatewayAdminService = options.gatewayAdminService;
    this.getGatewayId = options.getGatewayId;
    this.getGatewayUuid = options.getGatewayUuid;
  }

  async factoryResetGateway(
    input: GatewayFactoryResetPayload & { requestedBy: string; requestedDeviceId?: string },
  ): Promise<GatewayFactoryResetResponsePayload> {
    const gatewayId = this.getGatewayId().trim();
    if (!gatewayId) {
      throw { code: "FAILED_PRECONDITION", message: "Gateway ID unavailable for reset confirmation" };
    }

    const requiredConfirmation = `DELETE ${gatewayId}`;
    if (input.confirmation !== requiredConfirmation) {
      throw {
        code: "INVALID_ARGUMENT",
        message: `confirmation must exactly match "${requiredConfirmation}"`,
      };
    }

    this.spaceManager.deactivateAll();

    const providerConfigs = this.gatewayAdminService.listProviderConfigs();
    for (const config of providerConfigs) {
      const providerId = config.providerId.trim();
      if (!providerId) continue;
      try {
        this.gatewayAdminService.removeProviderConfig(providerId);
      } catch (error) {
        this.logger.warn("Gateway factory reset failed to remove provider config", {
          providerId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const resettableTables = this.listResettableTables();
    const rowsDeleted = this.deleteRowsAndReseed(resettableTables);
    const resetAt = new Date().toISOString();
    const gatewayUuid = this.getGatewayUuid?.()?.trim();

    this.logger.warn("Gateway factory reset complete", {
      gatewayId,
      gatewayUuid: gatewayUuid || undefined,
      requestedBy: input.requestedBy,
      requestedDeviceId: input.requestedDeviceId,
      tablesCleared: resettableTables.length,
      rowsDeleted,
      resetAt,
    });

    return {
      gatewayId,
      gatewayUuid: gatewayUuid || undefined,
      resetAt,
      tablesCleared: resettableTables.length,
      rowsDeleted,
    };
  }

  async resetSpace(
    input: SpaceResetPayload & { requestedBy: string; requestedDeviceId?: string },
  ): Promise<SpaceResetResponsePayload> {
    const spaceId = input.spaceId.trim();
    if (!spaceId) {
      throw { code: "INVALID_ARGUMENT", message: "spaceId is required" };
    }

    this.spaceManager.deactivate(spaceId);

    const scopedTables = this.listSpaceScopedTables();
    const rowsDeleted = this.deleteRowsBySpaceId(spaceId, scopedTables);
    const resetAt = new Date().toISOString();

    this.logger.warn("Space reset complete", {
      spaceId,
      requestedBy: input.requestedBy,
      requestedDeviceId: input.requestedDeviceId,
      tablesCleared: scopedTables.length,
      rowsDeleted,
      resetAt,
    });

    return {
      spaceId,
      resetAt,
      tablesCleared: scopedTables.length,
      rowsDeleted,
    };
  }

  private listResettableTables(): string[] {
    const pragmaRows = this.listTablesFromPragma();
    if (pragmaRows) {
      return pragmaRows
        .filter((row) => row.type === "table" || row.type === "virtual")
        .map((row) => (typeof row.name === "string" ? row.name.trim() : ""))
        .filter((name) => name.length > 0)
        .filter((name) => !name.startsWith("sqlite_"))
        .filter((name) => !PRESERVED_TABLES.has(name))
        .sort((a, b) => a.localeCompare(b));
    }

    // Fallback for older SQLite variants where PRAGMA table_list is unavailable.
    // Exclude FTS shadow tables by removing "<virtual_table>_*" names.
    const rows = this.db.query(
      `SELECT name
       FROM sqlite_master
       WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
       ORDER BY name`,
    ).all() as Array<{ name?: string }>;
    const virtualTableNames = this.listVirtualTableNames();

    return rows
      .map((row) => (typeof row.name === "string" ? row.name.trim() : ""))
      .filter((name) => name.length > 0)
      .filter((name) => !PRESERVED_TABLES.has(name))
      .filter((name) => !isVirtualShadowTable(name, virtualTableNames));
  }

  private listSpaceScopedTables(): Array<{ tableName: string; columns: string[] }> {
    const scopedColumnNames = new Set([
      "space_id",
      "source_space_id",
      "target_space_id",
      "primary_space_id",
    ]);

    const candidateTables = this.listResettableTables()
      .filter((tableName) => !SPACE_RESET_EXCLUDED_TABLES.has(tableName));
    const matches: Array<{ tableName: string; columns: string[] }> = [];

    for (const tableName of candidateTables) {
      const columns = this.listTableColumns(tableName);
      const scopedColumns = columns.filter((column) => scopedColumnNames.has(column));
      if (scopedColumns.length > 0) {
        matches.push({ tableName, columns: scopedColumns });
      }
    }

    return matches;
  }

  private listTableColumns(tableName: string): string[] {
    const rows = this.db
      .query(`PRAGMA table_info(${quoteIdentifier(tableName)})`)
      .all() as Array<{ name?: string }>;

    return rows
      .map((row) => (typeof row.name === "string" ? row.name.trim() : ""))
      .filter((name) => name.length > 0);
  }

  private deleteRowsBySpaceId(
    spaceId: string,
    scopedTables: Array<{ tableName: string; columns: string[] }>,
  ): number {
    let rowsDeleted = 0;

    this.db.exec("PRAGMA foreign_keys = OFF");
    try {
      this.db.transaction(() => {
        for (const plan of scopedTables) {
          const quotedTable = quoteIdentifier(plan.tableName);
          const whereClauses = plan.columns.map((column) => `${quoteIdentifier(column)} = ?`);
          const whereClause = whereClauses.join(" OR ");
          if (!whereClause) {
            continue;
          }

          const params = plan.columns.map(() => spaceId);
          const countQuery = this.db.query(
            `SELECT COUNT(*) AS count FROM ${quotedTable} WHERE ${whereClause}`,
          ).get(...params) as { count?: number } | null;
          const tableRowsDeleted = Number(countQuery?.count ?? 0);
          rowsDeleted += tableRowsDeleted;

          if (tableRowsDeleted > 0) {
            this.db.query(`DELETE FROM ${quotedTable} WHERE ${whereClause}`).run(...params);
          }
        }
      })();
    } finally {
      this.db.exec("PRAGMA foreign_keys = ON");
    }

    return rowsDeleted;
  }

  private listTablesFromPragma(): SQLiteTableListRow[] | null {
    try {
      const rows = this.db.query("PRAGMA table_list").all() as SQLiteTableListRow[];
      return Array.isArray(rows) ? rows : null;
    } catch {
      return null;
    }
  }

  private listVirtualTableNames(): string[] {
    const rows = this.db.query(
      `SELECT name
       FROM sqlite_master
       WHERE type = 'table'
         AND sql IS NOT NULL
         AND UPPER(sql) LIKE 'CREATE VIRTUAL TABLE%'`,
    ).all() as Array<{ name?: string }>;

    return rows
      .map((row) => (typeof row.name === "string" ? row.name.trim() : ""))
      .filter((name) => name.length > 0);
  }

  private deleteRowsAndReseed(tableNames: string[]): number {
    let rowsDeleted = 0;

    this.db.exec("PRAGMA foreign_keys = OFF");
    try {
      this.db.transaction(() => {
        for (const tableName of tableNames) {
          const quotedTable = quoteIdentifier(tableName);
          const countRow = this.db
            .query(`SELECT COUNT(*) AS count FROM ${quotedTable}`)
            .get() as { count?: number } | null;
          const rowCount = Number(countRow?.count ?? 0);
          rowsDeleted += Number.isFinite(rowCount) ? Math.max(0, Math.trunc(rowCount)) : 0;
          this.db.exec(`DELETE FROM ${quotedTable}`);
        }

        for (const statement of seedStatements) {
          this.db.exec(statement);
        }
      })();
    } finally {
      this.db.exec("PRAGMA foreign_keys = ON");
    }

    return rowsDeleted;
  }
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll(`"`, `""`)}"`;
}

function isVirtualShadowTable(tableName: string, virtualTableNames: string[]): boolean {
  return virtualTableNames.some((virtualTableName) => tableName.startsWith(`${virtualTableName}_`));
}
