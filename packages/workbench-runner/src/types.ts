export type AdapterKind = "noop" | "shell" | "bun" | "swift" | "xcodebuild";

export type ScenarioStatus = "passed" | "failed" | "blocked" | "skipped";

export type CommandAdapterConfig = {
  command: string;
  cwd: string;
  env?: Record<string, string>;
  timeout_ms?: number;
  blocked_exit_codes?: number[];
};

export type XcodebuildAdapterConfig = {
  scheme: string;
  destination: string;
  only_testing?: string;
  env?: Record<string, string>;
  timeout_ms?: number;
  destination_env?: string;
  project?: string;
};

export type ScenarioConfig = CommandAdapterConfig | XcodebuildAdapterConfig;

export type ScenarioManifest = {
  domain_id: string;
  scenario_id: string;
  adapter: AdapterKind;
  order: number;
  blocking: boolean;
  platform: string;
  requires: string[];
  tasks: string[];
  tags: string[];
  artifacts: string[];
  config: ScenarioConfig;
};

export type DomainManifest = {
  domain_id: string;
  description: string;
  scenarios: ScenarioManifest[];
};

export type SuiteDefinition = {
  suite_id: string;
  description: string;
  domain_order: string[];
  domain_manifests: Record<string, string>;
  include_tags?: string[];
  report_dir: string;
  json_path: string;
  junit_path: string;
};

export type SuiteIndex = {
  version: number;
  default_suite: string;
  suites: SuiteDefinition[];
};

export type ResolvedSuite = {
  index_path: string;
  suite: SuiteDefinition;
  domains: Map<string, DomainManifest>;
  scenarios: Map<string, ScenarioManifest>;
};

export type CLIOptions = {
  suiteId: string;
  domainFilters: string[];
  scenarioFilters: string[];
  platformFilters: string[];
  skipFast: boolean;
  keepRunning: boolean;
  reportDir?: string;
  jsonPath?: string;
  junitPath?: string;
  listOnly: boolean;
  dryRun: boolean;
  suiteIndexPath?: string;
  repoRoot?: string;
};

export type WorkbenchScenarioRunStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export type WorkbenchScenarioOverallStatus = "passed" | "failed" | "blocked" | "skipped";

export type WorkbenchScenarioRunConfig = {
  layerIds?: string[];
  scenarioIds?: string[];
  providerIds?: string[];
};

export type WorkbenchScenarioLayer = {
  layerId: string;
  name: string;
  description?: string;
  scenarioIds: string[];
};

export type WorkbenchScenario = {
  scenarioId: string;
  layerId: string;
  name: string;
  description?: string;
  tags: string[];
  requiredCapabilities: string[];
  defaultEnabled: boolean;
};

export type WorkbenchScenarioCatalog = {
  layers: WorkbenchScenarioLayer[];
  scenarios: WorkbenchScenario[];
};

export type ScenarioExecutionRecord = {
  domain_id: string;
  scenario_id: string;
  adapter: AdapterKind;
  blocking: boolean;
  platform: string;
  tasks: string[];
  tags: string[];
  status: ScenarioStatus;
  exit_code: number | null;
  started_at: string | null;
  finished_at: string | null;
  duration_ms: number;
  failure_assertion: string | null;
  dependency_block_reason: string | null;
  artifact_refs: string[];
  log_refs: string[];
  metadata_path: string;
};

export type DomainExecutionRecord = {
  domain_id: string;
  description: string;
  status: ScenarioStatus;
  scenarios: ScenarioExecutionRecord[];
};

export type AggregateReport = {
  suite_id: string;
  generated_at: string;
  started_at: string;
  finished_at: string;
  status: ScenarioStatus;
  keep_running: boolean;
  report_dir: string;
  json_path: string;
  junit_path: string;
  run_context_path: string;
  domains: DomainExecutionRecord[];
  scenarios: ScenarioExecutionRecord[];
  phases: Array<{
    phase: string;
    status: ScenarioStatus;
    duration_ms: number;
    error: string | null;
  }>;
};

export type RunContext = {
  suite_id: string;
  report_dir: string;
  artifact_root: string;
  repo_root: string;
  env: Record<string, string>;
};

export type ProcessResult = {
  status: ScenarioStatus;
  exitCode: number | null;
  failureAssertion: string | null;
  artifactRefs: string[];
  logRefs: string[];
};
