import type { Database } from "bun:sqlite";

export interface ProviderConfigRow {
  provider_id: string;
  model: string;
  base_url: string | null;
  allowed_models_json: string;
  allow_custom_model: number;
  native_cli_tools_enabled: number;
  api_key_secret_ref: string | null;
  source: string;
  created_at: string;
  updated_at: string;
}

export interface UpsertProviderConfigInput {
  providerId: string;
  model: string;
  baseUrl?: string;
  allowedModelsJson: string;
  allowCustomModel: boolean;
  nativeCliToolsEnabled: boolean;
  apiKeySecretRef?: string;
  source: string;
}

export class ProviderConfigRepository {
  constructor(private db: Database) {}

  upsert(input: UpsertProviderConfigInput): ProviderConfigRow {
    const now = new Date().toISOString();
    this.db.query(`
      INSERT INTO provider_configs (
        provider_id,
        model,
        base_url,
        allowed_models_json,
        allow_custom_model,
        native_cli_tools_enabled,
        api_key_secret_ref,
        source,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(provider_id) DO UPDATE SET
        model = excluded.model,
        base_url = excluded.base_url,
        allowed_models_json = excluded.allowed_models_json,
        allow_custom_model = excluded.allow_custom_model,
        native_cli_tools_enabled = excluded.native_cli_tools_enabled,
        api_key_secret_ref = excluded.api_key_secret_ref,
        source = excluded.source,
        updated_at = excluded.updated_at
    `).run(
      input.providerId,
      input.model,
      input.baseUrl ?? null,
      input.allowedModelsJson,
      input.allowCustomModel ? 1 : 0,
      input.nativeCliToolsEnabled ? 1 : 0,
      input.apiKeySecretRef ?? null,
      input.source,
      now,
      now,
    );

    const row = this.getById(input.providerId);
    if (!row) {
      throw new Error(`Failed to load provider config: ${input.providerId}`);
    }
    return row;
  }

  getById(providerId: string): ProviderConfigRow | null {
    return this.db.query(`
      SELECT *
      FROM provider_configs
      WHERE provider_id = ?
      LIMIT 1
    `).get(providerId) as ProviderConfigRow | null;
  }

  list(): ProviderConfigRow[] {
    return this.db.query(`
      SELECT *
      FROM provider_configs
      ORDER BY updated_at DESC, provider_id ASC
    `).all() as ProviderConfigRow[];
  }

  remove(providerId: string): boolean {
    return this.db.query(`
      DELETE FROM provider_configs
      WHERE provider_id = ?
    `).run(providerId).changes > 0;
  }

  removeAll(): number {
    return this.db.query(`DELETE FROM provider_configs`).run().changes;
  }
}
