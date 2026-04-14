import type { Database } from "bun:sqlite";
import type {
  WorkbenchAnalystAuthority,
  WorkbenchAnalystEvent,
  WorkbenchAnalystPhase,
  WorkbenchAnalystQueueSnapshot,
  WorkbenchAnalystSession,
  WorkbenchAnalystSessionDetail,
  WorkbenchAnalystSessionStatus,
  WorkbenchAnalystSnapshotData,
  WorkbenchFixEvidence,
  WorkbenchFixProposal,
  WorkbenchLiveMessage,
  WorkbenchVerificationCommand,
} from "./runner-protocol.js";
import { WorkbenchExecutionGate } from "./execution-gate.js";

const TERMINAL_SESSION_STATUSES = new Set<WorkbenchAnalystSessionStatus>([
  "input_required",
  "cancelled",
  "completed",
  "failed",
  "interrupted",
]);

interface SessionRow {
  id: string;
  source_type: "run" | "space";
  source_run_id: string | null;
  source_space_id: string;
  source_root_turn_id: string | null;
  task_id: string | null;
  analysis_space_id: string | null;
  analysis_root_turn_id: string | null;
  status: WorkbenchAnalystSessionStatus;
  phase: WorkbenchAnalystPhase;
  authority: WorkbenchAnalystAuthority;
  queue_rank: number | null;
  snapshot_json: string;
  exit_summary: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  updated_at: string;
}

interface EventRow {
  event_id: string;
  session_id: string;
  seq: number;
  stream: "service" | "gateway";
  kind: string;
  payload_json: string;
  created_at: string;
}

interface ProposalRow {
  session_id: string;
  proposal_json: string;
  created_at: string;
  updated_at: string;
}

export interface ResolvedRunSource {
  runId: string;
  runName?: string;
  sourceSpaceId?: string;
  sourceRootTurnId?: string;
}

export interface ResolvedSpaceSource {
  sourceSpaceId: string;
  sourceRootTurnId?: string;
}

export interface WorkbenchAnalystExecutorContext {
  sessionId: string;
  sourceType: "run" | "space";
  sourceRunId?: string;
  sourceSpaceId: string;
  sourceRootTurnId?: string;
  authority: WorkbenchAnalystAuthority;
  signal: AbortSignal;
  updatePhase: (phase: WorkbenchAnalystPhase, message?: string) => void;
  addEvidence: (evidence: WorkbenchFixEvidence) => void;
  addVerificationCommand: (command: WorkbenchVerificationCommand) => void;
  registerTaskId: (taskId: string) => void;
  registerAnalysisSpace: (spaceId: string) => void;
  registerAnalysisRootTurn: (turnId: string) => void;
  recordGatewayEvent: (kind: string, payload: Record<string, unknown>) => void;
}

export interface WorkbenchAnalystExecutorResult {
  proposal?: WorkbenchFixProposal;
  exitSummary?: string;
  status?: Extract<WorkbenchAnalystSessionStatus, "completed" | "failed" | "input_required">;
}

export type WorkbenchAnalystExecutor = (
  context: WorkbenchAnalystExecutorContext,
) => Promise<WorkbenchAnalystExecutorResult>;

export interface WorkbenchAnalystServiceOptions {
  db: Database;
  resolveRunSource: (runId: string) => Promise<ResolvedRunSource | null> | ResolvedRunSource | null;
  resolveSpaceSource: (
    spaceId: string,
    rootTurnId?: string,
  ) => Promise<ResolvedSpaceSource | null> | ResolvedSpaceSource | null;
  executor: WorkbenchAnalystExecutor;
  executionGate?: WorkbenchExecutionGate;
}

export class WorkbenchAnalystService {
  private readonly db: Database;
  private readonly resolveRunSource: WorkbenchAnalystServiceOptions["resolveRunSource"];
  private readonly resolveSpaceSource: WorkbenchAnalystServiceOptions["resolveSpaceSource"];
  private readonly executor: WorkbenchAnalystExecutor;
  private readonly executionGate: WorkbenchExecutionGate;
  private readonly listeners = new Set<(message: WorkbenchLiveMessage) => void>();
  private activeSessionId: string | null = null;
  private activeAbortControllers = new Map<string, AbortController>();
  private queueLoopRunning = false;
  private queueScheduled = false;
  private closed = false;
  private unsubscribeGate?: () => void;

