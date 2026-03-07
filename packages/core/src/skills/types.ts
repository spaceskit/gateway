/**
 * Skill & Action types — mirrors the proto definitions.
 *
 * A Skill is declarative context injected into an agent's prompt.
 * An Action is an executable procedure with steps, scripts, and side effects.
 */

// ---------------------------------------------------------------------------
// Skills (declarative)
// ---------------------------------------------------------------------------

export interface Skill {
  skillId: string;
  name: string;
  description: string;
  /** Path to the .md file (relative to skills root or absolute). */
  sourcePath: string;
  tags: string[];
  /** Scoped to specific agents. Empty = globally available. */
  scopedAgentIds: string[];
  /** Scoped to specific space templates. Empty = globally available. */
  scopedTemplateIds: string[];
  createdAt: Date;
  updatedAt: Date;
}

// ---------------------------------------------------------------------------
// Actions (executable)
// ---------------------------------------------------------------------------

export type ActionStepType = "prompt" | "script" | "invoke";

export interface ActionStep {
  order: number;
  type: ActionStepType;
  label: string;
  /**
   * For "script": the command or script path.
   * For "prompt": the prompt text.
   * For "invoke": the capability ID.
   */
  content: string;
  /** For "invoke": arguments passed to the capability. */
  params?: Record<string, unknown>;
  /** If true, failure of this step stops the action. */
  required: boolean;
  /** Timeout in seconds. 0 = no timeout. */
  timeoutSeconds: number;
}

export interface ActionPermissions {
  allowNetwork: boolean;
  allowFilesystem: boolean;
  filesystemScope: string;
  commandAllowlist: string[];
}

export interface Action {
  actionId: string;
  name: string;
  description: string;
  /** Path to the source .md file. */
  sourcePath: string;
  tags: string[];
  /** Capabilities this action requires to run. */
  requiredCapabilities: string[];
  steps: ActionStep[];
  permissions: ActionPermissions;
  createdAt: Date;
  updatedAt: Date;
}

export type ActionStatus = "pending" | "running" | "completed" | "failed" | "canceled";

export interface ActionRun {
  runId: string;
  actionId: string;
  spaceId: string;
  agentId: string;
  status: ActionStatus;
  currentStep: number;
  totalSteps: number;
  output: string;
  error: string;
  durationMs: number;
  startedAt: Date;
  completedAt?: Date;
}
