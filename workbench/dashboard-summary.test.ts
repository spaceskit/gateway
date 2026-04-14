import { describe, expect, test } from "bun:test";
import type { WorkbenchAnalystSessionDetail, WorkbenchJobRunDetail } from "./runner-protocol.js";
import type { WorkbenchReport } from "./report.js";
import {
  buildAnalystNarrativeSummary,
  buildReportNarrativeSummary,
  buildRunNarrativeSummary,
} from "./dashboard-summary.js";

function makeFailedRunDetail(): WorkbenchJobRunDetail {
  return {
    id: "run-failed",
    name: "Interactive chat-roundtrip, mcp-tools, provider-tool-parity, orchestration",
    source: "cli",
    status: "failed",
    config: {
      name: "Interactive chat-roundtrip, mcp-tools, provider-tool-parity, orchestration",
      layers: ["chat-roundtrip", "mcp-tools", "provider-tool-parity", "orchestration"],
      providers: [],
    },
    createdAt: "2026-04-10T08:53:30.892Z",
    updatedAt: "2026-04-10T08:57:17.205Z",
    startedAt: "2026-04-10T08:53:30.892Z",
    finishedAt: "2026-04-10T08:57:17.205Z",
    durationMs: 226313,
    reportFilename: "2026-04-10T08-57-17.201Z.json",
    reportPath: "/tmp/report.json",
    exitSummary: "Run completed with failing checks.",
    overallStatus: "fail",
    snapshot: {
      layers: [
        {
          name: "chat-roundtrip",
          status: "pass",
          scenarios: [{ name: "create-space", status: "pass", durationMs: 10 }],
          durationMs: 10,
        },
        {
          name: "mcp-tools",
          status: "pass",
          scenarios: [{ name: "adapter-echo-invoke", status: "pass", durationMs: 10 }],
          durationMs: 10,
        },
        {
          name: "provider-tool-parity",
          status: "fail",
          scenarios: [
            {
              name: "default-access-gateway-tools",
              status: "fail",
              durationMs: 10,
              error: "Provider parity failures: codex-app-server/gpt-5.4, gemini/gemini-2.5-flash",
            },
            {
              name: "codex-app-server-explicit-runtime-selection",
              status: "fail",
              durationMs: 10,
              error: "Final answer did not include marker codex-app-server-5dd4406e.",
            },
          ],
          durationMs: 20,
        },
        {
          name: "orchestration",
          status: "pass",
          scenarios: [{ name: "planner-multi-guest-review-synthesis", status: "pass", durationMs: 10 }],
          durationMs: 10,
        },
      ],
      providerParity: [
        {
          scope: "live",
          provider: "codex-app-server",
          model: "codex-app-server/gpt-5.4",
          transport: "mediated",
          status: "fail",
          observedToolCall: "lists.echo({})",
          failureReason: "Final answer did not include marker codex-app-server-5dd4406e.",
        },
        {
          scope: "live",
          provider: "gemini",
          model: "gemini/gemini-2.5-flash",
          transport: "mediated_fallback",
          status: "fail",
          failureReason: "Timed out waiting for the turn to reach a terminal event.",
        },
      ],
      schedulerEvalRuns: [{ evalRunId: "eval-1" } as never],
      comparisons: [],
    },
    runnerEvents: [],
    gatewayEvents: [],
  };
}

function makePassingReport(): WorkbenchReport {
  return {
    timestamp: "2026-04-10T07:39:09.744Z",
    duration_ms: 170007,
    overall: "pass",
    runContext: {
      program: "Autoresearch Eval Workbench Program",
      layerNames: ["chat-roundtrip", "mcp-tools", "provider-tool-parity", "orchestration"],
      scenarioCount: 9,
      evalRunCount: 1,
      providerParityCount: 5,
    },
    layers: [
      {
        name: "chat-roundtrip",
        status: "pass",
        duration_ms: 10,
        scenarios: [{ name: "create-space", status: "pass", duration_ms: 10 }],
      },
      {
        name: "provider-tool-parity",
        status: "pass",
        duration_ms: 10,
        scenarios: [{ name: "default-access-gateway-tools", status: "pass", duration_ms: 10 }],
      },
    ],
    providerParity: [
      {
        provider: "apple",
        model: "apple/apple-on-device",
        transport: "native",
        status: "pass",
      },
    ],
    schedulerEvalRuns: [{ evalRunId: "eval-1" } as never],
    comparisons: [],
  };
}

