import type { WorkbenchRunRepository } from "@spaceskit/persistence";
import type {
  WorkbenchExecutionContextPayload,
  WorkbenchLandingResultPayload,
  WorkbenchQueueItemPayload,
  WorkbenchVerificationResultPayload,
  WorkbenchVerificationSuitePayload,
  WorkbenchWorktreeRefPayload,
} from "@spaceskit/server";
import type { WorkbenchRunRow } from "@spaceskit/persistence";
import {
  executeWorkbenchAgentLoopIfConfigured,
  type WorkbenchAgentLoopContext,
  type WorkbenchExecutionLoopResult,
} from "./workbench-agent-loop.js";
import type { WorkbenchCommandEvidence } from "./workbench-verification-executor.js";
import { parseJson } from "./workbench-service-normalizers.js";

interface WorkbenchRunExecutionContext {
  runs: WorkbenchRunRepository;
  now: () => Date;
  requireRun(runId: string): WorkbenchRunRow;
  agentLoopContext(): WorkbenchAgentLoopContext;
  persistDocsPreflightArtifact(runId: string, worktreePath: string): Promise<void>;
  persistGeneratedDocsKnowledgeArtifact(runId: string, worktreePath: string): void;
  persistVerificationLog(
    runId: string,
    suite: WorkbenchVerificationSuitePayload,
    evidence: WorkbenchCommandEvidence,
  ): string;
  runVerificationCommand(
    suite: WorkbenchVerificationSuitePayload,
    worktree: WorkbenchWorktreeRefPayload,
  ): Promise<WorkbenchCommandEvidence>;
  resolveQueueItems(queueItemIds: string[]): WorkbenchQueueItemPayload[];
  updateCentralTaskStatus(
    queueItem: WorkbenchQueueItemPayload,
    status: "in-progress" | "review" | "blocked",
    logMessage: string,
  ): void;
}

export async function executeWorkbenchRunIfReady(
  context: WorkbenchRunExecutionContext,
  runId: string,
): Promise<WorkbenchRunRow> {
  let run = context.requireRun(runId);
  if (run.current_stage !== "execute" || run.status === "cancelled") {
    return run;
  }

  const suites = parseJson<WorkbenchVerificationSuitePayload[]>(run.verification_suites_json) ?? [];
  const worktree = run.worktree_json ? parseJson<WorkbenchWorktreeRefPayload>(run.worktree_json) : null;
  if (!worktree || suites.length === 0) {
    return run;
  }

  const executionLoop = await runWorkbenchAgentLoop(context, run, worktree, suites);
  run = executionLoop.row;
  if (!executionLoop.continueToVerification) {
    return run;
  }

  await context.persistDocsPreflightArtifact(run.run_id, worktree.path);
  context.persistGeneratedDocsKnowledgeArtifact(run.run_id, worktree.path);
  context.runs.update(run.run_id, {
    status: "running",
    currentStage: "verify",
    verificationResultJson: JSON.stringify({
      status: "pending",
      summary: "Verification commands are running.",
    } satisfies WorkbenchVerificationResultPayload),
  });

  const nextSuites: WorkbenchVerificationSuitePayload[] = [];
  for (const suite of suites) {
    const runningSuite = {
      ...suite,
      status: "running" as const,
      startedAt: context.now().toISOString(),
    };
    nextSuites.push(runningSuite);
    context.runs.update(run.run_id, {
      verificationSuitesJson: JSON.stringify([
        ...nextSuites,
        ...suites.slice(nextSuites.length),
      ]),
    });

    const evidence = await context.runVerificationCommand(suite, worktree);
    const logArtifactId = context.persistVerificationLog(run.run_id, suite, evidence);
    nextSuites[nextSuites.length - 1] = {
      ...runningSuite,
      status: evidence.status,
      completedAt: evidence.completedAt,
      exitCode: evidence.exitCode ?? undefined,
      durationMs: evidence.durationMs,
      logArtifactId,
      summary: evidence.summary,
    };
    context.runs.update(run.run_id, {
      verificationSuitesJson: JSON.stringify([
        ...nextSuites,
        ...suites.slice(nextSuites.length),
      ]),
    });
  }

  const failedSuite = nextSuites.find((suite) => suite.status === "failed");
  const completedAt = context.now().toISOString();
  const existingExecutionContext = run.execution_context_json
    ? parseJson<WorkbenchExecutionContextPayload>(run.execution_context_json)
    : null;
  const finalExecutionContext = existingExecutionContext
    ? {
        ...existingExecutionContext,
        stage: failedSuite ? "failed" : "completed",
      } satisfies WorkbenchExecutionContextPayload
    : null;
  const updated = context.runs.update(run.run_id, {
    status: failedSuite ? "failed" : "completed",
    currentStage: "report",
    finishedAt: completedAt,
    lastErrorCode: failedSuite ? "VERIFICATION_FAILED" : null,
    lastErrorMessage: failedSuite ? `${failedSuite.name} failed.` : null,
    verificationSuitesJson: JSON.stringify(nextSuites),
    executionContextJson: finalExecutionContext ? JSON.stringify(finalExecutionContext) : undefined,
    verificationResultJson: JSON.stringify({
      status: failedSuite ? "failed" : "passed",
      summary: failedSuite ? `${failedSuite.name} failed.` : "All verification commands passed.",
      completedAt,
    } satisfies WorkbenchVerificationResultPayload),
    landingResultJson: JSON.stringify({
      status: "blocked",
      summary: "Automatic landing is not enabled for this Workbench executor slice.",
      completedAt,
    } satisfies WorkbenchLandingResultPayload),
  });
  const queueItem = context.resolveQueueItems([run.queue_item_id])[0];
  if (queueItem) {
    context.updateCentralTaskStatus(
      queueItem,
      failedSuite ? "blocked" : "review",
      failedSuite
        ? `Workbench run ${run.run_id} failed verification: ${failedSuite.name}.`
        : `Workbench run ${run.run_id} completed verification and is ready for review.`,
    );
  }
  return updated ?? run;
}

function runWorkbenchAgentLoop(
  context: WorkbenchRunExecutionContext,
  run: WorkbenchRunRow,
  worktree: WorkbenchWorktreeRefPayload,
  suites: WorkbenchVerificationSuitePayload[],
): Promise<WorkbenchExecutionLoopResult> {
  return executeWorkbenchAgentLoopIfConfigured(context.agentLoopContext(), run, worktree, suites);
}
