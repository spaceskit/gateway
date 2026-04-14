import type { GatewayInstance } from "../packages/bootstrap/src/index.js";
import type { GatewayEvent } from "../packages/core/src/events/event-bus.js";
import { ProfileRepository, TurnRepository, type TurnRow } from "../packages/persistence/src/index.js";
import type {
  WorkbenchAnalystExecutor,
  ResolvedRunSource,
  ResolvedSpaceSource,
} from "./analyst-service.js";
import type {
  WorkbenchFixEvidence,
  WorkbenchFixProposal,
  WorkbenchVerificationCommand,
  WorkbenchJobRunDetail,
} from "./runner-protocol.js";
import type { WorkbenchRunnerService } from "./runner-service.js";
import { executeWorkbenchRun } from "./runtime.js";

const ANALYST_PROFILE_ID = "workbench/analyst-profile";
const ANALYST_AGENT_ID = "analyst";
const RELEVANT_GATEWAY_EVENT_TYPES = new Set([
  "space.turn_started",
  "space.turn_event",
  "space.orchestrator_event",
]);

interface CreateWorkbenchAnalystRuntimeOptions {
  gateway: GatewayInstance;
  runner: WorkbenchRunnerService;
  wsUrl: string;
  httpUrl: string;
  workspaceRoot: string;
}

export function createWorkbenchAnalystRuntime(options: CreateWorkbenchAnalystRuntimeOptions): {
  resolveRunSource: (runId: string) => Promise<ResolvedRunSource | null>;
  resolveSpaceSource: (spaceId: string, rootTurnId?: string) => Promise<ResolvedSpaceSource | null>;
  executor: WorkbenchAnalystExecutor;
} {
  const turnRepo = new TurnRepository(options.gateway.db!.db);
  const profileRepo = new ProfileRepository(options.gateway.db!.db);

  return {
    resolveRunSource: async (runId) => {
      const detail = options.runner.getRunDetail(runId);
      if (!detail) {
        return null;
      }
      return {
        runId,
        runName: detail.name,
        sourceSpaceId: inferSourceSpaceId(detail) ?? "",
        sourceRootTurnId: inferSourceRootTurnId(detail),
      };
    },
    resolveSpaceSource: async (spaceId, rootTurnId) => {
      const space = await options.gateway.spaceAdminService.getSpace(spaceId).catch(() => null);
      if (!space) {
        return null;
      }
      return {
        sourceSpaceId: space.id,
        ...(rootTurnId ? { sourceRootTurnId: rootTurnId } : {}),
      };
    },
    executor: async (context) => {
      const sourceRun = context.sourceRunId ? options.runner.getRunDetail(context.sourceRunId) : null;
      const sourceSpaceId = context.sourceSpaceId || inferSourceSpaceId(sourceRun) || "";
      const sourceRootTurnId = context.sourceRootTurnId || inferSourceRootTurnId(sourceRun) || undefined;

      context.updatePhase("gathering_context", "Collecting source evidence");
      const sourceEvidence = await gatherSourceEvidence({
        gateway: options.gateway,
        turnRepo,
        sourceRun,
        sourceSpaceId,
        sourceRootTurnId,
      });
      for (const evidence of sourceEvidence) {
        context.addEvidence(evidence);
      }

      context.updatePhase("reproducing", "Re-running targeted verification");
      const verificationCommands = await runVerification({
        gateway: options.gateway,
        wsUrl: options.wsUrl,
        httpUrl: options.httpUrl,
        workspaceRoot: options.workspaceRoot,
        sourceRun,
        sourceType: context.sourceType,
      });
      for (const verification of verificationCommands) {
        context.addVerificationCommand(verification);
      }

      context.updatePhase("analyzing", "Creating dedicated analyst space");
      ensureAnalystProfile(profileRepo);
      const analysisSpace = await options.gateway.spaceAdminService.createSpace({
        name: buildAnalysisSpaceName(context),
        goal: "Workbench analyst session",
        resourceId: `workbench-analyst:${context.sessionId}`,
        conversationTopology: "direct",
        turnModel: "primary_only",
        idempotencyKey: `workbench-analyst:${context.sessionId}:space`,
      });
      context.registerAnalysisSpace(analysisSpace.id);

      await options.gateway.spaceAdminService.addAgent({
        spaceId: analysisSpace.id,
        agentId: ANALYST_AGENT_ID,
        profileId: ANALYST_PROFILE_ID,
        role: "participant",
        isPrimary: true,
        spawnContext: "Workbench analyst session",
        idempotencyKey: `workbench-analyst:${context.sessionId}:agent`,
      });

      const unsubscribeGateway = options.gateway.eventBus.onAny((event) => {
        if (!RELEVANT_GATEWAY_EVENT_TYPES.has(event.type)) {
          return;
        }
        const payload = normalizeGatewayEvent(event);
        if (payload.spaceId !== analysisSpace.id) {
          return;
        }
        context.recordGatewayEvent(event.type, payload);
      });

      try {
        context.updatePhase("drafting_fix", "Running analyst synthesis turn");
        const prompt = buildAnalystPrompt({
          context,
          sourceEvidence,
          verificationCommands,
          sourceRun,
          sourceSpaceId,
          sourceRootTurnId,
        });
        const { turnId } = await options.gateway.spaceManager.executeTurn(
          analysisSpace.id,
          prompt,
          ANALYST_AGENT_ID,
          {
            principalId: "workbench-analyst",
            executionOrigin: "system",
          },
        );
        context.registerAnalysisRootTurn(turnId);

        const completedTurn = await waitForTurnCompletion(turnRepo, analysisSpace.id, turnId, context.signal);
        const finalText = extractTurnText(completedTurn.output_json);
        const proposal = parseFixProposal(finalText, {
          sourceEvidence,
          verificationCommands,
        });

        return {
          proposal,
          exitSummary: proposal.summary,
        };
      } finally {
        unsubscribeGateway();
      }
    },
  };
}

