import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  auditWorkbenchOpenBacklog,
  auditWorkbenchPlanningRepo,
  type WorkbenchOpenBacklogAuditReport,
  type WorkbenchPlanningAuditIssue,
  type WorkbenchPlanningAuditReport,
} from "../packages/bootstrap/src/services/workbench-service.js";

interface ScriptOptions {
  repoRoot: string;
  workProjectsRoot: string;
  projectSlug: string;
  check: boolean;
  scope: AuditScope;
}

type AuditScope = "active-queue" | "open-tasks";

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  if (!options.check) {
    throw new Error("Pass --check. Draft goal_contract generation is no longer supported from the central queue.");
  }

  const audit = options.scope === "open-tasks"
    ? auditWorkbenchOpenBacklog(options.repoRoot, {
      workProjectsRoot: options.workProjectsRoot,
      projectSlug: options.projectSlug,
    })
    : auditWorkbenchPlanningRepo(options.repoRoot, {
      workProjectsRoot: options.workProjectsRoot,
      projectSlug: options.projectSlug,
    });
  const summary = {
    repoRoot: options.repoRoot,
    centralTasks: audit.queuePath,
    scope: options.scope,
    ...openBacklogSummary(audit),
    executableQueueItemCount: audit.executableQueueItemCount,
    nonExecutableRows: audit.nonExecutableRows.length,
    goalContractErrors: audit.goalContractErrors.length,
    goalContractWarnings: audit.goalContractWarnings.length,
    missingMachineReadableVerification: audit.missingMachineReadableVerification.length,
    malformedVerificationBlocks: audit.malformedVerificationBlocks.length,
  };
  console.log(JSON.stringify(summary, null, 2));

  const blockingIssues = collectBlockingIssues(audit);
  if (blockingIssues.length > 0) {
    for (const issue of blockingIssues) {
      console.error(`${issue.queueItemId}: ${issue.message}`);
    }
    process.exitCode = 1;
  }
}

function parseArgs(argv: string[]): ScriptOptions {
  let repoRoot = findRepoRoot(resolve(join(import.meta.dir, "..", "..")));
  let workProjectsRoot = process.env.WORK_PROJECTS_ROOT || "/Users/caruso/Documents/work/projects";
  let projectSlug = process.env.WORKBENCH_PROJECT_SLUG || "spaces";
  let check = false;
  let scope: AuditScope = "active-queue";

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    const [flag, inlineValue] = splitInlineFlag(arg);
    switch (flag) {
      case "--repo-root": {
        const value = inlineValue ?? argv[++index];
        if (!value?.trim()) throw new Error("--repo-root requires a value.");
        repoRoot = findRepoRoot(resolve(value));
        break;
      }
      case "--check":
        check = true;
        break;
      case "--write-drafts":
        throw new Error("--write-drafts was retired with the central queue cutover.");
      case "--work-projects-root": {
        const value = inlineValue ?? argv[++index];
        if (!value?.trim()) throw new Error("--work-projects-root requires a value.");
        workProjectsRoot = resolve(value);
        break;
      }
      case "--project": {
        const value = inlineValue ?? argv[++index];
        if (!value?.trim()) throw new Error("--project requires a value.");
        projectSlug = value.trim();
        break;
      }
      case "--scope": {
        const value = inlineValue ?? argv[++index];
        if (value !== "active-queue" && value !== "open-tasks") {
          throw new Error("--scope must be active-queue or open-tasks.");
        }
        scope = value;
        break;
      }
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return { repoRoot, workProjectsRoot, projectSlug, check, scope };
}

function openBacklogSummary(audit: WorkbenchPlanningAuditReport) {
  if (!isOpenBacklogAudit(audit)) return {};
  return {
    openTaskCount: audit.openTaskCount,
    unqueuedOpenTasks: audit.unqueuedOpenTasks.length,
    missingExplicitDelegationMetadata: audit.missingExplicitDelegationMetadata.length,
    missingExplicitAiShippableMetadata: audit.missingExplicitAiShippableMetadata.length,
  };
}

function collectBlockingIssues(audit: WorkbenchPlanningAuditReport): WorkbenchPlanningAuditIssue[] {
  const issues = [
    ...audit.nonExecutableRows,
    ...audit.malformedVerificationBlocks,
    ...audit.goalContractErrors,
  ];
  if (isOpenBacklogAudit(audit)) {
    issues.push(
      ...audit.unqueuedOpenTasks,
      ...audit.missingExplicitDelegationMetadata,
      ...audit.missingExplicitAiShippableMetadata,
    );
  }
  return issues;
}

function isOpenBacklogAudit(audit: WorkbenchPlanningAuditReport): audit is WorkbenchOpenBacklogAuditReport {
  return "openTaskCount" in audit;
}

function findRepoRoot(startPath: string): string {
  let current = startPath;
  while (true) {
    if (existsSync(join(current, ".git")) || existsSync(join(current, "gateway", "package.json"))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) {
      throw new Error(`Could not find planning repo root from ${startPath}`);
    }
    current = parent;
  }
}

function splitInlineFlag(arg: string): [string, string | undefined] {
  const equalsIndex = arg.indexOf("=");
  if (equalsIndex === -1) {
    return [arg, undefined];
  }
  return [arg.slice(0, equalsIndex), arg.slice(equalsIndex + 1)];
}

main();
