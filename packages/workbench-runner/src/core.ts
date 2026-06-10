import { spawnSync } from "node:child_process";
import { basename, dirname, join, resolve } from "node:path";
import { executeScenario } from "./executors.js";
import {
  buildDomainRecords,
  defaultOutputPaths,
  ensureDir,
  recordToPhase,
  rollupStatuses,
  writeJSON,
  writeWorkbenchReports,
} from "./reports.js";
import {
  isFastScenario,
  resolveExecutionPlan,
} from "./suite.js";
import type {
  AggregateReport,
  CLIOptions,
  ResolvedSuite,
  RunContext,
  ScenarioExecutionRecord,
  ScenarioStatus,
} from "./types.js";

export { loadSuite, resolveExecutionPlan } from "./suite.js";

function isoNow(): string {
  return new Date().toISOString();
}

function nowMs(): number {
  return Date.now();
}

function makeRunContext(suiteId: string, reportDir: string, repoRoot: string): RunContext {
  const artifactRoot = resolve(reportDir);
  const env = {
    SPACESKIT_SYNC_SHARED_SECRET: process.env.SPACESKIT_SYNC_SHARED_SECRET ?? "sync-smoke-secret",
    SPACESKIT_MAIN_HEALTH_URL: process.env.SPACESKIT_MAIN_HEALTH_URL ?? "http://127.0.0.1:9320/health",
    SPACESKIT_PEER_HEALTH_URL: process.env.SPACESKIT_PEER_HEALTH_URL ?? "http://127.0.0.1:9420/health",
    SPACESKIT_EXTERNAL_HEALTH_URL: process.env.SPACESKIT_EXTERNAL_HEALTH_URL ?? "http://127.0.0.1:9321/health",
    SPACESKIT_MAIN_GATEWAY_WS_URL: process.env.SPACESKIT_MAIN_GATEWAY_WS_URL ?? "ws://127.0.0.1:9320",
    SPACESKIT_MAIN_GATEWAY_HTTP_URL: process.env.SPACESKIT_MAIN_GATEWAY_HTTP_URL ?? "http://127.0.0.1:9320",
    SPACESKIT_PEER_GATEWAY_HTTP_URL: process.env.SPACESKIT_PEER_GATEWAY_HTTP_URL ?? "http://127.0.0.1:9420",
    SPACESKIT_EXTERNAL_GATEWAY_WS_URL: process.env.SPACESKIT_EXTERNAL_GATEWAY_WS_URL ?? "ws://127.0.0.1:9321",
    SPACESKIT_EXTERNAL_GATEWAY_HTTP_URL: process.env.SPACESKIT_EXTERNAL_GATEWAY_HTTP_URL ?? "http://127.0.0.1:9321",
    SPACESKIT_GATEWAY_CAPABILITY_GRANTS: process.env.SPACESKIT_GATEWAY_CAPABILITY_GRANTS ?? "lists.read,lists.write,lists.execute",
    SPACESKIT_MAIN_ADMIN_MCP: process.env.SPACESKIT_MAIN_ADMIN_MCP ?? "true",
    SPACESKIT_REQUIRE_EXPLICIT_DEVICE_AUTH: process.env.SPACESKIT_REQUIRE_EXPLICIT_DEVICE_AUTH ?? "true",
    WORKBENCH_IOS_DESTINATION: process.env.WORKBENCH_IOS_DESTINATION ?? "",
    WORKBENCH_REPORT_DIR: artifactRoot,
  };

  return {
    suite_id: suiteId,
    report_dir: artifactRoot,
    artifact_root: artifactRoot,
    repo_root: resolve(repoRoot),
    env,
  };
}

function defaultRepoRootForSuite(resolved: ResolvedSuite): string {
  const suiteDir = dirname(resolved.index_path);
  if (basename(suiteDir) === "workbench" && basename(dirname(suiteDir)) === "dev-services") {
    return resolve(suiteDir, "../..");
  }
  return process.cwd();
}

