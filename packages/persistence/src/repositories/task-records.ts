/**
 * Task records repository — manages orchestrated multi-agent task lifecycle.
 *
 * A TaskRecord represents a user-initiated orchestration request:
 * "Research X with 2 advanced agents" → creates space, deploys agents,
 * executes turns, monitors completion.
 */

import type { Database } from "bun:sqlite";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TaskState =
  | "pending"
  | "deploying"
  | "running"
  | "synthesizing"
  | "input_required"
  | "completed"
  | "failed";

export interface TaskRecordRow {
  task_id: string;
  space_id: string;
  requested_by: string;
  task_description: string;
  agent_tier: string;
  agent_count: number;
  topology: string;
  template_id: string;
  state: TaskState;
  progress_json: string;
  artifact_ids_json: string;
  max_turns: number;
  created_at: string;
  completed_at: string | null;
  error_message: string;
}

export interface TaskProgress {
  turnsCompleted: number;
  turnsTotal: number;
  currentPhase: string;
  rootTurnId?: string;
  latestMessage?: string;
  finalSummaryText?: string;
}

export interface CreateTaskRecordInput {
  taskId: string;
  spaceId: string;
  requestedBy: string;
  taskDescription: string;
  agentTier: string;
  agentCount: number;
  topology: string;
  templateId: string;
  maxTurns?: number;
}

export interface UpdateTaskRecordInput {
  taskId: string;
  state?: TaskState;
  spaceId?: string;
  progress?: TaskProgress;
  artifactIds?: string[];
  errorMessage?: string;
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

export class TaskRecordRepository {
  constructor(private db: Database) {}

  create(input: CreateTaskRecordInput): TaskRecordRow {
    const now = new Date().toISOString();
    const progress: TaskProgress = { turnsCompleted: 0, turnsTotal: input.maxTurns ?? 20, currentPhase: "pending" };

    this.db.query(`
      INSERT INTO task_records(
        task_id, space_id, requested_by, task_description,
        agent_tier, agent_count, topology, template_id,
        state, progress_json, artifact_ids_json, max_turns,
        created_at, completed_at, error_message
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, '[]', ?, ?, NULL, '')
    `).run(
      input.taskId,
      input.spaceId,
      input.requestedBy,
      input.taskDescription,
      input.agentTier,
      input.agentCount,
      input.topology,
      input.templateId,
      JSON.stringify(progress),
      input.maxTurns ?? 20,
      now,
    );

    return this.getById(input.taskId)!;
  }

  getById(taskId: string): TaskRecordRow | undefined {
    return this.db.query(`
      SELECT * FROM task_records WHERE task_id = ?
    `).get(taskId) as TaskRecordRow | undefined ?? undefined;
  }

  listByRequestedBy(requestedBy: string, options?: { states?: TaskState[]; limit?: number }): TaskRecordRow[] {
    const limit = options?.limit ?? 50;
    if (options?.states && options.states.length > 0) {
      const placeholders = options.states.map(() => "?").join(", ");
      return this.db.query(`
        SELECT * FROM task_records
        WHERE requested_by = ? AND state IN (${placeholders})
        ORDER BY created_at DESC
        LIMIT ?
      `).all(requestedBy, ...options.states, limit) as TaskRecordRow[];
    }

    return this.db.query(`
      SELECT * FROM task_records
      WHERE requested_by = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(requestedBy, limit) as TaskRecordRow[];
  }

  listBySpaceId(spaceId: string): TaskRecordRow[] {
    return this.db.query(`
      SELECT * FROM task_records
      WHERE space_id = ?
      ORDER BY created_at DESC
    `).all(spaceId) as TaskRecordRow[];
  }

  listActive(): TaskRecordRow[] {
    return this.db.query(`
      SELECT * FROM task_records
      WHERE state IN ('pending', 'deploying', 'running', 'synthesizing', 'input_required')
      ORDER BY created_at ASC
    `).all() as TaskRecordRow[];
  }

  update(input: UpdateTaskRecordInput): TaskRecordRow | undefined {
    const existing = this.getById(input.taskId);
    if (!existing) return undefined;

    const sets: string[] = [];
    const values: unknown[] = [];

    if (input.state) {
      sets.push("state = ?");
      values.push(input.state);
      if (input.state === "completed" || input.state === "failed") {
        sets.push("completed_at = ?");
        values.push(new Date().toISOString());
      }
    }

    if (input.spaceId !== undefined) {
      sets.push("space_id = ?");
      values.push(input.spaceId);
    }

    if (input.progress) {
      sets.push("progress_json = ?");
      values.push(JSON.stringify(input.progress));
    }

    if (input.artifactIds) {
      sets.push("artifact_ids_json = ?");
      values.push(JSON.stringify(input.artifactIds));
    }

    if (input.errorMessage !== undefined) {
      sets.push("error_message = ?");
      values.push(input.errorMessage);
    }

    if (sets.length === 0) return existing;

    values.push(input.taskId);
    this.db.query(`
      UPDATE task_records SET ${sets.join(", ")} WHERE task_id = ?
    `).run(...(values as [string, ...string[]]));

    return this.getById(input.taskId);
  }

  countActive(): number {
    const row = this.db.query(`
      SELECT COUNT(*) as count FROM task_records
      WHERE state IN ('pending', 'deploying', 'running', 'synthesizing', 'input_required')
    `).get() as { count: number } | undefined;
    return row?.count ?? 0;
  }
}
