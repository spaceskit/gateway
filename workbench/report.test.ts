import { describe, expect, test } from "bun:test";
import {
  computeWorkbenchOverallStatus,
  type LayerResult,
  type ProviderParityRow,
} from "./report.js";
import type { SchedulerEvalRunPayload } from "../packages/server/src/protocol/scheduler.js";

function makeLayer(status: LayerResult["status"]): LayerResult {
  return {
    name: "chat-roundtrip",
    status,
    scenarios: [],
    duration_ms: 1,
  };
}

function makeRow(status: ProviderParityRow["status"]): ProviderParityRow {
  return {
    provider: "gemini",
    model: "gemini/gemini-2.5-flash",
    transport: "mediated_fallback",
    status,
  };
}

function makeEvalRun(
  overrides: Partial<SchedulerEvalRunPayload> = {},
): SchedulerEvalRunPayload {
  return {
    evalRunId: "run-1",
    evalDefinitionId: "suite:full",
    scenarioIds: ["space-interactions.in-process-combined-smoke"],
    summaryMode: "checkpoints",
    selfImproveEnabled: false,
    artifactRefs: [],
    checkpoints: [
      {
        checkpointId: "cp-1",
        kind: "summary.completed",
        status: "completed",
        createdAt: "2026-01-01T00:00:01.000Z",
      },
    ],
    scenarioResults: [
      {
        scenarioId: "space-interactions.in-process-combined-smoke",
        status: "pass",
        checkpointCount: 1,
      },
    ],
    recommendations: [],
    ...overrides,
  };
}

describe("workbench report parity status", () => {
  test("treats unavailable provider rows as non-failing", () => {
    expect(computeWorkbenchOverallStatus([makeLayer("pass")], [makeRow("unavailable")])).toBe("pass");
  });

  test("fails overall status when any provider parity row fails", () => {
    expect(computeWorkbenchOverallStatus([makeLayer("pass")], [makeRow("fail")])).toBe("fail");
  });

  test("fails overall status when any canonical eval scenario fails", () => {
    const baseline = makeEvalRun();
    expect(
      computeWorkbenchOverallStatus(
        [makeLayer("pass")],
        [],
        [{
          ...baseline,
          scenarioResults: [{
            scenarioId: "space-interactions.in-process-combined-smoke",
            status: "fail",
            checkpointCount: 1,
            failureReason: "planner failed",
          }],
        }],
      ),
    ).toBe("fail");
  });

  test("fails overall status when any canonical eval checkpoint fails", () => {
    const baseline = makeEvalRun();
    expect(
      computeWorkbenchOverallStatus(
        [makeLayer("pass")],
        [],
        [{
          ...baseline,
          checkpoints: [{
            checkpointId: "cp-1",
            kind: "summary.failed",
            status: "failed",
            createdAt: "2026-01-01T00:00:01.000Z",
          }],
        }],
      ),
    ).toBe("fail");
  });
});
