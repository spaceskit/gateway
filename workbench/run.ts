#!/usr/bin/env bun
/**
 * Workbench — E2E Test Bench
 *
 * Boots a persistent gateway on port 19320, seeds fixtures,
 * runs layered test scenarios, and reports results.
 *
 * Usage:
 *   bun run workbench/run.ts              # Run scenarios and exit
 *   bun run workbench/run.ts --interactive # Run scenarios then stay alive
 *   bun run workbench/run.ts --serve-only  # Boot without running scenarios
 */

import { join } from "node:path";
import { startGateway } from "../packages/bootstrap/src/index.js";
import {
  GatewayClient,
  WorkbenchAdapterClient,
  generateAuthKeyPair,
  type AdapterProviderRegistration,
} from "./client.js";
import { seedFixtures } from "./fixtures.js";
import {
  printConsoleReport,
  saveJsonReport,
} from "./report.js";
import { startDashboard } from "./dashboard.js";
import { filterWorkbenchLayers, parseWorkbenchArgs } from "./options.js";
import { executeWorkbenchRun, WORKBENCH_LAYERS, buildWorkbenchLayerCatalog } from "./runtime.js";
import { WorkbenchAnalystService } from "./analyst-service.js";
import { createWorkbenchAnalystRuntime } from "./analyst-runtime.js";
import { WorkbenchExecutionGate } from "./execution-gate.js";
import { WorkbenchRunnerService } from "./runner-service.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const WORKBENCH_PORT = 19_320;
const WORKBENCH_HOST = "127.0.0.1";
const DEFAULT_DB_PATH = join(import.meta.dir, "workbench.db");
const DEFAULT_REPORTS_DIR = join(import.meta.dir, "reports");

// ---------------------------------------------------------------------------
// CLI Flags
// ---------------------------------------------------------------------------

const cliOptions = parseWorkbenchArgs(process.argv.slice(2), {
  dbPath: DEFAULT_DB_PATH,
  reportsDir: DEFAULT_REPORTS_DIR,
});

// ---------------------------------------------------------------------------
// MCP Echo Server (child process)
// ---------------------------------------------------------------------------

function spawnMcpEchoServer(): Bun.Subprocess {
  const serverPath = join(import.meta.dir, "mcp-echo-server.ts");
  const proc = Bun.spawn(["bun", "run", serverPath], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "inherit",
  });
  return proc;
}

// ---------------------------------------------------------------------------
// Adapter Capabilities
// ---------------------------------------------------------------------------