function ensureAnalystProfile(profileRepo: ProfileRepository): void {
  if (profileRepo.getById(ANALYST_PROFILE_ID)) {
    return;
  }
  const baseProfile = profileRepo.getById("workbench-profile");
  const baseRevision = profileRepo.getActiveRevision("workbench-profile");
  profileRepo.create({
    profileId: ANALYST_PROFILE_ID,
    name: "Workbench Analyst",
    description: "Read-only workbench analysis profile",
    canModerate: false,
    personalityPrompt: [
      "You are the Workbench Analyst.",
      "Analyze evidence from a failing or completed workbench run and produce a concrete fix proposal.",
      "Use only read-only reasoning. Do not instruct code edits beyond proposed change descriptions.",
      "Return exactly one JSON object with keys:",
      "summary, rootCause, evidence, reproductionCommands, proposedEdits, verificationCommands, draftPatch.",
      "Each evidence item must have title and detail. Each proposedEdits item must have filePath and summary, optionally rationale.",
      "If a draft patch is not available, omit draftPatch.",
    ].join("\n"),
    providerHint: baseRevision?.provider_hint || "",
    modelHint: baseRevision?.model_hint || "",
    modelConfig: safeParseJson(baseRevision?.model_config_json) ?? undefined,
    source: `workbench-analyst:${baseProfile?.profile_id ?? "generated"}`,
  });
}

export function deriveVerificationPlan(input: {
  sourceRun: WorkbenchJobRunDetail | null;
  sourceType: "run" | "space";
}): { layerNames: string[]; providers?: string[] } {
  if (input.sourceType === "space" || !input.sourceRun) {
    return { layerNames: ["orchestration"] };
  }

  const failingLayers = dedupeStrings(
    input.sourceRun.snapshot.layers
      .filter((layer) => layer.status === "fail" || layer.scenarios.some((scenario) => scenario.status === "fail"))
      .map((layer) => layer.name),
  );
  const failingProviders = dedupeStrings(
    input.sourceRun.snapshot.providerParity
      .filter((row) => row.status === "fail")
      .map((row) => row.provider),
  );

  const layerNames = failingLayers.length > 0
    ? failingLayers.slice(0, 1)
    : failingProviders.length > 0
      ? ["provider-tool-parity"]
      : input.sourceRun.config.layers.length > 0
        ? input.sourceRun.config.layers.slice(0, 1)
        : ["orchestration"];

  const providers = failingProviders.length > 0
    ? failingProviders.slice(0, 1)
    : input.sourceRun.config.providers.length > 0
      ? input.sourceRun.config.providers
      : undefined;

  return {
    layerNames,
    ...(providers && providers.length > 0 ? { providers } : {}),
  };
}

