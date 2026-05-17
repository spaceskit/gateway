import { afterEach, describe, expect, test } from "bun:test";
import {
  ApprovalRequestRepository,
  InvocationRecordRepository,
  RunRepository,
  RunStepRepository,
  SpaceRepository,
  UsageRecordRepository,
  initDatabase,
} from "@spaceskit/persistence";
import { RuntimeLedgerService } from "../src/services/runtime-ledger-service.js";

const dbManagers: ReturnType<typeof initDatabase>[] = [];

afterEach(() => {
  while (dbManagers.length > 0) {
    dbManagers.pop()?.close();
  }
});

function createContext() {
  const db = initDatabase({
    path: ":memory:",
    runtimeGeneration: `test-runtime-ledger-${crypto.randomUUID()}`,
  });
  dbManagers.push(db);

  const spaces = new SpaceRepository(db.db);
  const runs = new RunRepository(db.db);
  const runSteps = new RunStepRepository(db.db);
  const invocationRecords = new InvocationRecordRepository(db.db);
  const approvalRequests = new ApprovalRequestRepository(db.db);
  const usageRecords = new UsageRecordRepository(db.db);

  const service = new RuntimeLedgerService({
    runs,
    runSteps,
    invocationRecords,
    approvalRequests,
    usageRecords,
    classifyIntegrationClass: () => "model_provider",
  });

  return {
    db: db.db,
    spaces,
    runs,
    runSteps,
    service,
  };
}

describe("RuntimeLedgerService", () => {
  test("skips turn events for spaces that do not exist instead of throwing a foreign-key error", () => {
    const context = createContext();

    expect(() => context.service.recordTurnEvent({
      spaceId: "missing-space",
      turnId: "turn-missing",
      event: {
        type: "error",
        error: new Error("Space missing"),
      },
    })).not.toThrow();

    expect(context.runs.getByTurnId("turn-missing")).toBeUndefined();
  });

  test("does not persist text deltas as run steps for existing spaces", () => {
    const context = createContext();
    context.spaces.create({
      spaceId: "space-1",
      resourceId: "resource-1",
      spaceType: "space",
      name: "Space 1",
      goal: "",
      turnModel: "sequential_all",
      configJson: "{}",
    });

    context.service.recordTurnStarted({
      spaceId: "space-1",
      turnId: "turn-1",
      inputText: "hello",
      targetAgentId: "agent-1",
    });
    context.service.recordTurnEvent({
      spaceId: "space-1",
      turnId: "turn-1",
      agentId: "agent-1",
      event: {
        type: "text_delta",
        text: "partial output",
      },
    });

    const columns = context.db.query("PRAGMA table_info(runs)").all() as Array<{ name: string }>;
    expect(columns.some((column) => column.name === "turn_id")).toBe(true);

    const run = context.runs.getByTurnId("turn-1");
    expect(run).toBeDefined();
    expect(run?.space_id).toBe("space-1");

    const steps = context.runSteps.listByRun(run!.run_id);
    expect(steps).toHaveLength(0);
  });
});
