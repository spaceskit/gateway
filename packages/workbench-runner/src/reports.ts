import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type {
  AggregateReport,
  CLIOptions,
  DomainExecutionRecord,
  ResolvedSuite,
  ScenarioExecutionRecord,
  ScenarioStatus,
  SuiteDefinition,
} from "./types.js";

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function normalizePath(basePath: string, value: string): string {
  if (value.startsWith("/")) {
    return value;
  }
  return resolve(basePath, value);
}

export function ensureDir(path: string): void {
  mkdirSync(path, { recursive: true });
}

export function writeJSON(path: string, payload: unknown): void {
  ensureDir(dirname(path));
  writeFileSync(path, JSON.stringify(payload, null, 2));
}

export function rollupStatuses(statuses: ScenarioStatus[]): ScenarioStatus {
  if (statuses.includes("failed")) {
    return "failed";
  }
  if (statuses.includes("blocked")) {
    return "blocked";
  }
  if (statuses.every((status) => status === "skipped")) {
    return "skipped";
  }
  return "passed";
}

export function recordToPhase(record: ScenarioExecutionRecord): AggregateReport["phases"][number] {
  return {
    phase: record.scenario_id,
    status: record.status,
    duration_ms: record.duration_ms,
    error: record.failure_assertion,
  };
}

export function buildDomainRecords(
  resolved: ResolvedSuite,
  records: ScenarioExecutionRecord[],
): DomainExecutionRecord[] {
  const byDomain = new Map<string, ScenarioExecutionRecord[]>();
  for (const record of records) {
    const bucket = byDomain.get(record.domain_id) ?? [];
    bucket.push(record);
    byDomain.set(record.domain_id, bucket);
  }

  return resolved.suite.domain_order.map((domainId) => {
    const manifest = resolved.domains.get(domainId);
    const scenarios = byDomain.get(domainId) ?? [];
    return {
      domain_id: domainId,
      description: manifest?.description ?? domainId,
      status: scenarios.length ? rollupStatuses(scenarios.map((scenario) => scenario.status)) : "skipped",
      scenarios,
    };
  });
}

function writeJUnit(report: AggregateReport): void {
  const suitesXml = report.domains.map((domain) => {
    const tests = domain.scenarios.length;
    const failures = domain.scenarios.filter((scenario) => scenario.status === "failed").length;
    const skipped = domain.scenarios.filter((scenario) => scenario.status === "blocked" || scenario.status === "skipped").length;
    const cases = domain.scenarios.map((scenario) => {
      const durationSeconds = (scenario.duration_ms / 1000).toFixed(3);
      const body = scenario.status === "failed"
        ? `<failure message="${escapeXml(scenario.failure_assertion ?? "failed")}">${escapeXml(scenario.failure_assertion ?? "")}</failure>`
        : scenario.status === "blocked" || scenario.status === "skipped"
          ? `<skipped message="${escapeXml(scenario.dependency_block_reason ?? scenario.failure_assertion ?? scenario.status)}" />`
          : "";
      return `<testcase classname="${escapeXml(domain.domain_id)}" name="${escapeXml(scenario.scenario_id)}" time="${durationSeconds}">${body}</testcase>`;
    }).join("");
    return `<testsuite name="${escapeXml(domain.domain_id)}" tests="${tests}" failures="${failures}" skipped="${skipped}">${cases}</testsuite>`;
  }).join("");
  ensureDir(dirname(report.junit_path));
  writeFileSync(
    report.junit_path,
    `<?xml version="1.0" encoding="UTF-8"?><testsuites name="${escapeXml(report.suite_id)}">${suitesXml}</testsuites>`,
  );
}

export function defaultOutputPaths(
  suite: SuiteDefinition,
  options: CLIOptions,
  repoRoot: string,
): {
  reportDir: string;
  jsonPath: string;
  junitPath: string;
} {
  const reportDir = normalizePath(repoRoot, options.reportDir ?? suite.report_dir);
  return {
    reportDir,
    jsonPath: normalizePath(repoRoot, options.jsonPath ?? suite.json_path),
    junitPath: normalizePath(repoRoot, options.junitPath ?? suite.junit_path),
  };
}

export function writeWorkbenchReports(report: AggregateReport): void {
  writeJSON(report.json_path, report);
  writeJSON(join(dirname(report.json_path), `${report.suite_id}-latest.json`), report);
  writeJUnit(report);
}
