/**
 * Usage analytics repository — aggregate persisted runtime-ledger usage.
 */

import type { Database } from "bun:sqlite";

export interface TokenAggregate {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  tokenAccuracy: "reported" | "estimated" | "mixed";
  usageSource: "ledger" | "local_scanner";
}

export interface ProviderTokenAggregate extends TokenAggregate {
  providerId: string;
}

export interface AgentTokenAggregate extends TokenAggregate {
  agentId: string;
  runCount: number;
  earliestActivityAt?: string;
  lastActivityAt?: string;
}

export class UsageAnalyticsRepository {
  constructor(private readonly db: Database) {}

  aggregateTokens(sinceIso?: string): TokenAggregate {
    const row = sinceIso
      ? this.db.query(`
        SELECT
          COALESCE(SUM(prompt_tokens), 0) AS input_tokens,
          COALESCE(SUM(completion_tokens), 0) AS output_tokens,
          COALESCE(SUM(total_tokens), 0) AS total_tokens,
          ${tokenAccuracySql("usage_records")}
        FROM usage_records
        WHERE created_at >= ?
      `).get(sinceIso) as AggregateRow
      : this.db.query(`
        SELECT
          COALESCE(SUM(prompt_tokens), 0) AS input_tokens,
          COALESCE(SUM(completion_tokens), 0) AS output_tokens,
          COALESCE(SUM(total_tokens), 0) AS total_tokens,
          ${tokenAccuracySql("usage_records")}
        FROM usage_records
      `).get() as AggregateRow;

    return mapAggregateRow(row);
  }

  aggregateByProvider(sinceIso?: string): ProviderTokenAggregate[] {
    const rows = sinceIso
      ? this.db.query(`
        SELECT
          CASE
            WHEN provider_id != '' THEN provider_id
            ELSE 'unknown'
          END AS provider_id,
          COALESCE(SUM(prompt_tokens), 0) AS input_tokens,
          COALESCE(SUM(completion_tokens), 0) AS output_tokens,
          COALESCE(SUM(total_tokens), 0) AS total_tokens,
          ${tokenAccuracySql("usage_records")}
        FROM usage_records
        WHERE created_at >= ?
        GROUP BY provider_id
        ORDER BY provider_id ASC
      `).all(sinceIso) as ProviderAggregateRow[]
      : this.db.query(`
        SELECT
          CASE
            WHEN provider_id != '' THEN provider_id
            ELSE 'unknown'
          END AS provider_id,
          COALESCE(SUM(prompt_tokens), 0) AS input_tokens,
          COALESCE(SUM(completion_tokens), 0) AS output_tokens,
          COALESCE(SUM(total_tokens), 0) AS total_tokens,
          ${tokenAccuracySql("usage_records")}
        FROM usage_records
        GROUP BY provider_id
        ORDER BY provider_id ASC
      `).all() as ProviderAggregateRow[];

    return rows.map((row) => ({
      providerId: row.provider_id,
      ...mapAggregateRow(row),
    }));
  }

  aggregateTokensBySpace(spaceId: string, sinceIso?: string): TokenAggregate {
    const row = sinceIso
      ? this.db.query(`
        SELECT
          COALESCE(SUM(prompt_tokens), 0) AS input_tokens,
          COALESCE(SUM(completion_tokens), 0) AS output_tokens,
          COALESCE(SUM(total_tokens), 0) AS total_tokens,
          ${tokenAccuracySql("usage_records")}
        FROM usage_records
        WHERE space_id = ?
          AND created_at >= ?
      `).get(spaceId, sinceIso) as AggregateRow
      : this.db.query(`
        SELECT
          COALESCE(SUM(prompt_tokens), 0) AS input_tokens,
          COALESCE(SUM(completion_tokens), 0) AS output_tokens,
          COALESCE(SUM(total_tokens), 0) AS total_tokens,
          ${tokenAccuracySql("usage_records")}
        FROM usage_records
        WHERE space_id = ?
      `).get(spaceId) as AggregateRow;

    return mapAggregateRow(row);
  }

  aggregateTokensBySpaceAndAgent(spaceId: string, agentId: string, sinceIso?: string): TokenAggregate {
    const row = sinceIso
      ? this.db.query(`
        SELECT
          COALESCE(SUM(ur.prompt_tokens), 0) AS input_tokens,
          COALESCE(SUM(ur.completion_tokens), 0) AS output_tokens,
          COALESCE(SUM(ur.total_tokens), 0) AS total_tokens,
          ${tokenAccuracySql("ur")}
        FROM usage_records ur
        INNER JOIN run_steps rs ON rs.step_id = ur.step_id
        WHERE ur.space_id = ?
          AND rs.agent_id = ?
          AND ur.created_at >= ?
      `).get(spaceId, agentId, sinceIso) as AggregateRow
      : this.db.query(`
        SELECT
          COALESCE(SUM(ur.prompt_tokens), 0) AS input_tokens,
          COALESCE(SUM(ur.completion_tokens), 0) AS output_tokens,
          COALESCE(SUM(ur.total_tokens), 0) AS total_tokens,
          ${tokenAccuracySql("ur")}
        FROM usage_records ur
        INNER JOIN run_steps rs ON rs.step_id = ur.step_id
        WHERE ur.space_id = ?
          AND rs.agent_id = ?
      `).get(spaceId, agentId) as AggregateRow;

    return mapAggregateRow(row);
  }

