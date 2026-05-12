import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { Logger } from "@spaceskit/observability";
import {
  centralTasksRoot,
  loadCentralTasks,
  resolvePlanningRepoRoot,
} from "./workbench-task-metadata.js";

export interface WorkbenchPlanningAuditIssue {
  queueIndex?: number;
  queueItemId: string;
  taskFilePath?: string;
  message: string;
  code?: string;
}

export interface WorkbenchPlanningAuditReport {
  repoRoot: string;
  queuePath: string;
  executableQueueItemCount: number;
  nonExecutableRows: WorkbenchPlanningAuditIssue[];
  missingMachineReadableVerification: WorkbenchPlanningAuditIssue[];
  malformedVerificationBlocks: WorkbenchPlanningAuditIssue[];
  goalContractErrors: WorkbenchPlanningAuditIssue[];
  goalContractWarnings: WorkbenchPlanningAuditIssue[];
}

export interface WorkbenchOpenBacklogAuditReport extends WorkbenchPlanningAuditReport {
  openTaskCount: number;
  unqueuedOpenTasks: WorkbenchPlanningAuditIssue[];
  missingExplicitDelegationMetadata: WorkbenchPlanningAuditIssue[];
  missingExplicitAiShippableMetadata: WorkbenchPlanningAuditIssue[];
}

type WorkbenchPlanningAuditOptions = {
  logger?: Logger | null;
  workProjectsRoot?: string;
  projectSlug?: string;
  now?: Date;
};

type WorkbenchPlanningAuditLoggerOrOptions = Logger | null | WorkbenchPlanningAuditOptions;

export function auditWorkbenchPlanningRepo(
  startPath: string,
  loggerOrOptions: WorkbenchPlanningAuditLoggerOrOptions = null,
): WorkbenchPlanningAuditReport {
  const options = normalizeAuditOptions(loggerOrOptions);
  const repoRoot = resolvePlanningRepoRoot(resolve(startPath), options.logger);
  const queuePath = centralTasksRoot(options.workProjectsRoot, options.projectSlug);
  if (!existsSync(queuePath)) {
    return {
      repoRoot,
      queuePath,
      executableQueueItemCount: 0,
      nonExecutableRows: [],
      missingMachineReadableVerification: [],
      malformedVerificationBlocks: [],
      goalContractErrors: [],
      goalContractWarnings: [],
    };
  }

  const tasks = loadCentralTasks(options.workProjectsRoot, options.projectSlug, options.now, options.logger);
  const seenIds = new Set<string>();
  const nonExecutableRows: WorkbenchPlanningAuditIssue[] = [];
  const missingMachineReadableVerification: WorkbenchPlanningAuditIssue[] = [];
  const malformedVerificationBlocks: WorkbenchPlanningAuditIssue[] = [];
  const goalContractErrors: WorkbenchPlanningAuditIssue[] = [];
  const goalContractWarnings: WorkbenchPlanningAuditIssue[] = [];

  for (const [index, task] of tasks.entries()) {
    const taskMetadata = task.metadata;
    const queueIndex = index + 1;
    if (!taskMetadata.id.startsWith(`${options.projectSlug}/`)) {
      nonExecutableRows.push({
        queueIndex,
        queueItemId: taskMetadata.id,
        taskFilePath: task.path,
        message: `Task id must be namespaced as ${options.projectSlug}/T-NNNN.`,
      });
    }
    if (seenIds.has(taskMetadata.id)) {
      nonExecutableRows.push({
        queueIndex,
        queueItemId: taskMetadata.id,
        taskFilePath: task.path,
        message: "Duplicate central task id.",
      });
    }
    seenIds.add(taskMetadata.id);
    if (!["ready", "in-progress", "blocked", "review", "done", "dropped"].includes(taskMetadata.status)) {
      nonExecutableRows.push({
        queueIndex,
        queueItemId: taskMetadata.id,
        taskFilePath: task.path,
        message: `Invalid central task status: ${taskMetadata.status}.`,
      });
    }
    if (taskMetadata.verificationMode !== "machine_readable") {
      missingMachineReadableVerification.push({
        queueIndex,
        queueItemId: taskMetadata.id,
        taskFilePath: task.path,
        message: taskMetadata.verificationBlockerMessage ?? "No machine-readable verification declared.",
      });
    }
    if (taskMetadata.malformedVerificationBlock) {
      malformedVerificationBlocks.push({
        queueIndex,
        queueItemId: taskMetadata.id,
        taskFilePath: task.path,
        message: taskMetadata.verificationBlockerMessage ?? "Machine-readable verification block is malformed.",
      });
    }
    for (const issue of taskMetadata.goalContractErrors) {
      goalContractErrors.push({
        queueIndex,
        queueItemId: taskMetadata.id,
        taskFilePath: task.path,
        message: issue.message,
        code: issue.code,
      });
    }
    for (const issue of taskMetadata.goalContractWarnings) {
      goalContractWarnings.push({
        queueIndex,
        queueItemId: taskMetadata.id,
        taskFilePath: task.path,
        message: issue.message,
        code: issue.code,
      });
    }
  }

  return {
    repoRoot,
    queuePath,
    executableQueueItemCount: tasks.length,
    nonExecutableRows,
    missingMachineReadableVerification,
    malformedVerificationBlocks,
    goalContractErrors,
    goalContractWarnings,
  };
}

export function auditWorkbenchOpenBacklog(
  startPath: string,
  loggerOrOptions: WorkbenchPlanningAuditLoggerOrOptions = null,
): WorkbenchOpenBacklogAuditReport {
  const activeAudit = auditWorkbenchPlanningRepo(startPath, loggerOrOptions);
  return {
    ...activeAudit,
    openTaskCount: activeAudit.executableQueueItemCount,
    unqueuedOpenTasks: [],
    missingMachineReadableVerification: activeAudit.missingMachineReadableVerification,
    malformedVerificationBlocks: activeAudit.malformedVerificationBlocks,
    goalContractErrors: activeAudit.goalContractErrors,
    goalContractWarnings: activeAudit.goalContractWarnings,
    missingExplicitDelegationMetadata: [],
    missingExplicitAiShippableMetadata: [],
  };
}

function normalizeAuditOptions(input: WorkbenchPlanningAuditLoggerOrOptions): Required<WorkbenchPlanningAuditOptions> {
  if (isAuditOptions(input)) {
    return {
      logger: input.logger ?? null,
      workProjectsRoot: input.workProjectsRoot ?? "/Users/caruso/Documents/work/projects",
      projectSlug: input.projectSlug ?? "spaces",
      now: input.now ?? new Date(),
    };
  }
  return {
    logger: input,
    workProjectsRoot: "/Users/caruso/Documents/work/projects",
    projectSlug: "spaces",
    now: new Date(),
  };
}

function isAuditOptions(input: WorkbenchPlanningAuditLoggerOrOptions): input is WorkbenchPlanningAuditOptions {
  return typeof input === "object"
    && input !== null
    && ("logger" in input || "workProjectsRoot" in input || "projectSlug" in input || "now" in input);
}