  constructor(options: WorkbenchAnalystServiceOptions) {
    this.db = options.db;
    this.resolveRunSource = options.resolveRunSource;
    this.resolveSpaceSource = options.resolveSpaceSource;
    this.executor = options.executor;
    this.executionGate = options.executionGate ?? new WorkbenchExecutionGate();
  }

  initialize(): void {
    this.closed = false;
    this.ensureSchema();
    const timestamp = nowIso();
    this.db.query(`
      UPDATE workbench_analyst_sessions
         SET status = 'interrupted',
             queue_rank = NULL,
             finished_at = COALESCE(finished_at, ?1),
             updated_at = ?1,
             exit_summary = COALESCE(exit_summary, 'Workbench analyst restarted while this session was active.')
       WHERE status IN ('starting', 'running', 'cancelling')
    `).run(timestamp);
    this.activeSessionId = null;
    this.unsubscribeGate?.();
    this.unsubscribeGate = this.executionGate.subscribe(() => this.scheduleQueueProcessing());
    this.scheduleQueueProcessing();
  }

  async shutdown(): Promise<void> {
    this.closed = true;
    this.queueScheduled = false;
    this.unsubscribeGate?.();
    this.unsubscribeGate = undefined;
    if (!this.activeSessionId) {
      return;
    }
    const activeSessionId = this.activeSessionId;
    this.activeAbortControllers.get(activeSessionId)?.abort();
    this.activeAbortControllers.delete(activeSessionId);
    this.executionGate.release(`analyst:${activeSessionId}`);
    this.db.query(`
      UPDATE workbench_analyst_sessions
         SET status = 'interrupted',
             queue_rank = NULL,
             finished_at = COALESCE(finished_at, ?2),
             updated_at = ?2,
             exit_summary = COALESCE(exit_summary, ?1)
       WHERE id = ?3 AND status IN ('starting', 'running', 'cancelling')
    `).run("Workbench analyst stopped while this session was active.", nowIso(), activeSessionId);
    this.activeSessionId = null;
    this.emitSnapshot();
  }