  aggregateAgentTokensBySpaceAndAgent(spaceId: string, agentId: string, sinceIso?: string): AgentTokenAggregate {
    const row = sinceIso
      ? this.db.query(`
        SELECT
          rs.agent_id AS agent_id,
          COALESCE(MIN(COALESCE(rs.started_at, rs.created_at)), '') AS earliest_activity_at,
          COALESCE(MAX(COALESCE(rs.completed_at, rs.started_at, rs.created_at)), '') AS last_activity_at,
          COUNT(DISTINCT rs.run_id) AS run_count,
          COALESCE(SUM(ur.prompt_tokens), 0) AS input_tokens,
          COALESCE(SUM(ur.completion_tokens), 0) AS output_tokens,
          COALESCE(SUM(ur.total_tokens), 0) AS total_tokens,
          ${tokenAccuracySql("ur")}
        FROM run_steps rs
        LEFT JOIN usage_records ur ON ur.step_id = rs.step_id
        WHERE rs.space_id = ?
          AND rs.agent_id = ?
          AND COALESCE(rs.completed_at, rs.started_at, rs.created_at) >= ?
      `).get(spaceId, agentId, sinceIso) as AgentAggregateRow
      : this.db.query(`
        SELECT
          rs.agent_id AS agent_id,
          COALESCE(MIN(COALESCE(rs.started_at, rs.created_at)), '') AS earliest_activity_at,
          COALESCE(MAX(COALESCE(rs.completed_at, rs.started_at, rs.created_at)), '') AS last_activity_at,
          COUNT(DISTINCT rs.run_id) AS run_count,
          COALESCE(SUM(ur.prompt_tokens), 0) AS input_tokens,
          COALESCE(SUM(ur.completion_tokens), 0) AS output_tokens,
          COALESCE(SUM(ur.total_tokens), 0) AS total_tokens,
          ${tokenAccuracySql("ur")}
        FROM run_steps rs
        LEFT JOIN usage_records ur ON ur.step_id = rs.step_id
        WHERE rs.space_id = ?
          AND rs.agent_id = ?
      `).get(spaceId, agentId) as AgentAggregateRow;

    return mapAgentAggregateRow(row, agentId);
  }

  listAgentAggregatesBySpace(spaceId: string): AgentTokenAggregate[] {
    const rows = this.db.query(`
      SELECT
        rs.agent_id AS agent_id,
        COALESCE(MIN(COALESCE(rs.started_at, rs.created_at)), '') AS earliest_activity_at,
        COALESCE(MAX(COALESCE(rs.completed_at, rs.started_at, rs.created_at)), '') AS last_activity_at,
        COUNT(DISTINCT rs.run_id) AS run_count,
        COALESCE(SUM(ur.prompt_tokens), 0) AS input_tokens,
        COALESCE(SUM(ur.completion_tokens), 0) AS output_tokens,
        COALESCE(SUM(ur.total_tokens), 0) AS total_tokens,
        ${tokenAccuracySql("ur")}
      FROM run_steps rs
      LEFT JOIN usage_records ur ON ur.step_id = rs.step_id
      WHERE rs.space_id = ?
        AND rs.agent_id != ''
      GROUP BY rs.agent_id
      ORDER BY last_activity_at DESC, rs.agent_id ASC
    `).all(spaceId) as AgentAggregateRow[];

    return rows.map((row) => mapAgentAggregateRow(row, row.agent_id));
  }
}

interface AggregateRow {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  token_accuracy: "reported" | "estimated" | "mixed";
}

interface ProviderAggregateRow extends AggregateRow {
  provider_id: string;
}

interface AgentAggregateRow extends AggregateRow {
  agent_id: string;
  run_count: number;
  earliest_activity_at: string;
  last_activity_at: string;
}

function mapAggregateRow(row: AggregateRow | null | undefined): TokenAggregate {
  const inputTokens = row?.input_tokens ?? 0;
  const outputTokens = row?.output_tokens ?? 0;
  const totalTokens = row?.total_tokens ?? (inputTokens + outputTokens);
  return {
    inputTokens,
    outputTokens,
    totalTokens,
    tokenAccuracy: row?.token_accuracy ?? "reported",
    usageSource: "ledger",
  };
}

function mapAgentAggregateRow(
  row: AgentAggregateRow | null | undefined,
  fallbackAgentId: string,
): AgentTokenAggregate {
  return {
    agentId: row?.agent_id || fallbackAgentId,
    runCount: row?.run_count ?? 0,
    earliestActivityAt: normalizeIso(row?.earliest_activity_at),
    lastActivityAt: normalizeIso(row?.last_activity_at),
    ...mapAggregateRow(row),
  };
}

function tokenAccuracySql(alias: string): string {
  return `
    CASE
      WHEN COUNT(${alias}.usage_record_id) = 0 THEN 'reported'
      WHEN SUM(CASE WHEN ${alias}.token_accuracy = 'estimated' THEN 1 ELSE 0 END) = COUNT(${alias}.usage_record_id) THEN 'estimated'
      WHEN SUM(CASE WHEN ${alias}.token_accuracy = 'reported' THEN 1 ELSE 0 END) = COUNT(${alias}.usage_record_id) THEN 'reported'
      ELSE 'mixed'
    END AS token_accuracy
  `;
}

function normalizeIso(value?: string): string | undefined {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : undefined;
}
