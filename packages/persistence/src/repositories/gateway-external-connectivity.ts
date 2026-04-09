import type { Database } from "bun:sqlite";

export type GatewayExternalConnectivityModeRowValue = "DISABLED" | "TAILSCALE";

export interface GatewayExternalConnectivityRow {
  singleton_id: number;
  mode: GatewayExternalConnectivityModeRowValue;
  updated_at: string;
}

export interface SetGatewayExternalConnectivityInput {
  mode: GatewayExternalConnectivityModeRowValue;
}

export class GatewayExternalConnectivityRepository {
  constructor(private readonly db: Database) {}

  get(): GatewayExternalConnectivityRow {
    const row = this.db
      .query("SELECT * FROM gateway_external_connectivity WHERE singleton_id = 1")
      .get() as GatewayExternalConnectivityRow | null;
    if (row) {
      return row;
    }

    const now = new Date().toISOString();
    this.db.query(`
      INSERT INTO gateway_external_connectivity(
        singleton_id,
        mode,
        updated_at
      ) VALUES (1, 'DISABLED', ?)
      ON CONFLICT(singleton_id) DO NOTHING
    `).run(now);

    return this.db
      .query("SELECT * FROM gateway_external_connectivity WHERE singleton_id = 1")
      .get() as GatewayExternalConnectivityRow;
  }

  set(input: SetGatewayExternalConnectivityInput): GatewayExternalConnectivityRow {
    const mode = normalizeMode(input.mode);
    const now = new Date().toISOString();
    this.db.query(`
      INSERT INTO gateway_external_connectivity(
        singleton_id,
        mode,
        updated_at
      ) VALUES (1, ?, ?)
      ON CONFLICT(singleton_id) DO UPDATE SET
        mode = excluded.mode,
        updated_at = excluded.updated_at
    `).run(mode, now);
    return this.get();
  }
}

function normalizeMode(value: GatewayExternalConnectivityModeRowValue): GatewayExternalConnectivityModeRowValue {
  return value === "TAILSCALE" ? "TAILSCALE" : "DISABLED";
}
