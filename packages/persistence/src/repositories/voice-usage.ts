/**
 * Voice usage repository — stores per-session metering events for STT/TTS usage.
 */

import { randomUUID } from "node:crypto";
import type { Database } from "bun:sqlite";

export type VoiceUsageSource =
  | "managed"
  | "byok"
  | "local_model"
  | "apple_speech"
  | "unknown";

export interface CreateVoiceUsageEventInput {
  eventId?: string;
  sessionId: string;
  spaceId: string;
  source: VoiceUsageSource;
  providerId?: string;
  sttSeconds?: number;
  ttsChars?: number;
  ttsSeconds?: number;
  estimatedCostUsd?: number;
  metadataJson?: string;
  createdAt?: string;
}

export interface VoiceUsageAggregate {
  sttSeconds: number;
  ttsChars: number;
  ttsSeconds: number;
  estimatedCostUsd: number;
}

export interface VoiceUsageSourceAggregate extends VoiceUsageAggregate {
  source: VoiceUsageSource;
}

export class VoiceUsageRepository {
  constructor(private readonly db: Database) {}

  createEvent(input: CreateVoiceUsageEventInput): void {
    const eventId = input.eventId?.trim() || randomUUID();
    const sessionId = input.sessionId.trim();
    const spaceId = input.spaceId.trim();
    const source = input.source?.trim() || "unknown";
    const providerId = input.providerId?.trim() || "";
    const sttSeconds = sanitizeNumber(input.sttSeconds);
    const ttsChars = Math.max(0, Math.floor(input.ttsChars ?? 0));
    const ttsSeconds = sanitizeNumber(input.ttsSeconds);
    const estimatedCostUsd = sanitizeNumber(input.estimatedCostUsd);
    const metadataJson = input.metadataJson?.trim() || "{}";
    const createdAt = input.createdAt?.trim() || new Date().toISOString();

    this.db.query(`
      INSERT INTO voice_usage_events(
        event_id,
        session_id,
        space_id,
        source,
        provider_id,
        stt_seconds,
        tts_chars,
        tts_seconds,
        estimated_cost_usd,
        metadata_json,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      eventId,
      sessionId,
      spaceId,
      source,
      providerId,
      sttSeconds,
      ttsChars,
      ttsSeconds,
      estimatedCostUsd,
      metadataJson,
      createdAt,
    );
  }

  aggregate(sinceIso?: string): VoiceUsageAggregate {
    const row = sinceIso
      ? this.db.query(`
        SELECT
          COALESCE(SUM(stt_seconds), 0) AS stt_seconds,
          COALESCE(SUM(tts_chars), 0) AS tts_chars,
          COALESCE(SUM(tts_seconds), 0) AS tts_seconds,
          COALESCE(SUM(estimated_cost_usd), 0) AS estimated_cost_usd
        FROM voice_usage_events
        WHERE created_at >= ?
      `).get(sinceIso) as {
        stt_seconds: number;
        tts_chars: number;
        tts_seconds: number;
        estimated_cost_usd: number;
      }
      : this.db.query(`
        SELECT
          COALESCE(SUM(stt_seconds), 0) AS stt_seconds,
          COALESCE(SUM(tts_chars), 0) AS tts_chars,
          COALESCE(SUM(tts_seconds), 0) AS tts_seconds,
          COALESCE(SUM(estimated_cost_usd), 0) AS estimated_cost_usd
        FROM voice_usage_events
      `).get() as {
        stt_seconds: number;
        tts_chars: number;
        tts_seconds: number;
        estimated_cost_usd: number;
      };

    return {
      sttSeconds: sanitizeNumber(row.stt_seconds),
      ttsChars: Math.max(0, Math.floor(row.tts_chars ?? 0)),
      ttsSeconds: sanitizeNumber(row.tts_seconds),
      estimatedCostUsd: sanitizeNumber(row.estimated_cost_usd),
    };
  }

  aggregateBySource(sinceIso?: string): VoiceUsageSourceAggregate[] {
    const rows = sinceIso
      ? this.db.query(`
        SELECT
          source,
          COALESCE(SUM(stt_seconds), 0) AS stt_seconds,
          COALESCE(SUM(tts_chars), 0) AS tts_chars,
          COALESCE(SUM(tts_seconds), 0) AS tts_seconds,
          COALESCE(SUM(estimated_cost_usd), 0) AS estimated_cost_usd
        FROM voice_usage_events
        WHERE created_at >= ?
        GROUP BY source
        ORDER BY source ASC
      `).all(sinceIso) as Array<{
        source: string;
        stt_seconds: number;
        tts_chars: number;
        tts_seconds: number;
        estimated_cost_usd: number;
      }>
      : this.db.query(`
        SELECT
          source,
          COALESCE(SUM(stt_seconds), 0) AS stt_seconds,
          COALESCE(SUM(tts_chars), 0) AS tts_chars,
          COALESCE(SUM(tts_seconds), 0) AS tts_seconds,
          COALESCE(SUM(estimated_cost_usd), 0) AS estimated_cost_usd
        FROM voice_usage_events
        GROUP BY source
        ORDER BY source ASC
      `).all() as Array<{
        source: string;
        stt_seconds: number;
        tts_chars: number;
        tts_seconds: number;
        estimated_cost_usd: number;
      }>;

    return rows.map((row) => ({
      source: normalizeSource(row.source),
      sttSeconds: sanitizeNumber(row.stt_seconds),
      ttsChars: Math.max(0, Math.floor(row.tts_chars ?? 0)),
      ttsSeconds: sanitizeNumber(row.tts_seconds),
      estimatedCostUsd: sanitizeNumber(row.estimated_cost_usd),
    }));
  }
}

function sanitizeNumber(value: number | undefined): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, value ?? 0);
}

function normalizeSource(source: string): VoiceUsageSource {
  switch (source) {
    case "managed":
    case "byok":
    case "local_model":
    case "apple_speech":
      return source;
    default:
      return "unknown";
  }
}
