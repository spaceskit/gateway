import { basename } from "node:path";
import type { Database } from "bun:sqlite";
import type { GatewayInstance } from "../packages/bootstrap/src/index.js";
import type { GatewayEvent } from "../packages/core/src/events/event-bus.js";
import { saveJsonReport, type LayerResult, type ScenarioResult, type WorkbenchReport } from "./report.js";
import { WorkbenchExecutionGate } from "./execution-gate.js";
import type {
  WorkbenchJobConfig,
  WorkbenchJobEvent,
  WorkbenchJobPreset,
  WorkbenchJobRun,
  WorkbenchJobRunDetail,
  WorkbenchJobRunStatus,
  WorkbenchLiveLayerState,
  WorkbenchLiveMessage,
  WorkbenchQueueSnapshot,
  WorkbenchRunSnapshotData,
} from "./runner-protocol.js";

const TERMINAL_RUN_STATUSES = new Set<WorkbenchJobRunStatus>([
  "cancelled",
  "completed",
  "failed",
  "interrupted",
]);
const INTERRUPTIBLE_RUN_STATUSES = new Set<WorkbenchJobRunStatus>([
  "starting",
  "running",
  "cancelling",
]);
const RELEVANT_GATEWAY_EVENT_TYPES = new Set([
  "space.turn_started",
  "space.turn_event",
  "space.orchestrator_event",
  "task.completed",
  "task.failed",
  "task.input-required",
]);

interface RunRow {
  id: string;
  preset_id: string | null;
  name: string;
  source: string;
  status: WorkbenchJobRunStatus;
  queue_rank: number | null;
  config_json: string;
  snapshot_json: string;
  report_filename: string | null;
  report_path: string | null;
  exit_summary: string | null;
  overall_status: WorkbenchReport["overall"] | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  updated_at: string;
}

interface PresetRow {
  id: string;
  name: string;
  layers_json: string;
  providers_json: string;
  created_at: string;
  updated_at: string;
}

interface EventRow {
  event_id: string;
  run_id: string;
  seq: number;
  stream: "runner" | "gateway";
  kind: string;
  payload_json: string;
  created_at: string;
}

interface ActiveRunContext {
  abortController: AbortController;
  knownSpaceIds: Set<string>;
  knownTurns: Map<string, string>;
  unsubscribeGateway?: () => void;
}

export interface WorkbenchLayerCatalogEntry {
  name: string;
  scenarios: string[];
}

export interface WorkbenchRunExecutorContext {
  runId: string;
  config: WorkbenchJobConfig;
  signal: AbortSignal;
  registerSpace: (spaceId: string) => void;
  registerTurn: (spaceId: string, turnId: string) => void;
  updateMessage: (message: string | undefined) => void;
  onLayerStarted: (layerName: string) => void;
  onLayerCompleted: (layer: LayerResult) => void;
  onScenarioStarted: (layerName: string, scenarioName: string) => void;
  onScenarioCompleted: (layerName: string, scenario: ScenarioResult) => void;
  onProviderParityRow: (row: WorkbenchRunSnapshotData["providerParity"][number]) => void;
  onSchedulerEvalRun: (run: WorkbenchRunSnapshotData["schedulerEvalRuns"][number]) => void;
  onComparison: (comparison: WorkbenchRunSnapshotData["comparisons"][number]) => void;
}

export interface WorkbenchRunExecutorResult {
  report: WorkbenchReport;
}

export type WorkbenchRunExecutor = (
  context: WorkbenchRunExecutorContext,
) => Promise<WorkbenchRunExecutorResult>;

export interface WorkbenchRunnerServiceOptions {
  db: Database;
  reportsDir: string;
  executor: WorkbenchRunExecutor;
  gateway?: GatewayInstance | null;
  layerCatalog?: WorkbenchLayerCatalogEntry[];
  defaultLayers?: string[];
  executionGate?: WorkbenchExecutionGate;
}

export class WorkbenchRunnerService {
  private readonly db: Database;
  private readonly reportsDir: string;
  private readonly executor: WorkbenchRunExecutor;
  private readonly gateway: GatewayInstance | null;
  private readonly layerCatalog: WorkbenchLayerCatalogEntry[];
  private readonly knownLayerNames: Set<string>;
  private readonly defaultLayers: string[];
  private readonly executionGate: WorkbenchExecutionGate;
  private readonly listeners = new Set<(message: WorkbenchLiveMessage) => void>();
  private readonly activeRuns = new Map<string, ActiveRunContext>();
  private activeRunId: string | null = null;
  private queueLoopRunning = false;
  private queueScheduled = false;
  private closed = false;
  private unsubscribeExecutionGate?: () => void;

  constructor(options: WorkbenchRunnerServiceOptions) {
    this.db = options.db;
    this.reportsDir = options.reportsDir;
    this.executor = options.executor;
    this.gateway = options.gateway ?? null;
    this.layerCatalog = options.layerCatalog ?? [];
    this.knownLayerNames = new Set(this.layerCatalog.map((layer) => layer.name));
    this.defaultLayers = options.defaultLayers ?? this.layerCatalog.map((layer) => layer.name);
    this.executionGate = options.executionGate ?? new WorkbenchExecutionGate();
  }

