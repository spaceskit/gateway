/**
 * Orchestrator command repository — command lifecycle persistence.
 */

import type { Database } from "bun:sqlite";

export type OrchestratorCommandStatus =
  | "accepted"
  | "running"
  | "completed"
  | "failed";

export interface OrchestratorCommandRow {
  command_id: string;
  correlation_id: string;
  api_version: string;
  command_type: string;
  target_space_id: string;
  target_agent_id: string;
  idempotency_key: string;
  payload_json: string;
  status: OrchestratorCommandStatus;
  result_json: string | null;
  error_code: string;
  error_message: string;
  created_at: string;
  updated_at: string;
}

export interface OrchestratorCommandEventRow {
  id: number;
  command_id: string;
  status: OrchestratorCommandStatus;
  event_json: string;
  created_at: string;
}

export interface CreateOrchestratorCommandInput {
  commandId: string;
  correlationId: string;
  apiVersion?: string;
  commandType: string;
  targetSpaceId: string;
  targetAgentId?: string;
  idempotencyKey: string;
  payloadJson: string;
  status?: OrchestratorCommandStatus;
}

export class OrchestratorCommandRepository {
  constructor(private db: Database) {}

  create(input: CreateOrchestratorCommandInput): OrchestratorCommandRow {
    const now = new Date().toISOString();
    this.db.query(`
      INSERT INTO orchestrator_commands(
        command_id, correlation_id, api_version, command_type,
        target_space_id, target_agent_id, idempotency_key, payload_json,
        status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.commandId,
      input.correlationId,
      input.apiVersion ?? "v1",
      input.commandType,
      input.targetSpaceId,
      input.targetAgentId ?? "",
      input.idempotencyKey,
      input.payloadJson,
      input.status ?? "accepted",
      now,
      now,
    );

    this.appendEvent(input.commandId, input.status ?? "accepted", {
      status: input.status ?? "accepted",
    });

    return this.getById(input.commandId)!;
  }

  getById(commandId: string): OrchestratorCommandRow | undefined {
    return this.db.query(`
      SELECT * FROM orchestrator_commands WHERE command_id = ?
    `).get(commandId) as OrchestratorCommandRow | undefined ?? undefined;
  }

  getByIdempotency(targetSpaceId: string, idempotencyKey: string): OrchestratorCommandRow | undefined {
    return this.db.query(`
      SELECT * FROM orchestrator_commands
      WHERE target_space_id = ? AND idempotency_key = ?
    `).get(targetSpaceId, idempotencyKey) as OrchestratorCommandRow | undefined ?? undefined;
  }

  setStatus(
    commandId: string,
    status: OrchestratorCommandStatus,
    resultJson?: string | null,
    errorCode?: string,
    errorMessage?: string,
  ): OrchestratorCommandRow | undefined {
    this.db.query(`
      UPDATE orchestrator_commands
      SET status = ?,
          result_json = ?,
          error_code = ?,
          error_message = ?,
          updated_at = ?
      WHERE command_id = ?
    `).run(
      status,
      resultJson ?? null,
      errorCode ?? "",
      errorMessage ?? "",
      new Date().toISOString(),
      commandId,
    );

    this.appendEvent(commandId, status, {
      status,
      errorCode: errorCode ?? "",
      errorMessage: errorMessage ?? "",
    });

    return this.getById(commandId);
  }

  appendEvent(commandId: string, status: OrchestratorCommandStatus, event: Record<string, unknown>): void {
    this.db.query(`
      INSERT INTO orchestrator_command_events(command_id, status, event_json, created_at)
      VALUES (?, ?, ?, ?)
    `).run(commandId, status, JSON.stringify(event), new Date().toISOString());
  }

  listEvents(commandId: string): OrchestratorCommandEventRow[] {
    return this.db.query(`
      SELECT * FROM orchestrator_command_events
      WHERE command_id = ?
      ORDER BY id ASC
    `).all(commandId) as OrchestratorCommandEventRow[];
  }
}