export function buildPersistedVerificationCommands(input: {
  sourceRun: WorkbenchJobRunDetail | null;
  workspaceRoot: string;
}): WorkbenchVerificationCommand[] | null {
  const sourceRun = input.sourceRun;
  if (!sourceRun) {
    return null;
  }
  const failingProviderRows = sourceRun.snapshot.providerParity.filter((row) => row.status === "fail");
  if (failingProviderRows.length === 0) {
    return null;
  }
  const row = failingProviderRows[0];
  const providerId = row.observedProviderId || row.provider;
  return [{
    command: [
      `cd ${input.workspaceRoot}`,
      `bun run workbench/run.ts --layers provider-tool-parity --providers ${providerId}`,
    ].join(" "),
    status: "failed",
    summary: `Reused persisted provider parity evidence from source run ${sourceRun.id} to avoid launching a nested live parity rerun inside the analyst session.`,
    outputPreview: [
      `provider=${row.provider}`,
      `model=${row.model}`,
      row.failureReason ? `failure=${row.failureReason}` : "",
      row.observedToolCall ? `tool=${row.observedToolCall}` : "",
      row.observedToolResult !== undefined ? `toolResult=${JSON.stringify(row.observedToolResult)}` : "",
    ].filter(Boolean).join("\n"),
  }];
}

async function gatherSourceEvidence(input: {
  gateway: GatewayInstance;
  turnRepo: TurnRepository;
  sourceRun: ReturnType<WorkbenchRunnerService["getRunDetail"]>;
  sourceSpaceId: string;
  sourceRootTurnId?: string;
}): Promise<WorkbenchFixEvidence[]> {
  const evidence: WorkbenchFixEvidence[] = [];

  if (input.sourceRun) {
    evidence.push({
      title: "Source run",
      detail: [
        `runId=${input.sourceRun.id}`,
        `status=${input.sourceRun.status}`,
        `layers=${input.sourceRun.config.layers.join(", ")}`,
        input.sourceRun.config.providers.length ? `providers=${input.sourceRun.config.providers.join(", ")}` : "",
        input.sourceRun.exitSummary ? `exitSummary=${input.sourceRun.exitSummary}` : "",
      ].filter(Boolean).join("\n"),
    });
    const providerFailures = input.sourceRun.snapshot.providerParity.filter((row) => row.status === "fail");
    if (providerFailures.length) {
      evidence.push({
        title: "Provider parity failures",
        detail: providerFailures.map((row) =>
          `${row.provider}/${row.model}: ${row.failureReason ?? row.status}`
        ).join("\n"),
      });
    }
    if (input.sourceRun.runnerEvents.length > 0) {
      evidence.push({
        title: "Runner events",
        detail: input.sourceRun.runnerEvents.slice(-6).map((event) =>
          `${event.kind}: ${JSON.stringify(event.payload)}`
        ).join("\n"),
      });
    }
  }

  if (input.sourceSpaceId) {
    const space = await input.gateway.spaceAdminService.getSpace(input.sourceSpaceId).catch(() => null);
    if (space) {
      evidence.push({
        title: "Source space",
        detail: [
          `spaceId=${space.id}`,
          `name=${space.name}`,
          `turnModel=${space.turnModel}`,
          `topology=${space.conversationTopology}`,
          `agents=${space.agents.map((agent) => `${agent.agentId}:${agent.profileId}`).join(", ")}`,
        ].join("\n"),
      });
    }

    const recentTurns = input.turnRepo.listBySpace(input.sourceSpaceId, 8).reverse();
    if (recentTurns.length > 0) {
      evidence.push({
        title: input.sourceRootTurnId ? `Turns near ${input.sourceRootTurnId}` : "Recent turns",
        detail: recentTurns.map((turn) => {
          const inputText = extractTurnText(turn.input_json) || "";
          const outputText = extractTurnText(turn.output_json) || "";
          return [
            `${turn.turn_id} [${turn.status}] actor=${turn.actor_id}`,
            inputText ? `input=${truncate(inputText, 180)}` : "",
            outputText ? `output=${truncate(outputText, 180)}` : "",
          ].filter(Boolean).join("\n");
        }).join("\n\n"),
      });
    }
  }

  return evidence;
}

