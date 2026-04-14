import type { Database } from "bun:sqlite";

export interface GatewayRuntimeDefaultsRow {
  singleton_id: number;
  main_provider_id: string;
  main_model_id: string;
  concierge_provider_id: string;
  concierge_model_id: string;
  updated_at: string;
}

export interface SetGatewayRuntimeDefaultsInput {
  mainProviderId: string;
  mainModelId: string;
  conciergeProviderId: string;
  conciergeModelId: string;
}

export class GatewayRuntimeDefaultsRepository {
  constructor(private readonly db: Database) {
    this.ensureSchema();
  }

  get(): GatewayRuntimeDefaultsRow {
    const row = this.db
      .query("SELECT * FROM gateway_runtime_defaults WHERE singleton_id = 1")
      .get() as GatewayRuntimeDefaultsRow | null;
    if (row) {
      return row;
    }

    const now = new Date().toISOString();
    this.db.query(`
      INSERT INTO gateway_runtime_defaults(
        singleton_id,
        main_provider_id,
        main_model_id,
        concierge_provider_id,
        concierge_model_id,
        updated_at
      ) VALUES (1, '', '', '', '', ?)
      ON CONFLICT(singleton_id) DO NOTHING
    `).run(now);

    return this.db
      .query("SELECT * FROM gateway_runtime_defaults WHERE singleton_id = 1")
      .get() as GatewayRuntimeDefaultsRow;
  }

  set(input: SetGatewayRuntimeDefaultsInput): GatewayRuntimeDefaultsRow {
    const now = new Date().toISOString();
    this.db.query(`
      INSERT INTO gateway_runtime_defaults(
        singleton_id,
        main_provider_id,
        main_model_id,
        concierge_provider_id,
        concierge_model_id,
        updated_at
      ) VALUES (1, ?, ?, ?, ?, ?)
      ON CONFLICT(singleton_id) DO UPDATE SET
        main_provider_id = excluded.main_provider_id,
        main_model_id = excluded.main_model_id,
        concierge_provider_id = excluded.concierge_provider_id,
        concierge_model_id = excluded.concierge_model_id,
        updated_at = excluded.updated_at
    `).run(
      input.mainProviderId,
      input.mainModelId,
      input.conciergeProviderId,
      input.conciergeModelId,
      now,
    );

    return this.get();
  }

  private ensureSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS gateway_runtime_defaults (
        singleton_id INTEGER PRIMARY KEY CHECK(singleton_id = 1),
        main_provider_id TEXT NOT NULL DEFAULT '',
        main_model_id TEXT NOT NULL DEFAULT '',
        concierge_provider_id TEXT NOT NULL DEFAULT '',
        concierge_model_id TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL
      )
    `);
  }
}
