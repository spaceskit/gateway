import { describe, expect, test } from "bun:test";
import {
  computeWorkbenchOverallStatus,
  type LayerResult,
  type ProviderParityRow,
} from "./report.js";

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

describe("workbench report parity status", () => {
  test("treats unavailable provider rows as non-failing", () => {
    expect(computeWorkbenchOverallStatus([makeLayer("pass")], [makeRow("unavailable")])).toBe("pass");
  });

  test("fails overall status when any provider parity row fails", () => {
    expect(computeWorkbenchOverallStatus([makeLayer("pass")], [makeRow("fail")])).toBe("fail");
  });
});