async function runVerification(input: {
  gateway: GatewayInstance;
  wsUrl: string;
  httpUrl: string;
  workspaceRoot: string;
  sourceRun: ReturnType<WorkbenchRunnerService["getRunDetail"]>;
  sourceType: "run" | "space";
}): Promise<WorkbenchVerificationCommand[]> {
  const persistedVerification = buildPersistedVerificationCommands({
    sourceRun: input.sourceRun,
    workspaceRoot: input.workspaceRoot,
  });
  if (persistedVerification) {
    return persistedVerification;
  }

  const plan = deriveVerificationPlan({
    sourceRun: input.sourceRun,
    sourceType: input.sourceType,
  });
  const layerNames = plan.layerNames;
  const providers = plan.providers?.length
    ? new Set(plan.providers)
    : undefined;
  const cliCommand = [
    `cd ${input.workspaceRoot}`,
    `bun run workbench/run.ts --layers ${layerNames.join(",")}`,
    providers?.size ? `--providers ${Array.from(providers).join(",")}` : "",
  ].filter(Boolean).join(" ");

  try {
    const report = await executeWorkbenchRun({
      gateway: input.gateway,
      wsUrl: input.wsUrl,
      httpUrl: input.httpUrl,
      layerNames,
      providerFilters: providers,
    });
    return [{
      command: cliCommand,
      status: report.overall === "pass" ? "passed" : "failed",
      summary: `overall=${report.overall}, layers=${report.layers.length}, duration=${report.duration_ms}ms`,
      outputPreview: summarizeReport(report),
    }];
  } catch (error) {
    return [{
      command: cliCommand,
      status: "failed",
      summary: error instanceof Error ? error.message : String(error),
    }];
  }
}

function dedupeStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter((value) => value.trim().length > 0)));
}

function buildAnalysisSpaceName(context: Parameters<WorkbenchAnalystExecutor>[0]): string {
  return context.sourceType === "run"
    ? `Analyst ${context.sourceRunId ?? context.sessionId}`
    : `Analyst ${context.sourceSpaceId}`;
}

function buildAnalystPrompt(input: {
  context: Parameters<WorkbenchAnalystExecutor>[0];
  sourceEvidence: WorkbenchFixEvidence[];
  verificationCommands: WorkbenchVerificationCommand[];
  sourceRun: ReturnType<WorkbenchRunnerService["getRunDetail"]>;
  sourceSpaceId: string;
  sourceRootTurnId?: string;
}): string {
  const reportSummary = input.sourceRun?.reportPath
    ? `Saved report: ${input.sourceRun.reportPath}`
    : "No saved report file attached.";
  return [
    "Analyze the supplied workbench evidence and return exactly one JSON object.",
    "",
    "Requirements:",
    "- Return only JSON. No markdown fences.",
    "- JSON keys: summary, rootCause, evidence, reproductionCommands, proposedEdits, verificationCommands, draftPatch.",
    "- proposedEdits must be an array of objects with filePath, summary, and optional rationale.",
    "- evidence must be an array of objects with title and detail.",
    "- If draftPatch is unavailable, omit it.",
    "",
    `sourceType=${input.context.sourceType}`,
    `sourceRunId=${input.context.sourceRunId ?? "n/a"}`,
    `sourceSpaceId=${input.sourceSpaceId || "n/a"}`,
    `sourceRootTurnId=${input.sourceRootTurnId ?? "n/a"}`,
    reportSummary,
    "",
    "Source evidence:",
    input.sourceEvidence.map((evidence) => `## ${evidence.title}\n${evidence.detail}`).join("\n\n"),
    "",
    "Verification:",
    input.verificationCommands.map((command) =>
      `${command.command}\nstatus=${command.status}\n${command.summary ?? ""}\n${command.outputPreview ?? ""}`
    ).join("\n\n"),
    "",
    "Focus on the most likely concrete fix and keep evidence tied to observed failures.",
  ].join("\n");
}

export function selectTerminalLogicalTurn(turns: TurnRow[]): TurnRow | null {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    if (turn.status === "completed" || turn.status === "failed") {
      return turn;
    }
  }
  return null;
}

