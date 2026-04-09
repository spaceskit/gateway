import type { Database } from "bun:sqlite";
import type { VoiceUsageChannel, VoiceUsageSource } from "./voice-usage.js";

export interface VoiceProviderConfigRow {
  provider_id: string;
  channel: VoiceUsageChannel;
  source: VoiceUsageSource;
  priority: number;
  health_status: string;
  cost_profile_json: string;
  secret_ref: string | null;
  metadata_json: string;
  created_at: string;
  updated_at: string;
}

export interface UpsertVoiceProviderConfigInput {
  providerId: string;
  channel: Exclude<VoiceUsageChannel, "session" | "unknown">;
  source: Exclude<VoiceUsageSource, "unknown">;
  priority?: number;
  healthStatus?: string;
  costProfileJson?: string;
  secretRef?: string;
  metadataJson?: string;
}

export class VoiceProviderConfigRepository {
  constructor(private readonly db: Database) {}

  upsert(input: UpsertVoiceProviderConfigInput): VoiceProviderConfigRow {
    const now = new Date().toISOString();
    const providerId = input.providerId.trim();
    if (!providerId) {
      throw new Error("providerId must be a non-empty string");
    }

    this.db.query(`
      INSERT INTO voice_provider_configs (
        provider_id,
        channel,
        source,
        priority,
        health_status,
        cost_profile_json,
        secret_ref,
        metadata_json,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(provider_id, channel) DO UPDATE SET
        source = excluded.source,
        priority = excluded.priority,
        health_status = excluded.health_status,
        cost_profile_json = excluded.cost_profile_json,
        secret_ref = excluded.secret_ref,
        metadata_json = excluded.metadata_json,
        updated_at = excluded.updated_at
    `).run(
      providerId,
      input.channel,
      input.source,
      Number.isFinite(input.priority) ? Math.floor(input.priority as number) : 100,
      input.healthStatus?.trim() || "unknown",
      normalizeJson(input.costProfileJson, "{}"),
      input.secretRef?.trim() || null,
      normalizeJson(input.metadataJson, "{}"),
      now,
      now,
    );

    const row = this.get(providerId, input.channel);
    if (!row) {
      throw new Error(`Failed to load voice provider config: ${providerId}/${input.channel}`);
    }
    return row;
  }

  get(
    providerId: string,
    channel: Exclude<VoiceUsageChannel, "session" | "unknown">,
  ): VoiceProviderConfigRow | null {
    return this.db.query(`
      SELECT *
      FROM voice_provider_configs
      WHERE provider_id = ? AND channel = ?
      LIMIT 1
    `).get(providerId, channel) as VoiceProviderConfigRow | null;
  }

  list(channel?: Exclude<VoiceUsageChannel, "session" | "unknown">): VoiceProviderConfigRow[] {
    if (channel) {
      return this.db.query(`
        SELECT *
        FROM voice_provider_configs
        WHERE channel = ?
        ORDER BY priority ASC, updated_at DESC, provider_id ASC
      `).all(channel) as VoiceProviderConfigRow[];
    }

    return this.db.query(`
      SELECT *
      FROM voice_provider_configs
      ORDER BY channel ASC, priority ASC, updated_at DESC, provider_id ASC
    `).all() as VoiceProviderConfigRow[];
  }
}

function normalizeJson(value: string | undefined, fallback: string): string {
  const normalized = value?.trim();
  if (!normalized) return fallback;
  try {
    JSON.parse(normalized);
    return normalized;
  } catch {
    return fallback;
  }
}
