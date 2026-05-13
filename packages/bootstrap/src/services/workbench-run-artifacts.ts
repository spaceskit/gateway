import { randomUUID } from "node:crypto";
import type {
  WorkbenchArtifactRepository,
  WorkbenchExecutionMode,
  WorkbenchRunRow,
} from "@spaceskit/persistence";
import type {
  WorkbenchQueueItemPayload,
  WorkbenchVerificationSuitePayload,
  WorkbenchWorktreeRefPayload,
} from "@spaceskit/server";
import {
  buildGeneratedDocsKnowledgeArtifact,
  runWorkbenchDocsPreflight,
} from "./workbench-docs-evidence.js";
import {
  centralTasksRoot,
} from "./workbench-task-metadata.js";
import type {
  RunWorkbenchCommandOptions,
  WorkbenchCommandEvidence,
} from "./workbench-verification-executor.js";

export function persistWorkbenchVerificationLog(
  artifacts: WorkbenchArtifactRepository,
  runId: string,
  suite: WorkbenchVerificationSuitePayload,
  evidence: WorkbenchCommandEvidence,
): string {
  const artifactId = `wb-artifact-${randomUUID()}`;
  artifacts.create({
    artifactId,
    runId,
    kind: "verification_log",
    title: `${suite.name} Log`,
    contentType: "text/plain",
    contentText: [
      `$ ${evidence.command}`,
      ``,
      `status: ${evidence.status}`,
      `exitCode: ${evidence.exitCode ?? "null"}`,
      `durationMs: ${evidence.durationMs}`,
      `timedOut: ${evidence.timedOut}`,
      ``,
      `# stdout`,
      evidence.stdout || "(empty)",
      ``,
      `# stderr`,
      evidence.stderr || "(empty)",
    ].join("\n"),
  });
  return artifactId;
}

export async function persistWorkbenchDocsPreflightArtifact(input: {
  artifacts: WorkbenchArtifactRepository;
  runId: string;
  worktreePath: string;
  verificationCommandTimeoutMs: number;
  now: () => Date;
  verificationExecutor: (options: RunWorkbenchCommandOptions) => Promise<WorkbenchCommandEvidence>;
}): Promise<void> {
  const preflight = await runWorkbenchDocsPreflight({
    worktreePath: input.worktreePath,
    timeoutMs: input.verificationCommandTimeoutMs,
    now: input.now,
    verificationExecutor: input.verificationExecutor,
  });
  if (!preflight.check) {
    input.artifacts.create({
      artifactId: `wb-artifact-${randomUUID()}`,
      runId: input.runId,
      kind: "docs",
      title: "Docs Freshness Preflight",
      contentType: "text/markdown",
      contentText: [
        "# Docs Freshness Preflight",
        "",
        "- Status: `not_available`",
        "- Command: `bun run docs:check`",
        "- Blocking: `false`",
      ].join("\n"),
    });
    return;
  }

  const evidence = preflight.evidence!;
  input.artifacts.create({
    artifactId: `wb-artifact-${randomUUID()}`,
    runId: input.runId,
    kind: "docs",
    title: "Docs Freshness Preflight",
    contentType: "text/markdown",
    contentText: [
      "# Docs Freshness Preflight",
      "",
      `- Status: \`${preflight.status}\``,
      `- Command: \`${preflight.check.displayCommand}\``,
      `- Exit code: \`${evidence.exitCode ?? "null"}\``,
      `- Duration: \`${evidence.durationMs}ms\``,
      `- Timed out: \`${evidence.timedOut}\``,
      "- Blocking: `false`",
      "",
      "## stdout",
      "```text",
      evidence.stdout || "(empty)",
      "```",
      "",
      "## stderr",
      "```text",
      evidence.stderr || "(empty)",
      "```",
    ].join("\n"),
  });
}

export function persistWorkbenchGeneratedDocsKnowledgeArtifact(
  artifacts: WorkbenchArtifactRepository,
  runId: string,
  worktreePath: string,
): void {
  artifacts.create({
    artifactId: `wb-artifact-${randomUUID()}`,
    runId,
    kind: "knowledge",
    title: "Attached Generated Docs Knowledge",
    contentType: "text/markdown",
    contentText: buildGeneratedDocsKnowledgeArtifact(worktreePath),
  });
}

export function persistWorkbenchRunArtifacts(input: {
  artifacts: WorkbenchArtifactRepository;
  workProjectsRoot: string;
  workbenchProjectSlug: string;
  row: WorkbenchRunRow;
  queueItem: WorkbenchQueueItemPayload;
  worktree: WorkbenchWorktreeRefPayload;
  verificationSuites: WorkbenchVerificationSuitePayload[];
  executionMode: WorkbenchExecutionMode;
}): void {
  const queuePath = centralTasksRoot(input.workProjectsRoot, input.workbenchProjectSlug);
  input.artifacts.create({
    artifactId: `wb-artifact-${randomUUID()}`,
    runId: input.row.run_id,
    kind: "plan",
    title: "Execution Plan",
    contentType: "text/markdown",
    contentText: [
      `# Workbench Plan`,
      ``,
      `- Queue item: \`${input.queueItem.queueItemId}\``,
      `- Task file: \`${input.queueItem.taskFilePath}\``,
      `- Queue source: \`${queuePath}\``,
      `- Requested mode: \`${input.executionMode}\``,
      `- Next action: ${input.queueItem.nextAction}`,
    ].join("\n"),
  });
  input.artifacts.create({
    artifactId: `wb-artifact-${randomUUID()}`,
    runId: input.row.run_id,
    kind: "verification",
    title: "Verification Suites",
    contentType: "text/markdown",
    contentText: [
      `# Verification`,
      ``,
      `- Mode: \`${input.queueItem.verificationMode}\``,
      ...input.queueItem.executionModeBlockers.map((blocker) => `- Blocker: ${blocker}`),
      ...input.verificationSuites.map((suite) => `- [${suite.status}] \`${suite.command}\``),
      ...(input.verificationSuites.length === 0 ? ["- No machine-readable verification commands declared."] : []),
    ].join("\n"),
  });
  input.artifacts.create({
    artifactId: `wb-artifact-${randomUUID()}`,
    runId: input.row.run_id,
    kind: "report",
    title: "Run Report",
    contentType: "text/markdown",
    contentText: [
      `# Run Report`,
      ``,
      `- Run ID: \`${input.row.run_id}\``,
      `- Stage: \`${input.row.current_stage}\``,
      `- Status: \`${input.row.status}\``,
      `- Worktree: \`${input.worktree.path}\``,
      `- Branch: \`${input.worktree.branchName}\``,
    ].join("\n"),
  });
}
