import { describe, expect, test } from "bun:test";
import {
  TurnObservationCollector,
  deriveHttpUrlFromWsUrl,
  executeWorkbenchScenarioRun,
  listWorkbenchScenarios,
  resolveProvisioningStrategy,
} from "../src/index.js";

describe("workbench runner package", () => {
  test("exposes a product scenario catalog with a deterministic smoke scenario", () => {
    const catalog = listWorkbenchScenarios();

    expect(catalog.layers.some((layer) => layer.layerId === "harness-smoke")).toBe(true);
    expect(catalog.scenarios).toContainEqual({
      scenarioId: "harness.smoke.noop",
      layerId: "harness-smoke",
      name: "Deterministic Harness Smoke",
      description: "No-op scenario used to verify gateway-to-runner wiring without external services.",
      tags: ["fast", "deterministic", "harness"],
      requiredCapabilities: [],
      defaultEnabled: true,
    });
  });

  test("keeps headless harness helpers inside the runner package", () => {
    expect(deriveHttpUrlFromWsUrl("ws://127.0.0.1:9321")).toBe("http://127.0.0.1:9321");
    expect(deriveHttpUrlFromWsUrl("wss://gateway.example.test")).toBe("https://gateway.example.test");
    expect(() => resolveProvisioningStrategy("in-process", "built-in-mcp-admin")).toThrow(
      "built-in-mcp-admin provisioning is only supported in external mode",
    );
  });

  test("collects headless turn stream and completion state", () => {
    const collector = new TurnObservationCollector("space-1");
    collector.bindTurn("turn-1");
    collector.ingestStream({
      spaceId: "space-1",
      spaceUid: "space-1",
      turnId: "turn-1",
      agentId: "agent-1",
      delta: "Hello ",
      seq: 0,
      done: false,
    });
    collector.ingestEvent({
      spaceId: "space-1",
      spaceUid: "space-1",
      turnId: "turn-1",
      eventType: "completed",
      data: {
        result: {
          finalMessage: "Hello world",
        },
      },
      typedPayload: {
        kind: "turn.completed",
        agentId: "agent-1",
        finalMessage: "Hello world",
      },
    });
    collector.ingestStream({
      spaceId: "space-1",
      spaceUid: "space-1",
      turnId: "turn-1",
      agentId: "agent-1",
      delta: "world",
      seq: 1,
      done: true,
    });

    const snapshot = collector.snapshot();
    expect(snapshot.status).toBe("completed");
    expect(snapshot.finalMessage).toBe("Hello world");
    expect(snapshot.streamText).toBe("Hello world");
  });

  test("runs the deterministic smoke scenario without writing into tracked workbench paths", async () => {
    const report = await executeWorkbenchScenarioRun({
      config: {
        scenarioIds: ["harness.smoke.noop"],
      },
      repoRoot: process.cwd(),
    });

    expect(report.status).toBe("passed");
    expect(report.scenarios).toHaveLength(1);
    expect(report.scenarios[0]?.scenario_id).toBe("harness.smoke.noop");
    expect(report.report_dir).toContain(".spaceskit-workbench/workbench-runner");
    expect(report.report_dir).not.toContain("gateway/workbench/reports");
    expect(report.report_dir).not.toContain("dev-services/.artifacts");
  });
});
