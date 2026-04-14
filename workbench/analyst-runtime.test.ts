import { describe, expect, test } from "bun:test";
import type { WorkbenchJobRunDetail } from "./runner-protocol.js";
import { buildPersistedVerificationCommands, deriveVerificationPlan, selectTerminalLogicalTurn } from "./analyst-runtime.js";

function makeRunDetail(overrides: Partial<WorkbenchJobRunDetail> = {}): WorkbenchJobRunDetail {
  return {
    id: "run-1",
    name: "Source Run",
    source: "cli",
    status: "failed",
    config: {
      name: "Source Run",
      layers: ["chat-roundtrip", "provider-tool-parity", "orchestration"],
      providers: ["claude", "codex"],
    },
    createdAt: "2026-04-10T09:00:00.000Z",
    updatedAt: "2026-04-10T09:00:00.000Z",
    snapshot: {
      layers: [
        {
          name: "chat-roundtrip",
          status: "pass",
          scenarios: [{ name: "basic", status: "pass" }],
        },
        {
          name: "provider-tool-parity",
          status: "fail",
          scenarios: [{ name: "live", status: "fail" }],
        },
        {
          name: "orchestration",
          status: "pass",
          scenarios: [{ name: "planner", status: "pass" }],
        },
      ],
      providerParity: [
        {
          provider: "codex-app-server",
          model: "codex-app-server/gpt-5.4",
          transport: "mediated",
          status: "fail",
        },
        {
          provider: "gemini",
          model: "gemini-2.5-flash",
          transport: "mediated_fallback",
          status: "fail",
        },
        {
          provider: "claude",
          model: "sonnet",
          transport: "bridge",
          status: "pass",
        },
      ],
      schedulerEvalRuns: [],
      comparisons: [],
    },
    runnerEvents: [],
    gatewayEvents: [],
    ...overrides,
  };
}

describe("deriveVerificationPlan", () => {
  test("targets failing provider parity layer and provider subset for run-sourced sessions", () => {
    const plan = deriveVerificationPlan({
      sourceType: "run",
      sourceRun: makeRunDetail(),
    });

    expect(plan.layerNames).toEqual(["provider-tool-parity"]);
    expect(plan.providers).toEqual(["codex-app-server"]);
  });

  test("falls back to failing non-parity layers and preserves configured providers", () => {
    const plan = deriveVerificationPlan({
      sourceType: "run",
      sourceRun: makeRunDetail({
        snapshot: {
          layers: [
            {
              name: "orchestration",
              status: "fail",
              scenarios: [{ name: "planner", status: "fail" }],
            },
          ],
          providerParity: [],
          schedulerEvalRuns: [],
          comparisons: [],
        },
      }),
    });

    expect(plan.layerNames).toEqual(["orchestration"]);
    expect(plan.providers).toEqual(["claude", "codex"]);
  });

  test("defaults to orchestration for space-sourced sessions", () => {
    const plan = deriveVerificationPlan({
      sourceType: "space",
      sourceRun: null,
    });

    expect(plan.layerNames).toEqual(["orchestration"]);
    expect(plan.providers).toBeUndefined();
  });
});

describe("buildPersistedVerificationCommands", () => {
  test("reuses failing provider parity evidence from the source run", () => {
    const commands = buildPersistedVerificationCommands({
      sourceRun: makeRunDetail(),
      workspaceRoot: "/Users/caruso/code/spaces",
    });

    expect(commands).not.toBeNull();
    expect(commands).toHaveLength(1);
    expect(commands?.[0]?.command).toContain("--layers provider-tool-parity --providers codex-app-server");
    expect(commands?.[0]?.status).toBe("failed");
    expect(commands?.[0]?.summary).toContain("Reused persisted provider parity evidence");
    expect(commands?.[0]?.outputPreview).toContain("provider=codex-app-server");
  });

  test("returns null when the source run has no failing provider parity rows", () => {
    const commands = buildPersistedVerificationCommands({
      sourceRun: makeRunDetail({
        snapshot: {
          layers: [
            {
              name: "orchestration",
              status: "fail",
              scenarios: [{ name: "planner", status: "fail" }],
            },
          ],
          providerParity: [],
          schedulerEvalRuns: [],
          comparisons: [],
        },
      }),
      workspaceRoot: "/Users/caruso/code/spaces",
    });

    expect(commands).toBeNull();
  });
});

describe("selectTerminalLogicalTurn", () => {
  test("returns the latest completed or failed row for a logical turn", () => {
    const terminal = selectTerminalLogicalTurn([
      {
        turn_id: "child-1",
        space_id: "space-1",
        actor_type: "agent",
        actor_id: "analyst",
        input_json: null,
        output_json: null,
        status: "started",
        token_input_count: 0,
        token_output_count: 0,
        connector_provider: "",
        requested_connector: "",
        effective_connector: "",
        fallback_reason: "",
        fallback_used: 0,
        user_turn_id: "logical-turn",
        race_id: "",
        race_rank: 0,
        race_score: 0,
        race_winner: 0,
        moderator_rationale: "",
        created_at: "2026-04-10T10:00:00.000Z",
        completed_at: null,
        reply_to_turn_id: null,
      },
      {
        turn_id: "child-2",
        space_id: "space-1",
        actor_type: "agent",
        actor_id: "analyst",
        input_json: null,
        output_json: "{\"text\":\"done\"}",
        status: "completed",
        token_input_count: 10,
        token_output_count: 20,
        connector_provider: "",
        requested_connector: "",
        effective_connector: "",
        fallback_reason: "",
        fallback_used: 0,
        user_turn_id: "logical-turn",
        race_id: "",
        race_rank: 0,
        race_score: 0,
        race_winner: 0,
        moderator_rationale: "",
        created_at: "2026-04-10T10:00:01.000Z",
        completed_at: "2026-04-10T10:00:02.000Z",
        reply_to_turn_id: null,
      },
    ]);

    expect(terminal?.turn_id).toBe("child-2");
    expect(terminal?.status).toBe("completed");
  });

  test("returns null when no logical-turn rows are terminal yet", () => {
    const terminal = selectTerminalLogicalTurn([
      {
        turn_id: "child-1",
        space_id: "space-1",
        actor_type: "agent",
        actor_id: "analyst",
        input_json: null,
        output_json: null,
        status: "started",
        token_input_count: 0,
        token_output_count: 0,
        connector_provider: "",
        requested_connector: "",
        effective_connector: "",
        fallback_reason: "",
        fallback_used: 0,
        user_turn_id: "logical-turn",
        race_id: "",
        race_rank: 0,
        race_score: 0,
        race_winner: 0,
        moderator_rationale: "",
        created_at: "2026-04-10T10:00:00.000Z",
        completed_at: null,
        reply_to_turn_id: null,
      },
    ]);

    expect(terminal).toBeNull();
  });
});
