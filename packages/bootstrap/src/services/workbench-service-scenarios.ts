import { randomUUID } from "node:crypto";
import type {
  WorkbenchScenarioRunRepository,
  WorkbenchScenarioRunRow,
} from "@spaceskit/persistence";
import type {
  WorkbenchCancelScenarioRunPayload,
  WorkbenchGetScenarioRunPayload,
  WorkbenchListScenarioRunsPayload,
  WorkbenchListScenariosResponsePayload,
  WorkbenchScenarioRunConfigPayload,
  WorkbenchScenarioRunPayload,
  WorkbenchStartScenarioRunPayload,
} from "@spaceskit/server";
import {
  executeWorkbenchScenarioRun,
  listWorkbenchScenarios,
  summarizeScenarioRun,
  toScenarioOverallStatus,
  type ExecuteWorkbenchScenarioRunOptions,
} from "@spaceskit/workbench-runner";
import { WorkbenchServiceError, normalizeLimit, normalizeRequired } from "./workbench-service-normalizers.js";
import { toWorkbenchScenarioRunPayload } from "./workbench-service-presenters.js";

export interface WorkbenchScenarioContext {
  scenarioRuns?: WorkbenchScenarioRunRepository;
  repoRoot: string;
  runnerApiEnabled: boolean;
  now: () => Date;
  scenarioRunner?: (options: ExecuteWorkbenchScenarioRunOptions) => ReturnType<typeof executeWorkbenchScenarioRun>;
}

export function listWorkbenchScenariosForProduct(
  ctx: Pick<WorkbenchScenarioContext, "runnerApiEnabled">,
): WorkbenchListScenariosResponsePayload {
  if (!ctx.runnerApiEnabled) {
    return { layers: [], scenarios: [] };
  }
  return listWorkbenchScenarios();
}

export async function startWorkbenchScenarioRun(
  ctx: WorkbenchScenarioContext,
  input: WorkbenchStartScenarioRunPayload & { principalId: string },
): Promise<WorkbenchScenarioRunPayload> {
  assertRunnerEnabled(ctx);
  const repo = requireScenarioRuns(ctx);
  const config = normalizeScenarioRunConfig(input.config);
  const scenarioRunId = input.idempotencyKey?.trim() || `scenario-run-${randomUUID()}`;
  const startedAt = ctx.now().toISOString();
  let row = repo.create({
    scenarioRunId,
    status: "running",
    configJson: JSON.stringify(config),
    createdByPrincipalId: normalizeRequired(input.principalId, "principalId"),
    startedAt,
  });

  try {
    const runner = ctx.scenarioRunner ?? executeWorkbenchScenarioRun;
    const report = await runner({
      config,
      repoRoot: ctx.repoRoot,
    });
    row = repo.update(scenarioRunId, {
      status: report.status === "passed" ? "completed" : "failed",
      overallStatus: toScenarioOverallStatus(report.status),
      summary: summarizeScenarioRun(report),
      durationMs: report.finished_at && report.started_at
        ? Math.max(0, new Date(report.finished_at).getTime() - new Date(report.started_at).getTime())
        : report.scenarios.reduce((sum, scenario) => sum + scenario.duration_ms, 0),
      finishedAt: ctx.now().toISOString(),
      lastErrorCode: report.status === "passed" ? "" : "SCENARIO_RUN_FAILED",
      lastErrorMessage: report.status === "passed" ? "" : "One or more Workbench scenarios failed.",
    }) ?? row;
    return toWorkbenchScenarioRunPayload(row);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    row = repo.update(scenarioRunId, {
      status: "failed",
      overallStatus: "failed",
      summary: `Workbench scenario run failed: ${message}`,
      finishedAt: ctx.now().toISOString(),
      lastErrorCode: "SCENARIO_RUN_FAILED",
      lastErrorMessage: message,
    }) ?? row;
    return toWorkbenchScenarioRunPayload(row);
  }
}

export function listWorkbenchScenarioRuns(
  ctx: WorkbenchScenarioContext,
  input: WorkbenchListScenarioRunsPayload & { principalId?: string } = {},
): WorkbenchScenarioRunPayload[] {
  const repo = requireScenarioRuns(ctx);
  return repo.list({
    status: input.status,
    limit: normalizeLimit(input.limit ?? 100),
  }).map(toWorkbenchScenarioRunPayload);
}

export function getWorkbenchScenarioRun(
  ctx: WorkbenchScenarioContext,
  input: WorkbenchGetScenarioRunPayload & { principalId?: string },
): WorkbenchScenarioRunPayload | null {
  const row = requireScenarioRuns(ctx).get(normalizeRequired(input.scenarioRunId, "scenarioRunId"));
  return row ? toWorkbenchScenarioRunPayload(row) : null;
}

export function cancelWorkbenchScenarioRun(
  ctx: WorkbenchScenarioContext,
  input: WorkbenchCancelScenarioRunPayload & { principalId: string },
): WorkbenchScenarioRunPayload {
  assertRunnerEnabled(ctx);
  normalizeRequired(input.principalId, "principalId");
  const repo = requireScenarioRuns(ctx);
  const scenarioRunId = normalizeRequired(input.scenarioRunId, "scenarioRunId");
  const existing = repo.get(scenarioRunId);
  if (!existing) {
    throw new WorkbenchServiceError("NOT_FOUND", `Workbench scenario run not found: ${scenarioRunId}`);
  }
  if (existing.status !== "queued" && existing.status !== "running") {
    return toWorkbenchScenarioRunPayload(existing);
  }
  const row = repo.update(scenarioRunId, {
    status: "cancelled",
    finishedAt: ctx.now().toISOString(),
    summary: "Workbench scenario run was cancelled.",
  }) ?? existing;
  return toWorkbenchScenarioRunPayload(row);
}

function assertRunnerEnabled(ctx: WorkbenchScenarioContext): void {
  if (!ctx.runnerApiEnabled) {
    throw new WorkbenchServiceError("FAILED_PRECONDITION", "Workbench runner API is disabled");
  }
}

function requireScenarioRuns(ctx: WorkbenchScenarioContext): WorkbenchScenarioRunRepository {
  if (!ctx.scenarioRuns) {
    throw new WorkbenchServiceError("FAILED_PRECONDITION", "Workbench scenario run persistence is unavailable");
  }
  return ctx.scenarioRuns;
}

function normalizeScenarioRunConfig(config: WorkbenchScenarioRunConfigPayload): WorkbenchScenarioRunConfigPayload {
  const normalized = {
    layerIds: normalizeOptionalList(config.layerIds),
    scenarioIds: normalizeOptionalList(config.scenarioIds),
    providerIds: normalizeOptionalList(config.providerIds),
  };
  if (!normalized.layerIds?.length && !normalized.scenarioIds?.length) {
    throw new WorkbenchServiceError("INVALID_ARGUMENT", "config.layerIds or config.scenarioIds is required");
  }
  return normalized;
}

function normalizeOptionalList(values: string[] | undefined): string[] | undefined {
  const normalized = Array.from(new Set((values ?? []).map((value) => value.trim()).filter(Boolean)));
  return normalized.length > 0 ? normalized : undefined;
}