  subscribe(listener: (message: WorkbenchLiveMessage) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async startFromRun(input: { runId: string }): Promise<WorkbenchAnalystSession> {
    const resolved = await this.resolveRunSource(input.runId);
    if (!resolved) {
      throw new Error(`Workbench run ${input.runId} not found.`);
    }
    return this.enqueueSession({
      sourceType: "run",
      sourceRunId: resolved.runId,
      sourceSpaceId: resolved.sourceSpaceId ?? "",
      sourceRootTurnId: resolved.sourceRootTurnId,
    });
  }

  async startFromSpace(input: { spaceId: string; rootTurnId?: string }): Promise<WorkbenchAnalystSession> {
    const resolved = await this.resolveSpaceSource(input.spaceId, input.rootTurnId);
    if (!resolved) {
      throw new Error(`Workbench source space ${input.spaceId} not found.`);
    }
    return this.enqueueSession({
      sourceType: "space",
      sourceSpaceId: resolved.sourceSpaceId,
      sourceRootTurnId: resolved.sourceRootTurnId,
    });
  }

  async retrySession(sessionId: string): Promise<WorkbenchAnalystSession> {
    const session = this.getSessionOrThrow(sessionId);
    return this.enqueueSession({
      sourceType: session.sourceType,
      sourceRunId: session.sourceRunId,
      sourceSpaceId: session.sourceSpaceId,
      sourceRootTurnId: session.sourceRootTurnId,
    });
  }

  async cancelSession(sessionId: string): Promise<WorkbenchAnalystSession | null> {
    const session = this.getSessionDetail(sessionId);
    if (!session || TERMINAL_SESSION_STATUSES.has(session.status)) {
      return session;
    }

    if (session.status === "queued") {
      const timestamp = nowIso();
      this.db.query(`
        UPDATE workbench_analyst_sessions
           SET status = 'cancelled',
               queue_rank = NULL,
               finished_at = ?2,
               updated_at = ?2,
               exit_summary = 'Cancelled before analysis started.'
         WHERE id = ?1
      `).run(sessionId, timestamp);
      const cancelled = this.getSessionOrThrow(sessionId);
      this.recordEvent(sessionId, "service", "session.cancelled", { status: cancelled.status });
      this.emit({ type: "analyst.session.updated", session: cancelled });
      this.emitSnapshot();
      return cancelled;
    }

    if (!["starting", "running", "cancelling"].includes(session.status)) {
      return session;
    }

    this.db.query(`
      UPDATE workbench_analyst_sessions
         SET status = 'cancelling',
             updated_at = ?2,
             exit_summary = 'Cancellation requested.'
       WHERE id = ?1
    `).run(sessionId, nowIso());
    const cancelling = this.getSessionOrThrow(sessionId);
    this.recordEvent(sessionId, "service", "session.cancelling", { status: cancelling.status });
    this.activeAbortControllers.get(sessionId)?.abort();
    this.emit({ type: "analyst.session.updated", session: cancelling });
    this.emitSnapshot();
    return cancelling;
  }

  getSnapshot(): WorkbenchAnalystQueueSnapshot {
    return {
      ...(this.getActiveSessionFromDb() ? { activeSession: this.getActiveSessionFromDb()! } : {}),
      queuedSessions: this.listQueuedSessions(),
      recentSessions: this.listRecentSessions(),
    };
  }

  getSessionDetail(sessionId: string): WorkbenchAnalystSessionDetail | null {
    const row = this.db.query("SELECT * FROM workbench_analyst_sessions WHERE id = ?1").get(sessionId) as SessionRow | null;
    if (!row) return null;
    const session = deserializeSessionRow(row);
    const snapshot = parseJson<WorkbenchAnalystSnapshotData>(
      row.snapshot_json,
      emptyAnalystSnapshot(),
    );
    const events = this.db.query(`
      SELECT event_id, session_id, seq, stream, kind, payload_json, created_at
        FROM workbench_analyst_events
       WHERE session_id = ?1
       ORDER BY seq ASC
    `).all(sessionId) as EventRow[];
    const proposalRow = this.db.query(`
      SELECT session_id, proposal_json, created_at, updated_at
        FROM workbench_fix_proposals
       WHERE session_id = ?1
    `).get(sessionId) as ProposalRow | null;

    return {
      ...session,
      snapshot,
      ...(proposalRow ? { proposal: parseJson<WorkbenchFixProposal>(proposalRow.proposal_json, emptyProposal()) } : {}),
      events: events.filter((event) => event.stream === "service").map(deserializeEventRow),
      gatewayEvents: events.filter((event) => event.stream === "gateway").map(deserializeEventRow),
    };
  }

  waitForSessionCompletion(sessionId: string, timeoutMs = 30_000): Promise<WorkbenchAnalystSession> {
    const session = this.getSessionOrThrow(sessionId);
    if (TERMINAL_SESSION_STATUSES.has(session.status)) {
      return Promise.resolve(session);
    }

    return new Promise<WorkbenchAnalystSession>((resolve, reject) => {
      const timer = setTimeout(() => {
        unsubscribe();
        reject(new Error(`Timed out waiting for analyst session ${sessionId} to complete.`));
      }, timeoutMs);
      const unsubscribe = this.subscribe((message) => {
        if (message.type !== "analyst.session.updated" || message.session.id !== sessionId) {
          return;
        }
        if (!TERMINAL_SESSION_STATUSES.has(message.session.status)) {
          return;
        }
        clearTimeout(timer);
        unsubscribe();
        resolve(message.session);
      });
    });
  }

  emitSnapshot(): void {
    this.emit({ type: "analyst.snapshot", snapshot: this.getSnapshot() });
  }

  private emit(message: WorkbenchLiveMessage): void {
    for (const listener of this.listeners) {
      listener(message);
    }
  }

  private ensureSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS workbench_analyst_sessions (
        id TEXT PRIMARY KEY,
        source_type TEXT NOT NULL,
        source_run_id TEXT,
        source_space_id TEXT NOT NULL,
        source_root_turn_id TEXT,
        task_id TEXT,
        analysis_space_id TEXT,
        analysis_root_turn_id TEXT,
        status TEXT NOT NULL,
        phase TEXT NOT NULL,
        authority TEXT NOT NULL,
        queue_rank INTEGER,
        snapshot_json TEXT NOT NULL DEFAULT '{}',
        exit_summary TEXT,
        created_at TEXT NOT NULL,
        started_at TEXT,
        finished_at TEXT,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_workbench_analyst_sessions_status_queue
        ON workbench_analyst_sessions(status, queue_rank, created_at);

      CREATE TABLE IF NOT EXISTS workbench_analyst_events (
        event_id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        stream TEXT NOT NULL,
        kind TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_workbench_analyst_events_session_seq
        ON workbench_analyst_events(session_id, seq);

      CREATE TABLE IF NOT EXISTS workbench_fix_proposals (
        session_id TEXT PRIMARY KEY,
        proposal_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  }

  private enqueueSession(input: {
    sourceType: "run" | "space";
    sourceRunId?: string;
    sourceSpaceId: string;
    sourceRootTurnId?: string;
  }): WorkbenchAnalystSession {
    const createdAt = nowIso();
    const sessionId = crypto.randomUUID();
    const queueRankRow = this.db.query(`
      SELECT COALESCE(MAX(queue_rank), 0) AS value
        FROM workbench_analyst_sessions
       WHERE status = 'queued'
    `).get() as { value?: number } | null;
    const queueRank = (queueRankRow?.value ?? 0) + 1;

    this.db.query(`
      INSERT INTO workbench_analyst_sessions (
        id, source_type, source_run_id, source_space_id, source_root_turn_id,
        task_id, analysis_space_id, analysis_root_turn_id, status, phase, authority,
        queue_rank, snapshot_json, exit_summary, created_at, started_at, finished_at, updated_at
      ) VALUES (
        ?1, ?2, ?3, ?4, ?5,
        NULL, NULL, NULL, 'queued', 'gathering_context', 'proposal_only',
        ?6, ?7, NULL, ?8, NULL, NULL, ?8
      )
    `).run(
      sessionId,
      input.sourceType,
      input.sourceRunId ?? null,
      input.sourceSpaceId,
      input.sourceRootTurnId ?? null,
      queueRank,
      JSON.stringify(emptyAnalystSnapshot()),
      createdAt,
    );

    const row = this.db.query(`
      SELECT *
        FROM workbench_analyst_sessions
       WHERE id = ?1
    `).get(sessionId) as SessionRow;
    const session = deserializeSessionRow(row);
    this.recordEvent(session.id, "service", "session.queued", {
      queueRank: session.queueRank,
      sourceType: session.sourceType,
    });
    this.emit({ type: "analyst.session.updated", session });
    this.emitSnapshot();
    this.scheduleQueueProcessing();
    return session;
  }

  private async processQueue(): Promise<void> {
    if (this.closed || this.queueLoopRunning || this.activeSessionId) {
      return;
    }
    const nextRow = this.db.query(`
      SELECT *
        FROM workbench_analyst_sessions
       WHERE status = 'queued'
       ORDER BY queue_rank ASC, created_at ASC
       LIMIT 1
    `).get() as SessionRow | null;
    if (!nextRow) {
      return;
    }
    if (!this.executionGate.tryAcquire(`analyst:${nextRow.id}`)) {
      return;
    }

    this.queueLoopRunning = true;
    this.activeSessionId = nextRow.id;
    const abortController = new AbortController();
    this.activeAbortControllers.set(nextRow.id, abortController);

    const startedAt = nowIso();
    this.db.query(`
      UPDATE workbench_analyst_sessions
         SET status = 'starting',
             queue_rank = NULL,
             started_at = COALESCE(started_at, ?2),
             updated_at = ?2
       WHERE id = ?1
    `).run(nextRow.id, startedAt);
    this.updateSession(nextRow.id, {
      status: "running",
      updatedAt: nowIso(),
    });
    let session = this.getSessionOrThrow(nextRow.id);
    this.recordEvent(session.id, "service", "session.running", { status: session.status });
    this.emit({ type: "analyst.session.updated", session });
    this.emitSnapshot();

    try {
      const result = await this.executor({
        sessionId: session.id,
        sourceType: session.sourceType,
        sourceRunId: session.sourceRunId,
        sourceSpaceId: session.sourceSpaceId,
        sourceRootTurnId: session.sourceRootTurnId,
        authority: session.authority,
        signal: abortController.signal,
        updatePhase: (phase, message) => this.updatePhase(session.id, phase, message),
        addEvidence: (evidence) => this.addEvidence(session.id, evidence),
        addVerificationCommand: (command) => this.addVerificationCommand(session.id, command),
        registerTaskId: (taskId) => this.updateSession(session.id, { taskId, updatedAt: nowIso() }),
        registerAnalysisSpace: (analysisSpaceId) => this.updateSession(session.id, { analysisSpaceId, updatedAt: nowIso() }),
        registerAnalysisRootTurn: (analysisRootTurnId) => this.updateSession(session.id, { analysisRootTurnId, updatedAt: nowIso() }),
        recordGatewayEvent: (kind, payload) => {
          this.recordEvent(session.id, "gateway", kind, payload);
        },
      });

      if (this.closed) {
        return;
      }

      if (abortController.signal.aborted || this.getSessionOrThrow(session.id).status === "cancelling") {
        const cancelled = this.finalizeCancelledSession(session.id, "Analysis cancelled while executing.");
        this.emit({ type: "analyst.session.updated", session: cancelled });
        this.emitSnapshot();
        return;
      }

      const finalStatus = result.status ?? "completed";
      if (result.proposal) {
        this.upsertProposal(session.id, result.proposal);
        this.emit({ type: "analyst.proposal.saved", sessionId: session.id });
      }
      const finishedAt = nowIso();
      this.db.query(`
        UPDATE workbench_analyst_sessions
           SET status = ?2,
               finished_at = ?3,
               updated_at = ?3,
               exit_summary = ?4
         WHERE id = ?1
      `).run(
        session.id,
        finalStatus,
        finishedAt,
        result.exitSummary
          ?? (finalStatus === "completed" ? "Analysis completed successfully." : "Analysis requires user review."),
      );
      session = this.getSessionOrThrow(session.id);
      this.recordEvent(session.id, "service", `session.${finalStatus}`, { status: session.status });
      this.emit({ type: "analyst.session.updated", session });
      this.emitSnapshot();
    } catch (error) {
      if (this.closed) {
        return;
      }
      if (abortController.signal.aborted || isAbortError(error) || this.getSessionOrThrow(session.id).status === "cancelling") {
        const cancelled = this.finalizeCancelledSession(session.id, "Analysis cancelled while executing.");
        this.emit({ type: "analyst.session.updated", session: cancelled });
        this.emitSnapshot();
      } else {
        const failed = this.finalizeFailedSession(session.id, error instanceof Error ? error.message : String(error));
        this.emit({ type: "analyst.session.updated", session: failed });
        this.emitSnapshot();
      }
    } finally {
      this.executionGate.release(`analyst:${session.id}`);
      this.activeAbortControllers.delete(session.id);
      this.activeSessionId = null;
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

  private updatePhase(sessionId: string, phase: WorkbenchAnalystPhase, message?: string): void {
    this.db.query(`
      UPDATE workbench_analyst_sessions
         SET phase = ?2,
             updated_at = ?3
       WHERE id = ?1
    `).run(sessionId, phase, nowIso());
    this.updateSnapshot(sessionId, (snapshot) => ({
      ...snapshot,
      ...(message ? { message } : {}),
    }));
    const session = this.getSessionOrThrow(sessionId);
    this.recordEvent(sessionId, "service", "session.phase", { phase, ...(message ? { message } : {}) });
    this.emit({ type: "analyst.session.updated", session });
  }

  private addEvidence(sessionId: string, evidence: WorkbenchFixEvidence): void {
    this.updateSnapshot(sessionId, (snapshot) => ({
      ...snapshot,
      evidence: [...snapshot.evidence, evidence],
    }));
    this.recordEvent(sessionId, "service", "session.evidence", evidence as Record<string, unknown>);
  }

  private addVerificationCommand(sessionId: string, command: WorkbenchVerificationCommand): void {
    this.updateSnapshot(sessionId, (snapshot) => ({
      ...snapshot,
      verificationCommands: [...snapshot.verificationCommands, command],
    }));
    this.recordEvent(sessionId, "service", "session.verification", command as Record<string, unknown>);
  }

  private updateSnapshot(
    sessionId: string,
    updater: (snapshot: WorkbenchAnalystSnapshotData) => WorkbenchAnalystSnapshotData,
  ): void {
    const detail = this.getSessionDetail(sessionId);
    if (!detail) {
      return;
    }
    this.db.query(`
      UPDATE workbench_analyst_sessions
         SET snapshot_json = ?2,
             updated_at = ?3
       WHERE id = ?1
    `).run(sessionId, JSON.stringify(updater(detail.snapshot)), nowIso());
    this.emit({ type: "analyst.session.updated", session: this.getSessionOrThrow(sessionId) });
  }

  private updateSession(
    sessionId: string,
    input: {
      status?: WorkbenchAnalystSessionStatus;
      taskId?: string;
      analysisSpaceId?: string;
      analysisRootTurnId?: string;
      updatedAt: string;
    },
  ): void {
    const sets: string[] = ["updated_at = ?"];
    const values: unknown[] = [input.updatedAt];
    if (input.status) {
      sets.push("status = ?");
      values.push(input.status);
    }
    if (input.taskId !== undefined) {
      sets.push("task_id = ?");
      values.push(input.taskId);
    }
    if (input.analysisSpaceId !== undefined) {
      sets.push("analysis_space_id = ?");
      values.push(input.analysisSpaceId);
    }
    if (input.analysisRootTurnId !== undefined) {
      sets.push("analysis_root_turn_id = ?");
      values.push(input.analysisRootTurnId);
    }
    values.push(sessionId);
    this.db.query(`
      UPDATE workbench_analyst_sessions
         SET ${sets.join(", ")}
       WHERE id = ?
    `).run(...(values as [string, ...unknown[]]));
  }

  private upsertProposal(sessionId: string, proposal: WorkbenchFixProposal): void {
    const timestamp = nowIso();
    this.db.query(`
      INSERT INTO workbench_fix_proposals(session_id, proposal_json, created_at, updated_at)
      VALUES (?1, ?2, ?3, ?3)
      ON CONFLICT(session_id)
      DO UPDATE SET proposal_json = excluded.proposal_json, updated_at = excluded.updated_at
    `).run(sessionId, JSON.stringify(proposal), timestamp);
  }

  private finalizeCancelledSession(sessionId: string, summary: string): WorkbenchAnalystSession {
    const finishedAt = nowIso();
    this.db.query(`
      UPDATE workbench_analyst_sessions
         SET status = 'cancelled',
             finished_at = ?2,
             updated_at = ?2,
             exit_summary = ?3
       WHERE id = ?1
    `).run(sessionId, finishedAt, summary);
    const session = this.getSessionOrThrow(sessionId);
    this.recordEvent(sessionId, "service", "session.cancelled", { summary });
    return session;
  }

  private finalizeFailedSession(sessionId: string, summary: string): WorkbenchAnalystSession {
    const finishedAt = nowIso();
    this.db.query(`
      UPDATE workbench_analyst_sessions
         SET status = 'failed',
             finished_at = ?2,
             updated_at = ?2,
             exit_summary = ?3
       WHERE id = ?1
    `).run(sessionId, finishedAt, summary);
    const session = this.getSessionOrThrow(sessionId);
    this.recordEvent(sessionId, "service", "session.failed", { summary });
    return session;
  }

  private recordEvent(
    sessionId: string,
    stream: "service" | "gateway",
    kind: string,
    payload: Record<string, unknown>,
  ): WorkbenchAnalystEvent {
    const seqRow = this.db.query(`
      SELECT COALESCE(MAX(seq), 0) + 1 AS next_seq
        FROM workbench_analyst_events
       WHERE session_id = ?1
    `).get(sessionId) as { next_seq?: number } | null;
    const event = {
      eventId: crypto.randomUUID(),
      sessionId,
      seq: seqRow?.next_seq ?? 1,
      stream,
      kind,
      payload,
      createdAt: nowIso(),
    } satisfies WorkbenchAnalystEvent;
    this.db.query(`
      INSERT INTO workbench_analyst_events (
        event_id, session_id, seq, stream, kind, payload_json, created_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
    `).run(
      event.eventId,
      event.sessionId,
      event.seq,
      event.stream,
      event.kind,
      JSON.stringify(event.payload),
      event.createdAt,
    );
    this.emit({ type: "analyst.session.event", event });
    return event;
  }

  private getSessionOrThrow(sessionId: string): WorkbenchAnalystSession {
    const row = this.db.query("SELECT * FROM workbench_analyst_sessions WHERE id = ?1").get(sessionId) as SessionRow | null;
    if (!row) {
      throw new Error(`Workbench analyst session ${sessionId} not found.`);
    }
    return deserializeSessionRow(row);
  }

  private getActiveSessionFromDb(): WorkbenchAnalystSession | null {
    const row = this.db.query(`
      SELECT *
        FROM workbench_analyst_sessions
       WHERE status IN ('starting', 'running', 'cancelling')
       ORDER BY started_at DESC, created_at DESC
       LIMIT 1
    `).get() as SessionRow | null;
    return row ? deserializeSessionRow(row) : null;
  }

  private listQueuedSessions(): WorkbenchAnalystSession[] {
    const rows = this.db.query(`
      SELECT *
        FROM workbench_analyst_sessions
       WHERE status = 'queued'
       ORDER BY queue_rank ASC, created_at ASC
    `).all() as SessionRow[];
    return rows.map(deserializeSessionRow);
  }

  private listRecentSessions(limit = 20): WorkbenchAnalystSession[] {
    const rows = this.db.query(`
      SELECT *
        FROM workbench_analyst_sessions
       WHERE status IN ('input_required', 'cancelled', 'completed', 'failed', 'interrupted')
       ORDER BY COALESCE(finished_at, updated_at, created_at) DESC
       LIMIT ?1
    `).all(limit) as SessionRow[];
    return rows.map(deserializeSessionRow);
  }
}

function deserializeSessionRow(row: SessionRow): WorkbenchAnalystSession {
  return {
    id: row.id,
    sourceType: row.source_type,
    ...(row.source_run_id ? { sourceRunId: row.source_run_id } : {}),
    sourceSpaceId: row.source_space_id,
    ...(row.source_root_turn_id ? { sourceRootTurnId: row.source_root_turn_id } : {}),
    ...(row.task_id ? { taskId: row.task_id } : {}),
    ...(row.analysis_space_id ? { analysisSpaceId: row.analysis_space_id } : {}),
    ...(row.analysis_root_turn_id ? { analysisRootTurnId: row.analysis_root_turn_id } : {}),
    status: row.status,
    phase: row.phase,
    authority: row.authority,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(typeof row.queue_rank === "number" ? { queueRank: row.queue_rank } : {}),
    ...(row.started_at ? { startedAt: row.started_at } : {}),
    ...(row.finished_at ? { finishedAt: row.finished_at } : {}),
    ...(row.started_at && row.finished_at
      ? { durationMs: Date.parse(row.finished_at) - Date.parse(row.started_at) }
      : {}),
    ...(row.exit_summary ? { exitSummary: row.exit_summary } : {}),
  };
}

function deserializeEventRow(row: EventRow): WorkbenchAnalystEvent {
  return {
    eventId: row.event_id,
    sessionId: row.session_id,
    seq: row.seq,
    stream: row.stream,
    kind: row.kind,
    payload: parseJson<Record<string, unknown>>(row.payload_json, {}),
    createdAt: row.created_at,
  };
}

function emptyAnalystSnapshot(): WorkbenchAnalystSnapshotData {
  return {
    verificationCommands: [],
    evidence: [],
  };
}

function emptyProposal(): WorkbenchFixProposal {
  return {
    summary: "",
    rootCause: "",
    evidence: [],
    reproductionCommands: [],
    proposedEdits: [],
    verificationCommands: [],
  };
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}
