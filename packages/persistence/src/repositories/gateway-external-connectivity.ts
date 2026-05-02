import type { Database } from "bun:sqlite";

export type GatewayExternalConnectivityModeRowValue = "DISABLED" | "TAILSCALE";

export interface GatewayExternalConnectivityRow {
  singleton_id: number;
  mode: GatewayExternalConnectivityModeRowValue;
  funnel_enabled: number | null;
  updated_at: string;
}

export interface SetGatewayExternalConnectivityInput {
  mode: GatewayExternalConnectivityModeRowValue;
  funnelEnabled?: boolean | null;
}

interface GatewayExternalConnectivityRowRaw {
  singleton_id: number;
  mode: GatewayExternalConnectivityModeRowValue;
  funnel_enabled?: number | null;
  updated_at: string;
}

export class GatewayExternalConnectivityRepository {
  constructor(private readonly db: Database) {}

  get(): GatewayExternalConnectivityRow {
    const row = this.db
      .query("SELECT * FROM gateway_external_connectivity WHERE singleton_id = 1")
      .get() as GatewayExternalConnectivityRowRaw | null;
    if (row) {
      return normalizeRow(row);
    }

    const now = new Date().toISOString();
    this.db.query(`
      INSERT INTO gateway_external_connectivity(
        singleton_id,
        mode,
        funnel_enabled,
        updated_at
      ) VALUES (1, 'DISABLED', NULL, ?)
      ON CONFLICT(singleton_id) DO NOTHING
    `).run(now);

    const inserted = this.db
      .query("SELECT * FROM gateway_external_connectivity WHERE singleton_id = 1")
      .get() as GatewayExternalConnectivityRowRaw;
    return normalizeRow(inserted);
  }

  set(input: SetGatewayExternalConnectivityInput): GatewayExternalConnectivityRow {
    const mode = normalizeMode(input.mode);
    const now = new Date().toISOString();

    if (input.funnelEnabled === undefined) {
      this.db.query(`
        INSERT INTO gateway_external_connectivity(
          singleton_id,
          mode,
          funnel_enabled,
          updated_at
        ) VALUES (1, ?, NULL, ?)
        ON CONFLICT(singleton_id) DO UPDATE SET
          mode = excluded.mode,
          updated_at = excluded.updated_at
      `).run(mode, now);
    } else {
      const funnelValue = input.funnelEnabled === null ? null : input.funnelEnabled ? 1 : 0;
      this.db.query(`
        INSERT INTO gateway_external_connectivity(
          singleton_id,
          mode,
          funnel_enabled,
          updated_at
        ) VALUES (1, ?, ?, ?)
        ON CONFLICT(singleton_id) DO UPDATE SET
          mode = excluded.mode,
          funnel_enabled = excluded.funnel_enabled,
          updated_at = excluded.updated_at
      `).run(mode, funnelValue, now);
    }
    return this.get();
  }
}

function normalizeRow(row: GatewayExternalConnectivityRowRaw): GatewayExternalConnectivityRow {
  return {
    singleton_id: row.singleton_id,
    mode: normalizeMode(row.mode),
    funnel_enabled: row.funnel_enabled ?? null,
    updated_at: row.updated_at,
  };
}

function normalizeMode(value: GatewayExternalConnectivityModeRowValue): GatewayExternalConnectivityModeRowValue {
  return value === "TAILSCALE" ? "TAILSCALE" : "DISABLED";
}
