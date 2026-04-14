import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import {
  auditWorkbenchOpenBacklog,
  auditWorkbenchPlanningRepo,
  type WorkbenchOpenBacklogAuditReport,
  type WorkbenchPlanningAuditIssue,
  type WorkbenchPlanningAuditReport,
} from "../packages/bootstrap/src/services/workbench-service.js";
import {
  buildDraftGoalContractMarkdown,
  deriveDraftGoalContractInput,
  insertDraftGoalContract,
  parseGoalContractBlock,
} from "../packages/bootstrap/src/services/planning-goal-contract.js";

interface ScriptOptions {
  repoRoot: string;
  check: boolean;
  writeDrafts: boolean;
  scope: AuditScope;
}

type AuditScope = "active-queue" | "open-tasks";

interface QueueRow {
  item: string;
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  if (!options.check && !options.writeDrafts) {
    throw new Error("Pass --check or --write-drafts.");
  }
  if (options.writeDrafts && options.scope !== "active-queue") {
    throw new Error("--write-drafts is only supported with --scope active-queue.");
  }

  const taskPaths = indexTaskFiles(options.repoRoot);
  let written = 0;
  let skippedExisting = 0;
  let skippedNonExecutable = 0;

  if (options.writeDrafts) {
    const queuePath = join(options.repoRoot, "_planning", "WHAT-TO-DO-NEXT.md");
    for (const row of parseActiveQueueRows(readFileSync(queuePath, "utf8"))) {
      const taskPath = taskPaths.get(row.item.toLowerCase());
      if (!taskPath) {
        skippedNonExecutable += 1;
        continue;
      }
      const markdown = readFileSync(taskPath, "utf8");
      if (parseGoalContractBlock(markdown).state !== "missing") {
        skippedExisting += 1;
        continue;
      }
      const draft = buildDraftGoalContractMarkdown(deriveDraftGoalContractInput(markdown, basename(taskPath)));
      writeFileSync(taskPath, insertDraftGoalContract(markdown, draft));
      written += 1;
    }
  }

  const audit = options.scope === "open-tasks"
    ? auditWorkbenchOpenBacklog(options.repoRoot)
    : auditWorkbenchPlanningRepo(options.repoRoot);
  const summary = {
    repoRoot: options.repoRoot,
    scope: options.scope,
    written,
    skippedExisting,
    skippedNonExecutable,
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
  let check = false;
  let writeDrafts = false;
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
        writeDrafts = true;
        break;
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

  return { repoRoot, check, writeDrafts, scope };
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
    ...audit.missingMachineReadableVerification,
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

function parseActiveQueueRows(markdown: string): QueueRow[] {
  const activeSection = extractSection(markdown, "Active Queue");
  if (!activeSection) return [];
  return activeSection
    .split("\n")
    .filter((line) => /^\|\s*\d+\s*\|/.test(line))
    .map((line) => {
      const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
      return { item: stripCodeTicks(cells[1] ?? "") };
    });
}

function extractSection(content: string, headingTitle: string): string | null {
  const lines = content.split("\n");
  const headingIndex = lines.findIndex((line) => line.startsWith("## ") && line.slice(3).trim() === headingTitle);
  if (headingIndex === -1) return null;
  const sectionLines: string[] = [];
  for (let index = headingIndex + 1; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (line.startsWith("## ")) break;
    sectionLines.push(line);
  }
  return sectionLines.join("\n").trim() || null;
}

function indexTaskFiles(repoRoot: string): Map<string, string> {
  const tasksRoot = join(repoRoot, "_planning", "backlog", "tasks");
  const result = new Map<string, string>();
  if (!existsSync(tasksRoot)) return result;
  const stack = [tasksRoot];
  while (stack.length > 0) {
    const current = stack.pop()!;
    for (const entry of readdirSync(current)) {
      const fullPath = join(current, entry);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (entry.endsWith(".md")) {
        result.set(entry.toLowerCase(), fullPath);
      }
    }
  }
  return result;
}

function findRepoRoot(startPath: string): string {
  let current = startPath;
  while (true) {
    if (existsSync(join(current, "_planning", "WHAT-TO-DO-NEXT.md"))) {
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

function stripCodeTicks(value: string): string {
  return value.replace(/^`/, "").replace(/`$/, "").trim();
}

main();