async function waitForTurnCompletion(
  turnRepo: TurnRepository,
  spaceId: string,
  logicalTurnId: string,
  signal: AbortSignal,
) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (signal.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }
    const turn = selectTerminalLogicalTurn(turnRepo.listByLogicalTurn(spaceId, logicalTurnId, 200, 0));
    if (turn) {
      return turn;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for analyst turn ${logicalTurnId} to complete.`);
}

function inferSourceSpaceId(detail: ReturnType<WorkbenchRunnerService["getRunDetail"]> | null): string | undefined {
  if (!detail) return undefined;
  const gatewaySpaceId = detail.gatewayEvents.find((event) => typeof event.payload.spaceId === "string");
  return typeof gatewaySpaceId?.payload.spaceId === "string" ? gatewaySpaceId.payload.spaceId : undefined;
}

function inferSourceRootTurnId(detail: ReturnType<WorkbenchRunnerService["getRunDetail"]> | null): string | undefined {
  if (!detail) return undefined;
  const gatewayTurnId = detail.gatewayEvents.find((event) => typeof event.payload.turnId === "string");
  return typeof gatewayTurnId?.payload.turnId === "string" ? gatewayTurnId.payload.turnId : undefined;
}

function summarizeReport(report: Awaited<ReturnType<typeof executeWorkbenchRun>>): string {
  const layerSummary = report.layers.map((layer) =>
    `${layer.name}:${layer.status}(${layer.scenarios.map((scenario) => `${scenario.name}:${scenario.status}`).join(",")})`
  ).join("; ");
  const paritySummary = (report.providerParity ?? []).map((row) =>
    `${row.provider}/${row.model}:${row.status}`
  ).join("; ");
  return [layerSummary, paritySummary].filter(Boolean).join("\n");
}

function parseFixProposal(
  text: string,
  fallback: {
    sourceEvidence: WorkbenchFixEvidence[];
    verificationCommands: WorkbenchVerificationCommand[];
  },
): WorkbenchFixProposal {
  const parsed = extractJsonRecord(text);
  if (!parsed) {
    return {
      summary: truncate(text || "Analyst completed without structured output.", 400),
      rootCause: "Analyst response did not match the expected structured JSON format.",
      evidence: fallback.sourceEvidence.slice(0, 6),
      reproductionCommands: fallback.verificationCommands.map((command) => command.command),
      proposedEdits: [],
      verificationCommands: fallback.verificationCommands,
    };
  }
  return {
    summary: stringValue(parsed.summary) ?? "No summary provided.",
    rootCause: stringValue(parsed.rootCause) ?? "No root cause provided.",
    evidence: arrayValue(parsed.evidence).map((item) => ({
      title: stringValue(item?.title) ?? "Evidence",
      detail: stringValue(item?.detail) ?? JSON.stringify(item),
    })),
    reproductionCommands: arrayValue(parsed.reproductionCommands).map((value) => String(value)),
    proposedEdits: arrayValue(parsed.proposedEdits).map((item) => ({
      filePath: stringValue(item?.filePath) ?? "",
      summary: stringValue(item?.summary) ?? "",
      ...(stringValue(item?.rationale) ? { rationale: stringValue(item?.rationale)! } : {}),
    })).filter((item) => item.filePath || item.summary),
    verificationCommands: arrayValue(parsed.verificationCommands).map((item) => ({
      command: stringValue(item?.command) ?? "",
      status: normalizeVerificationStatus(stringValue(item?.status)),
      ...(stringValue(item?.summary) ? { summary: stringValue(item?.summary)! } : {}),
      ...(stringValue(item?.outputPreview) ? { outputPreview: stringValue(item?.outputPreview)! } : {}),
    })).filter((item) => item.command),
    ...(stringValue(parsed.draftPatch) ? { draftPatch: stringValue(parsed.draftPatch)! } : {}),
  };
}

function extractJsonRecord(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const candidates = [trimmed];
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(trimmed.slice(firstBrace, lastBrace + 1));
  }
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      continue;
    }
  }
  return null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function arrayValue(value: unknown): Array<Record<string, unknown> | string> {
  return Array.isArray(value) ? value as Array<Record<string, unknown> | string> : [];
}

function normalizeVerificationStatus(value: string | undefined): "passed" | "failed" | "skipped" {
  if (value === "passed" || value === "failed" || value === "skipped") {
    return value;
  }
  return "failed";
}

function extractTurnText(payload: string | null | undefined): string {
  if (!payload) {
    return "";
  }
  try {
    const parsed = JSON.parse(payload) as Record<string, unknown>;
    return typeof parsed.text === "string" ? parsed.text : "";
  } catch {
    return "";
  }
}

function normalizeGatewayEvent(event: GatewayEvent): Record<string, unknown> {
  const record = event as GatewayEvent & Record<string, unknown>;
  const payload = typeof record.event === "object" && record.event !== null && !Array.isArray(record.event)
    ? record.event as Record<string, unknown>
    : {};
  return {
    eventType: event.type,
    observedAt: event.timestamp instanceof Date ? event.timestamp.toISOString() : new Date().toISOString(),
    ...(typeof record.spaceId === "string" ? { spaceId: record.spaceId } : {}),
    ...(typeof record.turnId === "string" ? { turnId: record.turnId } : {}),
    ...(typeof payload.type === "string" ? { subtype: payload.type } : {}),
    ...(typeof payload.text === "string" ? { textPreview: truncate(payload.text, 280) } : {}),
  };
}

function truncate(value: string, limit: number): string {
  return value.length > limit ? `${value.slice(0, limit - 1)}…` : value;
}

function safeParseJson(value: string | null | undefined): Record<string, unknown> | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
}