export async function runWorkbench(resolved: ResolvedSuite, options: CLIOptions): Promise<AggregateReport | null> {
  const scenarios = resolveExecutionPlan(resolved, options);
  if (scenarios.length === 0) {
    throw new Error("No workbench scenarios matched the requested filters.");
  }

  if (options.listOnly || options.dryRun) {
    for (const scenario of scenarios) {
      console.log(
        [
          scenario.domain_id,
          scenario.scenario_id,
          scenario.platform,
          scenario.adapter,
          scenario.tags.join(","),
        ].join("\t"),
      );
    }
    return null;
  }

  const repoRoot = resolve(options.repoRoot ?? defaultRepoRootForSuite(resolved));
  const { reportDir, jsonPath, junitPath } = defaultOutputPaths(resolved.suite, options, repoRoot);
  ensureDir(reportDir);
  ensureDir(join(reportDir, "logs"));
  ensureDir(join(reportDir, "results"));
  ensureDir(join(reportDir, "attachments"));
  ensureDir(join(reportDir, "metadata"));

  const startedAt = isoNow();
  const runContext = makeRunContext(resolved.suite.suite_id, reportDir, repoRoot);
  const runContextPath = join(reportDir, "run-context.json");
  writeJSON(runContextPath, runContext);

  const records: ScenarioExecutionRecord[] = [];
  const resultsByScenario = new Map<string, ScenarioExecutionRecord>();
  let blockingInfraFailed = false;
  let servicesWereStarted = false;
  let teardownError: string | null = null;

  for (const scenario of scenarios) {
    const startedAtMs = nowMs();
    let status: ScenarioStatus = "passed";
    let exitCode: number | null = 0;
    let failureAssertion: string | null = null;
    let dependencyBlockReason: string | null = null;
    let artifactRefs: string[] = [];
    let logRefs: string[] = [];

    if (isFastScenario(scenario) && options.skipFast) {
      status = "skipped";
      dependencyBlockReason = "skipped via --skip-fast";
      exitCode = 0;
    } else if (scenario.domain_id !== "infra" && blockingInfraFailed) {
      status = "blocked";
      dependencyBlockReason = "A blocking infra scenario failed earlier in the run.";
      exitCode = null;
    } else {
      const failedDependency = scenario.requires
        .map((requiredId) => resultsByScenario.get(requiredId))
        .find((record) => !record || record.status === "failed" || record.status === "blocked");
      if (failedDependency) {
        status = "blocked";
        dependencyBlockReason = failedDependency
          ? `Dependency ${failedDependency.scenario_id} is ${failedDependency.status}.`
          : "A required dependency is missing.";
        exitCode = null;
      } else {
        const processResult = await executeScenario(scenario, runContext, reportDir);
        status = processResult.status;
        exitCode = processResult.exitCode;
        failureAssertion = processResult.failureAssertion;
        artifactRefs = processResult.artifactRefs;
        logRefs = processResult.logRefs;
      }
    }

    const finishedAtMs = nowMs();
    const record: ScenarioExecutionRecord = {
      domain_id: scenario.domain_id,
      scenario_id: scenario.scenario_id,
      adapter: scenario.adapter,
      blocking: scenario.blocking,
      platform: scenario.platform,
      tasks: scenario.tasks,
      tags: scenario.tags,
      status,
      exit_code: exitCode,
      started_at: new Date(startedAtMs).toISOString(),
      finished_at: new Date(finishedAtMs).toISOString(),
      duration_ms: finishedAtMs - startedAtMs,
      failure_assertion: failureAssertion,
      dependency_block_reason: dependencyBlockReason,
      artifact_refs: artifactRefs,
      log_refs: logRefs,
      metadata_path: join(reportDir, "metadata", `${scenario.scenario_id}.json`),
    };
    writeJSON(record.metadata_path, record);
    records.push(record);
    resultsByScenario.set(scenario.scenario_id, record);

    if (scenario.scenario_id === "infra.start-services" && status === "passed") {
      servicesWereStarted = true;
    }
    if (scenario.domain_id === "infra" && scenario.blocking && status === "failed") {
      blockingInfraFailed = true;
    }
  }

  if (servicesWereStarted && !options.keepRunning) {
    const stopScript = resolve(dirname(resolved.index_path), "../stop-services.sh");
    const result = spawnSync("bash", ["-lc", stopScript], {
      cwd: dirname(stopScript),
      encoding: "utf8",
    });
    if (result.status !== 0) {
      teardownError = (result.stderr || result.stdout || "stop-services failed").trim();
    }
  }

  const domains = buildDomainRecords(resolved, records);
  const finishedAt = isoNow();
  const overallStatus = teardownError ? "failed" : rollupStatuses(domains.map((domain) => domain.status));
  const report: AggregateReport = {
    suite_id: resolved.suite.suite_id,
    generated_at: isoNow(),
    started_at: startedAt,
    finished_at: finishedAt,
    status: overallStatus,
    keep_running: options.keepRunning,
    report_dir: reportDir,
    json_path: jsonPath,
    junit_path: junitPath,
    run_context_path: runContextPath,
    domains,
    scenarios: records,
    phases: [
      ...records.map(recordToPhase),
      ...(teardownError
        ? [{
            phase: "teardown",
            status: "failed" as const,
            duration_ms: 0,
            error: teardownError,
          }]
        : []),
    ],
  };

  writeWorkbenchReports(report);
  return report;
}