function makeAnalystDetail(overrides: Partial<WorkbenchAnalystSessionDetail> = {}): WorkbenchAnalystSessionDetail {
  return {
    id: "session-1",
    sourceType: "run",
    sourceRunId: "run-failed",
    sourceSpaceId: "space-source",
    sourceRootTurnId: "turn-source",
    analysisSpaceId: "space-analysis",
    analysisRootTurnId: "turn-analysis",
    status: "completed",
    phase: "drafting_fix",
    authority: "proposal_only",
    createdAt: "2026-04-10T10:00:00.000Z",
    updatedAt: "2026-04-10T10:01:00.000Z",
    startedAt: "2026-04-10T10:00:00.000Z",
    finishedAt: "2026-04-10T10:01:00.000Z",
    durationMs: 60_000,
    exitSummary: "Two provider parity failures detected.",
    snapshot: {
      message: "Running analyst synthesis turn",
      verificationCommands: [],
      evidence: [],
    },
    proposal: {
      summary: "Two provider parity failures detected.",
      rootCause: "The failing providers diverged in tool parity.",
      evidence: [],
      reproductionCommands: [],
      proposedEdits: [],
      verificationCommands: [],
    },
    events: [],
    gatewayEvents: [],
    ...overrides,
  };
}

describe("dashboard narrative summaries", () => {
  test("buildRunNarrativeSummary explains a failed provider-parity run", () => {
    const summary = buildRunNarrativeSummary(makeFailedRunDetail());
    expect(summary.headline).toBe("Run failed in provider-tool-parity");
    expect(summary.primaryFailures).toEqual([
      "codex-app-server/codex-app-server/gpt-5.4: Final answer did not include marker codex-app-server-5dd4406e.",
      "gemini/gemini/gemini-2.5-flash: Timed out waiting for the turn to reach a terminal event.",
    ]);
    expect(summary.passedAreas).toEqual(["chat-roundtrip", "mcp-tools", "orchestration"]);
    expect(summary.nextActions).toEqual(["Retry run", "Open report", "Analyze run"]);
    expect(summary.counts.failedScenarios).toBe(2);
    expect(summary.counts.failedProviderChecks).toBe(2);
    expect(summary.activityLabel).toBe("run finished");
  });

  test("buildReportNarrativeSummary explains a fully passing report", () => {
    const summary = buildReportNarrativeSummary(makePassingReport());
    expect(summary.headline).toBe("Run passed");
    expect(summary.primaryFailures).toEqual([]);
    expect(summary.passedAreas).toEqual(["chat-roundtrip", "provider-tool-parity"]);
    expect(summary.counts.failedScenarios).toBe(0);
    expect(summary.counts.failedProviderChecks).toBe(0);
    expect(summary.counts.schedulerEvalPayloads).toBe(1);
  });

  test("buildAnalystNarrativeSummary shows fix proposal created for completed terminal sessions", () => {
    const summary = buildAnalystNarrativeSummary(makeAnalystDetail(), {
      sourceRun: makeFailedRunDetail(),
    });
    expect(summary.headline).toBe("Diagnosis of failed run run-failed");
    expect(summary.humanStatusLabel).toBe("Fix proposal created");
    expect(summary.sourceRunStatusLabel).toBe("failed");
    expect(summary.nextActions).toEqual(["Review fix proposal", "Retry diagnosis"]);
  });

  test("buildAnalystNarrativeSummary shows failure state when no proposal exists", () => {
    const summary = buildAnalystNarrativeSummary(makeAnalystDetail({
      status: "failed",
      proposal: undefined,
      exitSummary: "Timed out waiting for analyst turn to complete.",
    }));
    expect(summary.humanStatusLabel).toBe("Diagnosis failed");
    expect(summary.nextActions).toEqual(["Retry diagnosis"]);
    expect(summary.primaryFailures).toEqual(["Timed out waiting for analyst turn to complete."]);
  });
});