function benchAdapterRegistrations(): AdapterProviderRegistration[] {
  return [
    {
      provider: {
        id: "bench.echo",
        name: "Bench Echo",
        source: "adapter" as const,
        capabilityType: "lists",
        operations: ["echo", "delay"],
      },
      handlers: {
        echo: async (a: Record<string, unknown>) => ({ echoed: a }),
        delay: async (a: Record<string, unknown>) => {
          const ms = typeof a.ms === "number" ? a.ms : 100;
          await new Promise((r) => setTimeout(r, ms));
          return { delayed: ms };
        },
      },
    },
  ];
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log(
    `\n  Workbench starting on ${WORKBENCH_HOST}:${WORKBENCH_PORT}...\n`,
  );

  // 1. Boot gateway
  const previousProfile = Bun.env.SPACESKIT_GATEWAY_PROFILE;
  const previousSecretRefMasterKey = Bun.env.SPACESKIT_SECRET_REF_MASTER_KEY;
  Bun.env.SPACESKIT_GATEWAY_PROFILE = "embedded";
  if (!previousSecretRefMasterKey) {
    Bun.env.SPACESKIT_SECRET_REF_MASTER_KEY = "workbench-local-secret-ref-master-key";
  }

  const gateway = await startGateway({
    port: WORKBENCH_PORT,
    host: WORKBENCH_HOST,
    dbPath: cliOptions.dbPath,
    logLevel: "warn",
    skipAuth: false,
    a2aRequireAuth: false,
    syncRequireSecret: false,
    runtimeGeneration: "workbench_v1",
    mainSpaceId: "workbench-main",
    mainProfileId: "workbench-profile",
    mainOrchestratorProfileId: "workbench-profile",
    mainAgentId: "workbench-agent",
    archFreezeEnforced: false,
    gatewayCapabilityGrants: [
      "lists.read",
      "lists.write",
      "lists.execute",
    ],
  } as Record<string, unknown>);

  // Restore env
  if (previousProfile === undefined) {
    delete Bun.env.SPACESKIT_GATEWAY_PROFILE;
  } else {
    Bun.env.SPACESKIT_GATEWAY_PROFILE = previousProfile;
  }
  if (previousSecretRefMasterKey === undefined) {
    delete Bun.env.SPACESKIT_SECRET_REF_MASTER_KEY;
  } else {
    Bun.env.SPACESKIT_SECRET_REF_MASTER_KEY = previousSecretRefMasterKey;
  }

  const wsUrl = `ws://${WORKBENCH_HOST}:${WORKBENCH_PORT}`;
  const httpUrl = `http://${WORKBENCH_HOST}:${WORKBENCH_PORT}`;
  const selectedLayers = filterWorkbenchLayers(WORKBENCH_LAYERS, cliOptions.layers);
  const selectedLayerNames = selectedLayers.map((layer) => layer.name);
  const selectedProviders = cliOptions.providers ? Array.from(cliOptions.providers) : undefined;
  const runnerDb = gateway.db?.db;
  if (!runnerDb) {
    throw new Error("Workbench runner requires an initialized gateway database.");
  }
  const executionGate = new WorkbenchExecutionGate();
  const runner = new WorkbenchRunnerService({
    db: runnerDb,
    reportsDir: cliOptions.reportsDir,
    gateway,
    layerCatalog: buildWorkbenchLayerCatalog(WORKBENCH_LAYERS),
    defaultLayers: WORKBENCH_LAYERS.map((layer) => layer.name),
    executionGate,
    executor: async (context) => ({
      report: await executeWorkbenchRun({
        gateway,
        wsUrl,
        httpUrl,
        layerNames: context.config.layers,
        providerFilters: context.config.providers.length > 0 ? new Set(context.config.providers) : undefined,
        registerSpace: context.registerSpace,
        registerTurn: context.registerTurn,
        recordProviderParityRow: context.onProviderParityRow,
        recordSchedulerEvalRun: context.onSchedulerEvalRun,
        recordComparison: context.onComparison,
        updateMessage: context.updateMessage,
        onLayerStarted: context.onLayerStarted,
        onLayerCompleted: context.onLayerCompleted,
        onScenarioStarted: context.onScenarioStarted,
        onScenarioCompleted: context.onScenarioCompleted,
      }),
    }),
  });
  runner.initialize();
  const analyst = cliOptions.interactive || cliOptions.serveOnly
    ? (() => {
      const runtime = createWorkbenchAnalystRuntime({
        gateway,
        runner,
        wsUrl,
        httpUrl,
        workspaceRoot: process.cwd(),
      });
      const service = new WorkbenchAnalystService({
        db: runnerDb,
        executionGate,
        resolveRunSource: runtime.resolveRunSource,
        resolveSpaceSource: runtime.resolveSpaceSource,
        executor: runtime.executor,
      });
      service.initialize();
      return service;
    })()
    : null;

  const dashboard = cliOptions.interactive || cliOptions.serveOnly
    ? startDashboard({
      reportsDir: cliOptions.reportsDir,
      runner,
      analyst: analyst ?? undefined,
    })
    : null;

  console.log(`  Gateway ready: ${httpUrl}`);
  console.log(`  WebSocket:     ${wsUrl}`);
  console.log(`  Database:      ${cliOptions.dbPath}\n`);
  if (dashboard) {
    console.log(`  Dashboard:     http://${WORKBENCH_HOST}:${dashboard.port}\n`);
  }

  // 2. Spawn MCP echo server
  const mcpProc = spawnMcpEchoServer();
  console.log("  MCP echo server spawned (stdio)\n");

  // 3. Create client and seed fixtures
  const keyPair = await generateAuthKeyPair();
  const seedClient = new GatewayClient({
    url: wsUrl,
    reconnect: false,
    requestTimeoutMs: 15_000,
    deviceId: "workbench-seed",
    devicePublicKey: keyPair.publicKeyBase64,
  });
  seedClient.setAuthKeyPair(keyPair);

  // Wait for auth event on gateway side
  const seedAuthPromise = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      unsub();
      reject(new Error("Seed client auth timeout"));
    }, 10_000);
    const unsub = gateway.eventBus.on("client.authenticated", () => {
      clearTimeout(timer);
      unsub();
      resolve();
    });
  });

  await seedClient.connect();
  await seedAuthPromise;

  // Also wait for client-side auth to be usable
  const authStart = Date.now();
  while (Date.now() - authStart < 5_000) {
    await new Promise((r) => setTimeout(r, 100));
    try {
      await seedClient.ping();
      break;
    } catch {
      // Keep waiting
    }
  }

  const fixtures = await seedFixtures(seedClient);
  console.log("  Fixtures seeded:");
  console.log(`    chat space:         ${fixtures.chatSpace.id}`);
  console.log(`    mcp space:          ${fixtures.mcpSpace.id}`);
  console.log(`    orchestrator space:  ${fixtures.orchestratorSpace.id}`);
  console.log(`    profile:            ${fixtures.profileId}\n`);

  await seedClient.disconnect();

  // 4. Register adapter capabilities
  const adapterKeyPair = await generateAuthKeyPair();
  const adapter = new WorkbenchAdapterClient({
    url: wsUrl,
    reconnect: false,
    requestTimeoutMs: 10_000,
    authKeyPair: adapterKeyPair,
    deviceId: "workbench-adapter",
    devicePublicKey: adapterKeyPair.publicKeyBase64,
  });

  // Wait for auth event before connecting adapter
  const adapterAuthPromise = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      unsub();
      reject(new Error("Adapter auth timeout"));
    }, 10_000);
    const unsub = gateway.eventBus.on("client.authenticated", () => {
      clearTimeout(timer);
      unsub();
      resolve();
    });
  });

  await adapter.connect();
  await adapterAuthPromise;
  await adapter.registerProviders(benchAdapterRegistrations());
  console.log("  Adapter capabilities registered\n");

  // 5. Run scenarios (unless --serve-only)
  if (!cliOptions.serveOnly) {
    console.log("  Running scenarios...\n");

    if (cliOptions.interactive) {
      const initialRun = runner.runNow({
        name: selectedProviders?.length
          ? `Interactive ${selectedLayerNames.join(", ")} · ${selectedProviders.join(", ")}`
          : `Interactive ${selectedLayerNames.join(", ")}`,
        layers: selectedLayerNames,
        ...(selectedProviders ? { providers: selectedProviders } : {}),
        source: "cli",
      });
      console.log(`  Initial run queued: ${initialRun.id}\n`);
    } else {
      const report = await executeWorkbenchRun({
        gateway,
        wsUrl,
        httpUrl,
        layerNames: selectedLayerNames,
        providerFilters: cliOptions.providers,
      });
      printConsoleReport(report);
      const reportPath = await saveJsonReport(report, cliOptions.reportsDir);
      console.log(`\n  Report saved: ${reportPath}\n`);
      await analyst?.shutdown();
      await runner.shutdown();
      await adapter.disconnect();
      mcpProc.kill();
      await gateway.shutdown();
      process.exit(report.overall === "pass" ? 0 : 1);
    }
  }

  console.log(
    "\n  Workbench is running. Press Ctrl+C to stop.\n",
  );
  console.log(`  Connect your app to: ${wsUrl}`);
  console.log(`  HTTP health check:   ${httpUrl}/health`);
  if (dashboard) {
    console.log(`  Dashboard:           http://${WORKBENCH_HOST}:${dashboard.port}\n`);
  }

  // Handle graceful shutdown
  const shutdown = async () => {
    console.log("\n  Shutting down workbench...");
    dashboard?.stop();
    await analyst?.shutdown();
    await runner.shutdown();
    await adapter.disconnect();
    mcpProc.kill();
    await gateway.shutdown();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

if (import.meta.main) {
  main().catch((err) => {
    console.error("Workbench failed:", err);
    process.exit(1);
  });
}