  initialize(): void {
    this.closed = false;
    this.ensureSchema();
    this.db.transaction(() => {
      this.db.query(`
        UPDATE workbench_job_runs
           SET status = 'interrupted',
               queue_rank = NULL,
               finished_at = COALESCE(finished_at, ?1),
               updated_at = ?1,
               exit_summary = COALESCE(exit_summary, 'Workbench runner restarted while this run was active.')
         WHERE status IN ('starting', 'running', 'cancelling')
      `).run(nowIso());
    })();
    this.activeRunId = this.getActiveRunFromDb()?.id ?? null;
    this.unsubscribeExecutionGate?.();
    this.unsubscribeExecutionGate = this.executionGate.subscribe(() => this.scheduleQueueProcessing());
    this.scheduleQueueProcessing();
  }

  async shutdown(): Promise<void> {
    this.closed = true;
    this.queueScheduled = false;
    this.unsubscribeExecutionGate?.();
    this.unsubscribeExecutionGate = undefined;
    const activeRunId = this.activeRunId;
    if (!activeRunId) {
      return;
    }
    const active = this.activeRuns.get(activeRunId);
    active?.unsubscribeGateway?.();
    active?.abortController.abort();
    this.activeRuns.delete(activeRunId);
    this.executionGate.release(`run:${activeRunId}`);
    this.db.query(`
      UPDATE workbench_job_runs
         SET status = 'interrupted',
             queue_rank = NULL,
             finished_at = COALESCE(finished_at, ?2),
             updated_at = ?2,
             exit_summary = COALESCE(exit_summary, ?1)
       WHERE id = ?3 AND status IN ('starting', 'running', 'cancelling')
    `).run("Workbench stopped while this run was active.", nowIso(), activeRunId);
    this.activeRunId = null;
    this.emitSnapshot();
  }

