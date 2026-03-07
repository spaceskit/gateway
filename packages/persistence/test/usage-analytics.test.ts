import { afterEach, describe, expect, test } from "bun:test";
import { initDatabase } from "../src/database.js";
import { RunRepository } from "../src/repositories/runs.js";
import { RunStepRepository } from "../src/repositories/run-steps.js";
import { SpaceRepository } from "../src/repositories/spaces.js";
import { UsageAnalyticsRepository } from "../src/repositories/usage-analytics.js";
import { UsageRecordRepository } from "../src/repositories/usage-records.js";

const dbManagers: ReturnType<typeof initDatabase>[] = [];

afterEach(() => {
  while (dbManagers.length > 0) {
    dbManagers.pop()?.close();
  }
});

function createContext() {
  const db = initDatabase({
    path: ":memory:",
    runtimeGeneration: `test-usage-analytics-${crypto.randomUUID()}`,
  });
  dbManagers.push(db);

  const spaces = new SpaceRepository(db.db);
  spaces.create({
    spaceId: "space-1",
    resourceId: "resource-1",
    spaceType: "space",
    name: "Space 1",
    goal: "",
    turnModel: "sequential_all",
    configJson: "{}",
  });

  return {
    runs: new RunRepository(db.db),
    runSteps: new RunStepRepository(db.db),
    usageRecords: new UsageRecordRepository(db.db),
    usageAnalytics: new UsageAnalyticsRepository(db.db),
  };
}

describe("UsageAnalyticsRepository", () => {
  test("aggregates usage from usage_records and exposes mixed accuracy", () => {
    const ctx = createContext();

    ctx.runs.create({
      runId: "run-1",
      spaceId: "space-1",
      targetAgentId: "agent-1",
      createdAt: "2026-03-07T10:00:00.000Z",
    });
    ctx.runSteps.create({
      stepId: "step-1",
      runId: "run-1",
      spaceId: "space-1",
      agentId: "agent-1",
      sequenceNo: 1,
      kind: "executor_invocation",
      createdAt: "2026-03-07T10:00:00.000Z",
    });
    ctx.usageRecords.create({
      usageRecordId: "usage-1",
      runId: "run-1",
      stepId: "step-1",
      spaceId: "space-1",
      providerId: "claude",
      modelId: "claude/sonnet",
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
      tokenAccuracy: "estimated",
      createdAt: "2026-03-07T10:00:01.000Z",
    });

    ctx.runs.create({
      runId: "run-2",
      spaceId: "space-1",
      targetAgentId: "agent-1",
      createdAt: "2026-03-07T11:00:00.000Z",
    });
    ctx.runSteps.create({
      stepId: "step-2",
      runId: "run-2",
      spaceId: "space-1",
      agentId: "agent-1",
      sequenceNo: 1,
      kind: "model_invocation",
      createdAt: "2026-03-07T11:00:00.000Z",
    });
    ctx.usageRecords.create({
      usageRecordId: "usage-2",
      runId: "run-2",
      stepId: "step-2",
      spaceId: "space-1",
      providerId: "openrouter",
      modelId: "openrouter/openai/gpt-4.1-mini",
      promptTokens: 60,
      completionTokens: 40,
      totalTokens: 100,
      tokenAccuracy: "reported",
      createdAt: "2026-03-07T11:00:02.000Z",
    });

    const aggregate = ctx.usageAnalytics.aggregateTokens();
    expect(aggregate.inputTokens).toBe(160);
    expect(aggregate.outputTokens).toBe(90);
    expect(aggregate.totalTokens).toBe(250);
    expect(aggregate.tokenAccuracy).toBe("mixed");
    expect(aggregate.usageSource).toBe("ledger");

    const providerUsage = ctx.usageAnalytics.aggregateByProvider();
    expect(providerUsage.find((row) => row.providerId === "claude")?.tokenAccuracy).toBe("estimated");
    expect(providerUsage.find((row) => row.providerId === "openrouter")?.tokenAccuracy).toBe("reported");

    const agentUsage = ctx.usageAnalytics.listAgentAggregatesBySpace("space-1");
    expect(agentUsage).toHaveLength(1);
    expect(agentUsage[0]).toMatchObject({
      agentId: "agent-1",
      runCount: 2,
      inputTokens: 160,
      outputTokens: 90,
      totalTokens: 250,
      tokenAccuracy: "mixed",
      usageSource: "ledger",
    });
  });
});
