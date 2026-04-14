import type { Database, SQLQueryBindings } from "bun:sqlite";
import type { WorkbenchExecutionMode } from "./workbench-batches.js";

export interface WorkbenchPolicyRow {
  singleton_id: number;
  default_execution_mode: WorkbenchExecutionMode;
  autonomous_enabled: number;
  max_parallel_runs: number;
  require_explicit_autonomous_opt_in: number;
  require_ai_shippable_for_autonomous: number;
  updated_at: string;
}

export interface SetWorkbenchPolicyInput {
  defaultExecutionMode?: WorkbenchExecutionMode;
  autonomousEnabled?: boolean;
  maxParallelRuns?: number;
  requireExplicitAutonomousOptIn?: boolean;
  requireAiShippableForAutonomous?: boolean;
}

export class WorkbenchPolicyRepository {
  constructor(private readonly db: Database) {}

  get(): WorkbenchPolicyRow {
    const existing = this.db.query(`
      SELECT * FROM workbench_policy
      WHERE singleton_id = 1
    `).get() as WorkbenchPolicyRow | undefined;
    if (existing) return existing;

    const now = new Date().toISOString();
    this.db.query(`
      INSERT INTO workbench_policy(
        singleton_id,
        default_execution_mode,
        autonomous_enabled,
        max_parallel_runs,
        require_explicit_autonomous_opt_in,
        require_ai_shippable_for_autonomous,
        updated_at
      ) VALUES (1, 'supervised', 1, 2, 1, 1, ?)
    `).run(now);
    return this.get();
  }

  set(input: SetWorkbenchPolicyInput): WorkbenchPolicyRow {
    this.get();

    const assignments: string[] = [];
    const values: SQLQueryBindings[] = [];

    if (input.defaultExecutionMode !== undefined) {
      assignments.push("default_execution_mode = ?");
      values.push(input.defaultExecutionMode);
    }
    if (input.autonomousEnabled !== undefined) {
      assignments.push("autonomous_enabled = ?");
      values.push(input.autonomousEnabled ? 1 : 0);
    }
    if (input.maxParallelRuns !== undefined) {
      assignments.push("max_parallel_runs = ?");
      values.push(Math.max(1, Math.min(50, Math.floor(input.maxParallelRuns))));
    }
    if (input.requireExplicitAutonomousOptIn !== undefined) {
      assignments.push("require_explicit_autonomous_opt_in = ?");
      values.push(input.requireExplicitAutonomousOptIn ? 1 : 0);
    }
    if (input.requireAiShippableForAutonomous !== undefined) {
      assignments.push("require_ai_shippable_for_autonomous = ?");
      values.push(input.requireAiShippableForAutonomous ? 1 : 0);
    }

    assignments.push("updated_at = ?");
    values.push(new Date().toISOString());

    this.db.query(`
      UPDATE workbench_policy
      SET ${assignments.join(", ")}
      WHERE singleton_id = 1
    `).run(...values);

    return this.get();
  }
}