  subscribe(listener: (message: WorkbenchLiveMessage) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  createPreset(input: {
    name: string;
    layers?: string[];
    providers?: string[];
  }): WorkbenchJobPreset {
    const timestamp = nowIso();
    const preset = {
      id: crypto.randomUUID(),
      name: normalizeName(input.name, "Workbench Preset"),
      layers: this.normalizeLayers(input.layers),
      providers: this.normalizeProviders(input.providers),
      createdAt: timestamp,
      updatedAt: timestamp,
    } satisfies WorkbenchJobPreset;

    this.db.query(`
      INSERT INTO workbench_job_presets (
        id, name, layers_json, providers_json, created_at, updated_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
    `).run(
      preset.id,
      preset.name,
      JSON.stringify(preset.layers),
      JSON.stringify(preset.providers),
      preset.createdAt,
      preset.updatedAt,
    );
    this.emit({ type: "preset.created", preset });
    this.emitSnapshot();
    return preset;
  }

  updatePreset(
    presetId: string,
    input: {
      name?: string;
      layers?: string[];
      providers?: string[];
    },
  ): WorkbenchJobPreset {
    const current = this.getPresetOrThrow(presetId);
    const preset = {
      ...current,
      ...(input.name !== undefined ? { name: normalizeName(input.name, current.name) } : {}),
      ...(input.layers !== undefined ? { layers: this.normalizeLayers(input.layers) } : {}),
      ...(input.providers !== undefined ? { providers: this.normalizeProviders(input.providers) } : {}),
      updatedAt: nowIso(),
    } satisfies WorkbenchJobPreset;

    this.db.query(`
      UPDATE workbench_job_presets
         SET name = ?2,
             layers_json = ?3,
             providers_json = ?4,
             updated_at = ?5
       WHERE id = ?1
    `).run(
      preset.id,
      preset.name,
      JSON.stringify(preset.layers),
      JSON.stringify(preset.providers),
      preset.updatedAt,
    );
    this.emit({ type: "preset.updated", preset });
    this.emitSnapshot();
    return preset;
  }

  deletePreset(presetId: string): void {
    this.getPresetOrThrow(presetId);
    this.db.query("DELETE FROM workbench_job_presets WHERE id = ?1").run(presetId);
    this.emit({ type: "preset.deleted", presetId });
    this.emitSnapshot();
  }

  listPresets(): WorkbenchJobPreset[] {
    const rows = this.db.query(`
      SELECT id, name, layers_json, providers_json, created_at, updated_at
        FROM workbench_job_presets
       ORDER BY updated_at DESC, created_at DESC
    `).all() as PresetRow[];
    return rows.map(deserializePresetRow);
  }

  queueRun(input: {
    name?: string;
    layers?: string[];
    providers?: string[];
    presetId?: string;
    source?: WorkbenchJobRun["source"];
  }): WorkbenchJobRun {
    return this.enqueueRun(input, "queue");
  }

  runNow(input: {
    name?: string;
    layers?: string[];
    providers?: string[];
    presetId?: string;
    source?: WorkbenchJobRun["source"];
  }): WorkbenchJobRun {
    return this.enqueueRun(input, "run_now");
  }

  queuePresetRun(presetId: string): WorkbenchJobRun {
    const preset = this.getPresetOrThrow(presetId);
    return this.queueRun({
      name: preset.name,
      layers: preset.layers,
      providers: preset.providers,
      presetId,
      source: "preset",
    });
  }

  runPresetNow(presetId: string): WorkbenchJobRun {
    const preset = this.getPresetOrThrow(presetId);
    return this.runNow({
      name: preset.name,
      layers: preset.layers,
      providers: preset.providers,
      presetId,
      source: "preset",
    });
  }

  retryRun(runId: string): WorkbenchJobRun {
    const run = this.getRunOrThrow(runId);
    return this.runNow({
      name: run.name,
      layers: run.config.layers,
      providers: run.config.providers,
      presetId: run.presetId,
      source: "retry",
    });
  }

  async cancelRun(runId: string): Promise<WorkbenchJobRun | null> {
    const run = this.getRunDetail(runId);
    if (!run || TERMINAL_RUN_STATUSES.has(run.status)) {
      return run;
    }

    if (run.status === "queued") {
      const timestamp = nowIso();
      this.db.query(`
        UPDATE workbench_job_runs
           SET status = 'cancelled',
               queue_rank = NULL,
               finished_at = ?2,
               updated_at = ?2,
               exit_summary = 'Cancelled before execution started.'
         WHERE id = ?1
      `).run(runId, timestamp);
      const updated = this.getRunOrThrow(runId);
      this.recordRunEvent(runId, "runner", "run.cancelled", {
        status: updated.status,
      });
      this.emit({ type: "run.updated", run: updated });
      this.emitSnapshot();
      return updated;
    }

    if (!["starting", "running", "cancelling"].includes(run.status)) {
      return run;
    }

    const timestamp = nowIso();
    this.db.query(`
      UPDATE workbench_job_runs
         SET status = 'cancelling',
             updated_at = ?2,
             exit_summary = 'Cancellation requested.'
       WHERE id = ?1
    `).run(runId, timestamp);
    const updated = this.getRunOrThrow(runId);
    this.recordRunEvent(runId, "runner", "run.cancelling", {
      status: updated.status,
    });
    const active = this.activeRuns.get(runId);
    active?.abortController.abort();
    if (this.gateway) {
      for (const [turnId, spaceId] of active?.knownTurns ?? []) {
        void this.gateway.spaceManager.cancelTurn(spaceId, turnId);
      }
    }
    this.emit({ type: "run.updated", run: updated });
    this.emitSnapshot();
    return updated;
  }

  getSnapshot(): WorkbenchQueueSnapshot {
    return {
      presets: this.listPresets(),
      ...(this.getActiveRunFromDb() ? { activeRun: this.getActiveRunFromDb()! } : {}),
      queuedRuns: this.listQueuedRuns(),
      recentRuns: this.listRecentRuns(),
    };
  }

  listRuns(): WorkbenchJobRun[] {
    const rows = this.db.query(`
      SELECT *
        FROM workbench_job_runs
       ORDER BY created_at DESC
    `).all() as RunRow[];
    return rows.map((row) => deserializeRunRow(row));
  }

  getRunDetail(runId: string): WorkbenchJobRunDetail | null {
    const row = this.db.query("SELECT * FROM workbench_job_runs WHERE id = ?1").get(runId) as RunRow | null;
    if (!row) return null;
    const run = deserializeRunRow(row);
    const snapshot = parseJson<WorkbenchRunSnapshotData>(row.snapshot_json, emptySnapshot(this.layerCatalog, run.config.layers));
    const events = this.db.query(`
      SELECT event_id, run_id, seq, stream, kind, payload_json, created_at
        FROM workbench_job_events
       WHERE run_id = ?1
       ORDER BY seq ASC
    `).all(runId) as EventRow[];

    const runnerEvents = events
      .filter((event) => event.stream === "runner")
      .map(deserializeEventRow);
    const gatewayEvents = events
      .filter((event) => event.stream === "gateway")
      .map(deserializeEventRow);

    return {
      ...run,
      snapshot,
      runnerEvents,
      gatewayEvents,
    };
  }

  waitForRunCompletion(runId: string, timeoutMs = 30_000): Promise<WorkbenchJobRun> {
    const current = this.getRunOrThrow(runId);
    if (TERMINAL_RUN_STATUSES.has(current.status)) {
      return Promise.resolve(current);
    }

    return new Promise<WorkbenchJobRun>((resolve, reject) => {
      const timer = setTimeout(() => {
        unsubscribe();
        reject(new Error(`Timed out waiting for run ${runId} to complete.`));
      }, timeoutMs);
      const unsubscribe = this.subscribe((message) => {
        if (message.type !== "run.updated" || message.run.id !== runId) return;
        if (!TERMINAL_RUN_STATUSES.has(message.run.status)) return;
        clearTimeout(timer);
        unsubscribe();
        resolve(message.run);
      });
    });
  }

  emitSnapshot(): void {
    this.emit({
      type: "snapshot",
      snapshot: this.getSnapshot(),
    });
  }

  private emit(message: WorkbenchLiveMessage): void {
    for (const listener of this.listeners) {
      listener(message);
    }
  }

  private enqueueRun(
    input: {
      name?: string;
      layers?: string[];
      providers?: string[];
      presetId?: string;
      source?: WorkbenchJobRun["source"];
    },
    mode: "queue" | "run_now",
  ): WorkbenchJobRun {
    if (input.presetId) {
      this.getPresetOrThrow(input.presetId);
    }
    const timestamp = nowIso();
    const config = this.normalizeConfig({
      name: input.name,
      layers: input.layers,
      providers: input.providers,
    });
    const run = {
      id: crypto.randomUUID(),
      ...(input.presetId ? { presetId: input.presetId } : {}),
      name: normalizeName(config.name, "Workbench Run"),
      source: input.source ?? (input.presetId ? "preset" : "ad_hoc"),
      status: "queued" as const,
      config,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    this.db.transaction(() => {
      let queueRank = 1;
      if (mode === "run_now") {
        this.db.query(`
          UPDATE workbench_job_runs
             SET queue_rank = queue_rank + 1,
                 updated_at = ?1
           WHERE status = 'queued' AND queue_rank IS NOT NULL
        `).run(timestamp);
      } else {
        const row = this.db.query(`
          SELECT COALESCE(MAX(queue_rank), 0) AS value
            FROM workbench_job_runs
           WHERE status = 'queued'
        `).get() as { value?: number } | null;
        queueRank = (row?.value ?? 0) + 1;
      }

      this.db.query(`
        INSERT INTO workbench_job_runs (
          id, preset_id, name, source, status, queue_rank, config_json, snapshot_json, report_filename,
          report_path, exit_summary, overall_status, created_at, started_at, finished_at, updated_at
        ) VALUES (?1, ?2, ?3, ?4, 'queued', ?5, ?6, ?7, NULL, NULL, NULL, NULL, ?8, NULL, NULL, ?8)
      `).run(
        run.id,
        input.presetId ?? null,
        run.name,
        run.source,
        queueRank,
        JSON.stringify(run.config),
        JSON.stringify(emptySnapshot(this.layerCatalog, run.config.layers)),
        timestamp,
      );
    })();

    const queuedRun = this.getRunOrThrow(run.id);
    this.recordRunEvent(run.id, "runner", "run.queued", {
      mode,
      queueRank: queuedRun.queueRank,
    });
    this.emit({ type: "run.updated", run: queuedRun });
    this.emitSnapshot();
    if (!this.closed && !this.queueLoopRunning && !this.activeRunId) {
      void this.processQueue();
    } else {
      this.scheduleQueueProcessing();
    }
    return queuedRun;
  }

  private normalizeConfig(input: {
    name?: string;
    layers?: string[];
    providers?: string[];
  }): WorkbenchJobConfig {
    return {
      ...(input.name?.trim() ? { name: input.name.trim() } : {}),
      layers: this.normalizeLayers(input.layers),
      providers: this.normalizeProviders(input.providers),
    };
  }

  private normalizeLayers(layers?: string[]): string[] {
    const source = layers && layers.length > 0 ? layers : this.defaultLayers;
    const normalized = dedupeStrings(source);
    if (normalized.length === 0) {
      throw new Error("Workbench jobs require at least one layer.");
    }
    if (this.knownLayerNames.size > 0) {
      const unknown = normalized.filter((layer) => !this.knownLayerNames.has(layer));
      if (unknown.length > 0) {
        throw new Error(`Unknown workbench layers: ${unknown.join(", ")}`);
      }
    }
    return normalized;
  }

  private normalizeProviders(providers?: string[]): string[] {
    return dedupeStrings((providers ?? []).map((provider) => provider.toLowerCase()));
  }

  private ensureSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS workbench_job_presets (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        layers_json TEXT NOT NULL,
        providers_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS workbench_job_runs (
        id TEXT PRIMARY KEY,
        preset_id TEXT,
        name TEXT NOT NULL,
        source TEXT NOT NULL,
        status TEXT NOT NULL,
        queue_rank INTEGER,
        config_json TEXT NOT NULL,
        snapshot_json TEXT NOT NULL DEFAULT '{}',
        report_filename TEXT,
        report_path TEXT,
        exit_summary TEXT,
        overall_status TEXT,
        created_at TEXT NOT NULL,
        started_at TEXT,
        finished_at TEXT,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_workbench_job_runs_status_queue
        ON workbench_job_runs(status, queue_rank, created_at);

      CREATE TABLE IF NOT EXISTS workbench_job_events (
        event_id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        stream TEXT NOT NULL,
        kind TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_workbench_job_events_run_seq
        ON workbench_job_events(run_id, seq);
    `);
  }

  private async processQueue(): Promise<void> {
    if (this.closed || this.queueLoopRunning || this.activeRunId) {
      return;
    }

    const nextRun = this.db.query(`
      SELECT *
        FROM workbench_job_runs
       WHERE status = 'queued'
       ORDER BY queue_rank ASC, created_at ASC
       LIMIT 1
    `).get() as RunRow | null;
    if (!nextRun) {
      return;
    }
    if (!this.executionGate.tryAcquire(`run:${nextRun.id}`)) {
      return;
    }

    this.queueLoopRunning = true;
    const startedAt = nowIso();
    const abortController = new AbortController();
    this.activeRunId = nextRun.id;
    this.activeRuns.set(nextRun.id, {
      abortController,
      knownSpaceIds: new Set<string>(),
      knownTurns: new Map<string, string>(),
    });

    this.db.query(`
      UPDATE workbench_job_runs
         SET status = 'starting',
             queue_rank = NULL,
             started_at = COALESCE(started_at, ?2),
             updated_at = ?2
       WHERE id = ?1
    `).run(nextRun.id, startedAt);
    let run = this.getRunOrThrow(nextRun.id);
    this.recordRunEvent(run.id, "runner", "run.starting", {
      status: run.status,
    });
    this.emit({ type: "run.updated", run });
    this.emitSnapshot();

    const activeContext = this.activeRuns.get(run.id)!;
    this.attachGatewayCapture(run.id, activeContext);
    this.updateRunStatus(run.id, "running", { updatedAt: nowIso() });
    run = this.getRunOrThrow(run.id);
    this.recordRunEvent(run.id, "runner", "run.running", {
      status: run.status,
    });
    this.emit({ type: "run.updated", run });
    this.emitSnapshot();

    try {
      const result = await this.executor({
        runId: run.id,
        config: run.config,
        signal: abortController.signal,
        registerSpace: (spaceId) => this.registerSpace(run.id, spaceId),
        registerTurn: (spaceId, turnId) => this.registerTurn(run.id, spaceId, turnId),
        updateMessage: (message) => this.updateRunSnapshot(run.id, (snapshot) => ({
          ...snapshot,
          ...(message ? { message } : { message: undefined }),
        })),
        onLayerStarted: (layerName) => this.markLayerStarted(run.id, layerName),
        onLayerCompleted: (layer) => this.markLayerCompleted(run.id, layer),
        onScenarioStarted: (layerName, scenarioName) => this.markScenarioStarted(run.id, layerName, scenarioName),
        onScenarioCompleted: (layerName, scenario) => this.markScenarioCompleted(run.id, layerName, scenario),
        onProviderParityRow: (row) => this.addProviderParityRow(run.id, row),
        onSchedulerEvalRun: (schedulerEvalRun) => this.addSchedulerEvalRun(run.id, schedulerEvalRun),
        onComparison: (comparison) => this.addComparison(run.id, comparison),
      });

      if (this.closed) {
        return;
      }

      if (abortController.signal.aborted || this.getRunOrThrow(run.id).status === "cancelling") {
        const cancelled = this.finalizeCancelledRun(run.id, "Run cancelled while executing.");
        this.emit({ type: "run.updated", run: cancelled });
        this.emitSnapshot();
        return;
      }

      const reportPath = await saveJsonReport(result.report, this.reportsDir);
      const reportFilename = basename(reportPath);
      const finishedAt = nowIso();
      const startedAtValue = run.startedAt ?? finishedAt;
      const durationMs = Date.parse(finishedAt) - Date.parse(startedAtValue);
      const status: WorkbenchJobRunStatus = result.report.overall === "pass" ? "completed" : "failed";
      this.db.query(`
        UPDATE workbench_job_runs
           SET status = ?2,
               report_filename = ?3,
               report_path = ?4,
               overall_status = ?5,
               exit_summary = ?6,
               finished_at = ?7,
               updated_at = ?7
         WHERE id = ?1
      `).run(
        run.id,
        status,
        reportFilename,
        reportPath,
        result.report.overall,
        status === "completed"
          ? "Run completed successfully."
          : "Run completed with failing checks.",
        finishedAt,
      );

      const completedRun = this.getRunOrThrow(run.id);
      this.recordRunEvent(run.id, "runner", status === "completed" ? "run.completed" : "run.failed", {
        overallStatus: result.report.overall,
      });
      this.emit({ type: "run.updated", run: completedRun });
      this.emit({
        type: "report.saved",
        runId: run.id,
        reportPath,
        reportFilename,
      });
      this.emitSnapshot();
    } catch (error) {
      if (this.closed) {
        return;
      }
      if (abortController.signal.aborted || this.getRunOrThrow(run.id).status === "cancelling" || isAbortError(error)) {
        const cancelled = this.finalizeCancelledRun(run.id, "Run cancelled while executing.");
        this.emit({ type: "run.updated", run: cancelled });
        this.emitSnapshot();
      } else {
        const failed = this.finalizeFailedRun(run.id, error instanceof Error ? error.message : String(error));
        this.emit({ type: "run.updated", run: failed });
        this.emitSnapshot();
      }
    } finally {
      activeContext.unsubscribeGateway?.();
      this.activeRuns.delete(run.id);
      this.activeRunId = null;
      this.executionGate.release(`run:${run.id}`);
      this.queueLoopRunning = false;
      this.scheduleQueueProcessing();
    }
  }

  private scheduleQueueProcessing(): void {
    if (this.closed || this.queueScheduled) {
      return;
    }
    this.queueScheduled = true;
    queueMicrotask(() => {
      this.queueScheduled = false;
      if (this.closed) {
        return;
      }
      void this.processQueue();
    });
  }

  private finalizeCancelledRun(runId: string, summary: string): WorkbenchJobRun {
    const finishedAt = nowIso();
    this.db.query(`
      UPDATE workbench_job_runs
         SET status = 'cancelled',
             finished_at = ?2,
             updated_at = ?2,
             exit_summary = ?3
       WHERE id = ?1
    `).run(runId, finishedAt, summary);
    const cancelled = this.getRunOrThrow(runId);
    this.recordRunEvent(runId, "runner", "run.cancelled", {
      status: cancelled.status,
      summary,
    });
    return cancelled;
  }

  private finalizeFailedRun(runId: string, summary: string): WorkbenchJobRun {
    const finishedAt = nowIso();
    this.db.query(`
      UPDATE workbench_job_runs
         SET status = 'failed',
             overall_status = 'fail',
             finished_at = ?2,
             updated_at = ?2,
             exit_summary = ?3
       WHERE id = ?1
    `).run(runId, finishedAt, summary);
    const failed = this.getRunOrThrow(runId);
    this.recordRunEvent(runId, "runner", "run.failed", {
      status: failed.status,
      summary,
    });
    return failed;
  }

  private updateRunStatus(
    runId: string,
    status: WorkbenchJobRunStatus,
    options: { updatedAt?: string } = {},
  ): void {
    const timestamp = options.updatedAt ?? nowIso();
    this.db.query(`
      UPDATE workbench_job_runs
         SET status = ?2,
             updated_at = ?3
       WHERE id = ?1
    `).run(runId, status, timestamp);
  }

  private updateRunSnapshot(
    runId: string,
    updater: (snapshot: WorkbenchRunSnapshotData) => WorkbenchRunSnapshotData,
  ): void {
    const detail = this.getRunDetail(runId);
    if (!detail) return;
    const snapshot = updater(detail.snapshot);
    this.db.query(`
      UPDATE workbench_job_runs
         SET snapshot_json = ?2,
             updated_at = ?3
       WHERE id = ?1
    `).run(runId, JSON.stringify(snapshot), nowIso());
    this.emit({
      type: "run.updated",
      run: this.getRunOrThrow(runId),
    });
  }

  private markLayerStarted(runId: string, layerName: string): void {
    this.updateRunSnapshot(runId, (snapshot) => ({
      ...snapshot,
      activeLayerName: layerName,
      layers: snapshot.layers.map((layer) =>
        layer.name === layerName
          ? {
            ...layer,
            status: "running",
            startedAt: layer.startedAt ?? nowIso(),
          }
          : layer,
      ),
    }));
    this.recordRunEvent(runId, "runner", "layer.started", { layerName });
  }

  private markLayerCompleted(runId: string, layer: LayerResult): void {
    this.updateRunSnapshot(runId, (snapshot) => ({
      ...snapshot,
      layers: mergeLayerResult(snapshot.layers, layer),
      activeLayerName: snapshot.activeLayerName === layer.name ? undefined : snapshot.activeLayerName,
    }));
    this.recordRunEvent(runId, "runner", "layer.completed", {
      layerName: layer.name,
      status: layer.status,
    });
  }

  private markScenarioStarted(runId: string, layerName: string, scenarioName: string): void {
    this.updateRunSnapshot(runId, (snapshot) => ({
      ...snapshot,
      activeLayerName: layerName,
      activeScenarioName: scenarioName,
      layers: snapshot.layers.map((layer) =>
        layer.name !== layerName
          ? layer
          : {
            ...layer,
            status: layer.status === "pending" ? "running" : layer.status,
            startedAt: layer.startedAt ?? nowIso(),
            scenarios: layer.scenarios.map((scenario) =>
              scenario.name === scenarioName
                ? {
                  ...scenario,
                  status: "running",
                  startedAt: scenario.startedAt ?? nowIso(),
                }
                : scenario,
            ),
          }
      ),
    }));
    this.recordRunEvent(runId, "runner", "scenario.started", { layerName, scenarioName });
  }

  private markScenarioCompleted(runId: string, layerName: string, scenario: ScenarioResult): void {
    this.updateRunSnapshot(runId, (snapshot) => ({
      ...snapshot,
      activeScenarioName: snapshot.activeScenarioName === scenario.name ? undefined : snapshot.activeScenarioName,
      layers: snapshot.layers.map((layer) =>
        layer.name !== layerName
          ? layer
          : {
            ...layer,
            scenarios: mergeScenarioResult(layer.scenarios, scenario),
          }
      ),
    }));
    this.recordRunEvent(runId, "runner", "scenario.completed", {
      layerName,
      scenarioName: scenario.name,
      status: scenario.status,
    });
  }

  private addProviderParityRow(runId: string, row: WorkbenchRunSnapshotData["providerParity"][number]): void {
    this.updateRunSnapshot(runId, (snapshot) => ({
      ...snapshot,
      providerParity: [...snapshot.providerParity, row],
    }));
    this.recordRunEvent(runId, "runner", "provider-parity.updated", {
      provider: row.provider,
      model: row.model,
      status: row.status,
    });
  }

  private addSchedulerEvalRun(runId: string, schedulerEvalRun: WorkbenchRunSnapshotData["schedulerEvalRuns"][number]): void {
    this.updateRunSnapshot(runId, (snapshot) => ({
      ...snapshot,
      schedulerEvalRuns: [...snapshot.schedulerEvalRuns, schedulerEvalRun],
    }));
    this.recordRunEvent(runId, "runner", "scheduler-eval.updated", {
      evalRunId: extractStringField(schedulerEvalRun, "evalRunId") ?? extractNestedEvalRunId(schedulerEvalRun),
    });
  }

  private addComparison(runId: string, comparison: WorkbenchRunSnapshotData["comparisons"][number]): void {
    this.updateRunSnapshot(runId, (snapshot) => ({
      ...snapshot,
      comparisons: [...snapshot.comparisons, comparison],
    }));
    this.recordRunEvent(runId, "runner", "comparison.updated", {
      comparisonId: comparison.comparisonId,
      status: comparison.status,
    });
  }

  private registerSpace(runId: string, spaceId: string): void {
    const active = this.activeRuns.get(runId);
    if (!active || !spaceId.trim()) return;
    active.knownSpaceIds.add(spaceId.trim());
  }

  private registerTurn(runId: string, spaceId: string, turnId: string): void {
    const active = this.activeRuns.get(runId);
    if (!active || !turnId.trim() || !spaceId.trim()) return;
    active.knownSpaceIds.add(spaceId.trim());
    active.knownTurns.set(turnId.trim(), spaceId.trim());
  }

  private attachGatewayCapture(runId: string, active: ActiveRunContext): void {
    if (!this.gateway) {
      return;
    }
    active.unsubscribeGateway = this.gateway.eventBus.onAny((event) => {
      if (!RELEVANT_GATEWAY_EVENT_TYPES.has(event.type)) {
        return;
      }
      const normalized = normalizeGatewayEvent(event);
      const spaceId = typeof normalized.spaceId === "string" ? normalized.spaceId.trim() : "";
      if (spaceId && active.knownSpaceIds.size > 0 && !active.knownSpaceIds.has(spaceId)) {
        return;
      }
      this.recordRunEvent(runId, "gateway", event.type, normalized);
    });
  }

  private recordRunEvent(
    runId: string,
    stream: "runner" | "gateway",
    kind: string,
    payload: Record<string, unknown>,
  ): WorkbenchJobEvent {
    const createdAt = nowIso();
    const seqRow = this.db.query(`
      SELECT COALESCE(MAX(seq), 0) + 1 AS next_seq
        FROM workbench_job_events
       WHERE run_id = ?1
    `).get(runId) as { next_seq?: number } | null;
    const event = {
      eventId: crypto.randomUUID(),
      runId,
      seq: seqRow?.next_seq ?? 1,
      stream,
      kind,
      payload,
      createdAt,
    } satisfies WorkbenchJobEvent;
    this.db.query(`
      INSERT INTO workbench_job_events (
        event_id, run_id, seq, stream, kind, payload_json, created_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
    `).run(
      event.eventId,
      event.runId,
      event.seq,
      event.stream,
      event.kind,
      JSON.stringify(event.payload),
      event.createdAt,
    );
    this.emit({ type: "run.event", event });
    return event;
  }

  private getPresetOrThrow(presetId: string): WorkbenchJobPreset {
    const preset = this.db.query(`
      SELECT id, name, layers_json, providers_json, created_at, updated_at
        FROM workbench_job_presets
       WHERE id = ?1
    `).get(presetId) as PresetRow | null;
    if (!preset) {
      throw new Error(`Workbench preset ${presetId} not found.`);
    }
    return deserializePresetRow(preset);
  }

  private getRunOrThrow(runId: string): WorkbenchJobRun {
    const row = this.db.query("SELECT * FROM workbench_job_runs WHERE id = ?1").get(runId) as RunRow | null;
    if (!row) {
      throw new Error(`Workbench run ${runId} not found.`);
    }
    return deserializeRunRow(row);
  }

  private getActiveRunFromDb(): WorkbenchJobRun | null {
    const row = this.db.query(`
      SELECT *
        FROM workbench_job_runs
       WHERE status IN ('starting', 'running', 'cancelling')
       ORDER BY started_at DESC, created_at DESC
       LIMIT 1
    `).get() as RunRow | null;
    return row ? deserializeRunRow(row) : null;
  }

  private listQueuedRuns(): WorkbenchJobRun[] {
    const rows = this.db.query(`
      SELECT *
        FROM workbench_job_runs
       WHERE status = 'queued'
       ORDER BY queue_rank ASC, created_at ASC
    `).all() as RunRow[];
    return rows.map(deserializeRunRow);
  }

  private listRecentRuns(limit = 20): WorkbenchJobRun[] {
    const rows = this.db.query(`
      SELECT *
        FROM workbench_job_runs
       WHERE status IN ('cancelled', 'completed', 'failed', 'interrupted')
       ORDER BY COALESCE(finished_at, updated_at, created_at) DESC
       LIMIT ?1
    `).all(limit) as RunRow[];
    return rows.map(deserializeRunRow);
  }
}

function emptySnapshot(
  layerCatalog: WorkbenchLayerCatalogEntry[],
  selectedLayers: string[],
): WorkbenchRunSnapshotData {
  const layers = selectedLayers.map((name) => {
    const catalogEntry = layerCatalog.find((entry) => entry.name === name);
    return {
      name,
      status: "pending",
      scenarios: (catalogEntry?.scenarios ?? []).map((scenarioName) => ({
        name: scenarioName,
        status: "pending",
      })),
    } satisfies WorkbenchLiveLayerState;
  });
  return {
    layers,
    providerParity: [],
    schedulerEvalRuns: [],
    comparisons: [],
  };
}

function deserializePresetRow(row: PresetRow): WorkbenchJobPreset {
  return {
    id: row.id,
    name: row.name,
    layers: parseJson<string[]>(row.layers_json, []),
    providers: parseJson<string[]>(row.providers_json, []),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function deserializeRunRow(row: RunRow): WorkbenchJobRun {
  return {
    id: row.id,
    ...(row.preset_id ? { presetId: row.preset_id } : {}),
    name: row.name,
    source: row.source as WorkbenchJobRun["source"],
    status: row.status,
    config: parseJson<WorkbenchJobConfig>(row.config_json, { layers: [], providers: [] }),
    ...(typeof row.queue_rank === "number" ? { queueRank: row.queue_rank } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.started_at ? { startedAt: row.started_at } : {}),
    ...(row.finished_at ? { finishedAt: row.finished_at } : {}),
    ...(row.started_at && row.finished_at
      ? { durationMs: Date.parse(row.finished_at) - Date.parse(row.started_at) }
      : {}),
    ...(row.report_filename ? { reportFilename: row.report_filename } : {}),
    ...(row.report_path ? { reportPath: row.report_path } : {}),
    ...(row.exit_summary ? { exitSummary: row.exit_summary } : {}),
    ...(row.overall_status ? { overallStatus: row.overall_status } : {}),
  };
}

function deserializeEventRow(row: EventRow): WorkbenchJobEvent {
  return {
    eventId: row.event_id,
    runId: row.run_id,
    seq: row.seq,
    stream: row.stream,
    kind: row.kind,
    payload: parseJson<Record<string, unknown>>(row.payload_json, {}),
    createdAt: row.created_at,
  };
}

function mergeLayerResult(
  layers: WorkbenchRunSnapshotData["layers"],
  layerResult: LayerResult,
): WorkbenchRunSnapshotData["layers"] {
  return layers.map((layer) =>
    layer.name !== layerResult.name
      ? layer
      : {
        ...layer,
        status: layerResult.status,
        completedAt: nowIso(),
        durationMs: layerResult.duration_ms,
        scenarios: layerResult.scenarios.reduce<WorkbenchLiveLayerState["scenarios"]>(
          (acc, scenarioResult) => mergeScenarioResult(acc, scenarioResult),
          layer.scenarios,
        ),
      }
  );
}

function mergeScenarioResult(
  scenarios: WorkbenchLiveLayerState["scenarios"],
  scenarioResult: ScenarioResult,
): WorkbenchLiveLayerState["scenarios"] {
  const existing = scenarios.find((scenario) => scenario.name === scenarioResult.name);
  if (!existing) {
    return [
      ...scenarios,
      {
        name: scenarioResult.name,
        status: scenarioResult.status,
        startedAt: nowIso(),
        completedAt: nowIso(),
        durationMs: scenarioResult.duration_ms,
        ...(scenarioResult.error ? { error: scenarioResult.error } : {}),
      },
    ];
  }
  return scenarios.map((scenario) =>
    scenario.name !== scenarioResult.name
      ? scenario
      : {
        ...scenario,
        status: scenarioResult.status,
        completedAt: nowIso(),
        durationMs: scenarioResult.duration_ms,
        ...(scenarioResult.error ? { error: scenarioResult.error } : {}),
      }
  );
}

function normalizeGatewayEvent(event: GatewayEvent): Record<string, unknown> {
  const record = event as GatewayEvent & Record<string, unknown>;
  const payload = typeof record.event === "object" && record.event !== null && !Array.isArray(record.event)
    ? record.event as Record<string, unknown>
    : {};
  return {
    eventType: event.type,
    observedAt: event.timestamp instanceof Date ? event.timestamp.toISOString() : nowIso(),
    ...(typeof record.spaceId === "string" ? { spaceId: record.spaceId } : {}),
    ...(typeof record.turnId === "string" ? { turnId: record.turnId } : {}),
    ...(typeof record.agentId === "string" ? { agentId: record.agentId } : {}),
    ...(typeof record.correlationId === "string" ? { correlationId: record.correlationId } : {}),
    ...(typeof record.commandId === "string" ? { commandId: record.commandId } : {}),
    ...(typeof record.status === "string" ? { status: record.status } : {}),
    ...(typeof record.eventType === "string" ? { gatewayEventType: record.eventType } : {}),
    ...(typeof payload.type === "string" ? { subtype: payload.type } : {}),
    ...(typeof payload.text === "string" ? { textPreview: payload.text.slice(0, 280) } : {}),
  };
}

function extractStringField(value: unknown, field: string): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const candidate = (value as Record<string, unknown>)[field];
  return typeof candidate === "string" && candidate.trim() ? candidate.trim() : undefined;
}

function extractNestedEvalRunId(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const run = (value as Record<string, unknown>).run;
  if (!run || typeof run !== "object" || Array.isArray(run)) {
    return undefined;
  }
  return extractStringField(run, "evalRunId");
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function dedupeStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))];
}

function normalizeName(name: string | undefined, fallback: string): string {
  return name?.trim() || fallback;
}

function nowIso(): string {
  return new Date().toISOString();
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}
