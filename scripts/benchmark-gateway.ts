import { performance } from "node:perf_hooks";
import { randomUUID } from "node:crypto";
import { GatewayServer } from "../packages/server/src/gateway-server.js";
import { EventBus } from "../packages/core/src/events/event-bus.js";
import { MiddlewarePipeline } from "../packages/core/src/middleware/pipeline.js";
import type { Middleware, MiddlewareContext } from "../packages/core/src/middleware/types.js";
import { DefaultAgentRuntime } from "../packages/core/src/agents/default-agent-runtime.js";
import type {
  AgentConfig,
  TurnContext,
  TurnEvent,
} from "../packages/core/src/agents/agent-runtime.js";
import type {
  GenerateOptions,
  GenerateResult,
  ModelInfo,
  ModelProvider,
  StreamChunk,
  ToolDefinition,
  ToolResult,
} from "../packages/core/src/agents/model-provider.js";
import type { ToolAvailabilityOptions, ToolExecutionContext, ToolExecutor, ToolPermission } from "../packages/core/src/agents/tool-executor.js";
import {
  createTestClient,
  createTestGateway,
  randomPort,
  type TestGateway,
} from "../packages/bootstrap/test/e2e/harness.ts";

interface SampleStats {
  count: number;
  minMs: number;
  maxMs: number;
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
}

interface ThroughputStats extends SampleStats {
  operations: number;
  durationMs: number;
  opsPerSecond: number;
}

interface BenchmarkSection {
  key: string;
  title: string;
  summary: string;
  metrics: Record<string, unknown>;
}

function now(): number {
  return performance.now();
}

function sleep(ms: number): Promise<void> {
  return Bun.sleep(ms);
}

function bytes(sizeInBytes: number): string {
  const kib = 1024;
  const mib = kib * 1024;
  if (sizeInBytes >= mib) {
    return `${(sizeInBytes / mib).toFixed(2)} MiB`;
  }
  if (sizeInBytes >= kib) {
    return `${(sizeInBytes / kib).toFixed(2)} KiB`;
  }
  return `${sizeInBytes} B`;
}

function rssMb(): number {
  return Number((process.memoryUsage().rss / (1024 * 1024)).toFixed(2));
}

function maybeGc(): void {
  const gc = (globalThis as { gc?: (force?: boolean) => void }).gc;
  if (typeof gc === "function") {
    gc(true);
  }
}

function percentile(samples: number[], fraction: number): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * fraction) - 1),
  );
  return Number(sorted[index].toFixed(2));
}

function summarizeSamples(samples: number[]): SampleStats {
  if (samples.length === 0) {
    return {
      count: 0,
      minMs: 0,
      maxMs: 0,
      avgMs: 0,
      p50Ms: 0,
      p95Ms: 0,
    };
  }

  const total = samples.reduce((sum, sample) => sum + sample, 0);
  return {
    count: samples.length,
    minMs: Number(Math.min(...samples).toFixed(2)),
    maxMs: Number(Math.max(...samples).toFixed(2)),
    avgMs: Number((total / samples.length).toFixed(2)),
    p50Ms: percentile(samples, 0.5),
    p95Ms: percentile(samples, 0.95),
  };
}

function summarizeThroughput(samples: number[], startedAt: number): ThroughputStats {
  const base = summarizeSamples(samples);
  const durationMs = Number((now() - startedAt).toFixed(2));
  return {
    ...base,
    operations: samples.length,
    durationMs,
    opsPerSecond: durationMs === 0
      ? 0
      : Number(((samples.length * 1000) / durationMs).toFixed(2)),
  };
}

async function runWorkerPool<T>(
  total: number,
  concurrency: number,
  task: (index: number) => Promise<T>,
): Promise<T[]> {
  const results: T[] = new Array(total);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (true) {
      const current = nextIndex;
      nextIndex += 1;
      if (current >= total) return;
      results[current] = await task(current);
    }
  }

  const workerCount = Math.max(1, Math.min(concurrency, total));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

async function connectWs(url: string): Promise<WebSocket> {
  return new Promise<WebSocket>((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.addEventListener("open", () => resolve(ws), { once: true });
    ws.addEventListener("error", (event) => reject(event), { once: true });
  });
}

async function sendWebSocketPayload(url: string, payloadSizeBytes: number): Promise<{
  payloadSizeBytes: number;
  stayedOpen: boolean;
  latencyMs: number;
}> {
  const ws = await connectWs(url);
  const startedAt = now();
  const payload = JSON.stringify({
    type: "benchmark.invalid",
    id: randomUUID(),
    ts: new Date().toISOString(),
    payload: {
      blob: "x".repeat(Math.max(0, payloadSizeBytes - 160)),
    },
  });

  let closed = false;
  const closedPromise = new Promise<void>((resolve) => {
    ws.addEventListener("close", () => {
      closed = true;
      resolve();
    }, { once: true });
  });

  ws.send(payload);
  await Promise.race([closedPromise, sleep(75)]);
  const stayedOpen = !closed;
  if (stayedOpen) {
    ws.close();
    await Promise.race([closedPromise, sleep(25)]);
  }

  return {
    payloadSizeBytes,
    stayedOpen,
    latencyMs: Number((now() - startedAt).toFixed(2)),
  };
}

class NoopToolExecutor implements ToolExecutor {
  async getAvailableTools(
    _spaceId: string,
    _agentId: string,
    _options?: ToolAvailabilityOptions,
  ): Promise<ToolDefinition[]> {
    return [];
  }

  async checkPermission(
    toolCall: { name: string },
    _context: ToolExecutionContext,
  ): Promise<ToolPermission> {
    return { toolName: toolCall.name, allowed: true };
  }

  async execute(
    toolCall: { id: string },
    _context: ToolExecutionContext,
  ): Promise<ToolResult> {
    return {
      toolCallId: toolCall.id,
      result: { ok: true },
      isError: false,
    };
  }
}

type RuntimeMode = "success" | "mixed-error";

class BenchmarkModelProvider implements ModelProvider {
  readonly id = "benchmark-provider";
  readonly name = "Benchmark Provider";
  readonly isLocal = true;
  private callCount = 0;

  constructor(
    private readonly mode: RuntimeMode,
    private readonly delayMs: number,
  ) {}

  async checkHealth(): Promise<{ available: boolean; latencyMs?: number }> {
    return { available: true, latencyMs: 1 };
  }

  async listModels(): Promise<ModelInfo[]> {
    return [{
      id: "benchmark/model",
      name: "Benchmark Model",
      provider: "benchmark",
      isLocal: true,
    }];
  }

  async generate(_model: string, _options: GenerateOptions): Promise<GenerateResult> {
    this.callCount += 1;
    await sleep(this.delayMs);

    if (this.mode === "mixed-error") {
      const mode = this.callCount % 3;
      if (mode === 1) {
        const error = new Error("Rate limited during benchmark");
        (error as Error & { code?: string }).code = "RATE_LIMITED";
        throw error;
      }
      if (mode === 2) {
        throw new Error("Provider returned 500 during benchmark");
      }
      const timeoutError = new Error("Provider timeout during benchmark");
      (timeoutError as Error & { code?: string }).code = "TIMEOUT";
      throw timeoutError;
    }

    return {
      message: { role: "assistant", content: "benchmark-ok" },
      finishReason: "stop",
      usage: {
        promptTokens: 8,
        completionTokens: 4,
        totalTokens: 12,
      },
    };
  }

  async *stream(_model: string, _options: GenerateOptions): AsyncIterable<StreamChunk> {
    return;
  }
}

function buildRuntime(provider: ModelProvider): DefaultAgentRuntime {
  const config: AgentConfig = {
    id: "benchmark-agent",
    profileId: "benchmark-profile",
    systemPrompt: "You are a benchmark runtime.",
    modelProvider: provider.id,
    modelId: "benchmark/model",
    tools: [],
    maxSteps: 2,
  };

  return new DefaultAgentRuntime({
    config,
    modelProvider: provider,
    toolExecutor: new NoopToolExecutor(),
    eventBus: new EventBus(),
  });
}

async function executeBenchmarkTurn(
  runtime: DefaultAgentRuntime,
  index: number,
): Promise<{ latencyMs: number; completed: boolean; failed: boolean }> {
  const context: TurnContext = {
    spaceId: "benchmark-space",
    turnId: `benchmark-turn-${index}`,
    messages: [{ role: "user", content: `benchmark request ${index}` }],
    lineageId: "benchmark-lineage",
    hopCount: 0,
    maxHops: 4,
  };

  const startedAt = now();
  const events: TurnEvent[] = [];
  for await (const event of runtime.executeTurn(context)) {
    events.push(event);
  }

  return {
    latencyMs: Number((now() - startedAt).toFixed(2)),
    completed: events.some((event) => event.type === "turn_completed"),
    failed: events.some((event) => event.type === "turn_failed")
      || !events.some((event) => event.type === "turn_completed"),
  };
}

async function benchmarkPingThroughput(): Promise<BenchmarkSection> {
  const concurrencyLevels = [1, 10, 50];
  const perClientOperations = 25;
  const metrics: Record<string, unknown> = {};

  for (const concurrency of concurrencyLevels) {
    const gateway = await createTestGateway({ maxConnectionsPerIp: 128 });
    const clients = await Promise.all(
      Array.from({ length: concurrency }, () => createTestClient(gateway.wsUrl)),
    );

    try {
      const latencies: number[] = [];
      const startedAt = now();
      await Promise.all(clients.map(async (client) => {
        for (let i = 0; i < perClientOperations; i += 1) {
          const opStarted = now();
          await client.ping();
          latencies.push(now() - opStarted);
        }
      }));
      metrics[`${concurrency}_clients`] = summarizeThroughput(latencies, startedAt);
    } finally {
      await Promise.all(clients.map((client) => client.disconnect()));
      await gateway.cleanup();
    }
  }

  return {
    key: "message_throughput",
    title: "Message Throughput",
    summary: "Measured end-to-end ping throughput across 1, 10, and 50 concurrent WebSocket clients.",
    metrics,
  };
}

async function benchmarkSqliteWriteContention(): Promise<BenchmarkSection> {
  const gateway = await createTestGateway({ maxConnectionsPerIp: 64 });
  const concurrency = 8;
  const operations = 64;
  const clients = await Promise.all(
    Array.from({ length: concurrency }, () => createTestClient(gateway.wsUrl)),
  );

  try {
    const latencies: number[] = [];
    const startedAt = now();
    const results = await runWorkerPool(operations, concurrency, async (index) => {
      const client = clients[index % clients.length];
      const opStarted = now();
      const space = await client.createSpace({
        idempotencyKey: `benchmark-space-${index}`,
        resourceId: `resource:benchmark:${index}`,
        name: `Benchmark Space ${index}`,
        goal: "SQLite write contention benchmark",
      });
      latencies.push(now() - opStarted);
      return space.id;
    });

    return {
      key: "sqlite_write_contention",
      title: "SQLite Write Contention",
      summary: "Concurrent `space.create` writes against the embedded SQLite gateway.",
      metrics: {
        concurrency,
        operations,
        createdSpaces: results.length,
        stats: summarizeThroughput(latencies, startedAt),
      },
    };
  } finally {
    await Promise.all(clients.map((client) => client.disconnect()));
    await gateway.cleanup();
  }
}

async function benchmarkLargePayloadGuard(): Promise<BenchmarkSection> {
  const server = new GatewayServer({
    port: randomPort(),
    host: "127.0.0.1",
    skipAuth: true,
    eventBus: new EventBus(),
    onMessage: async () => null,
    maxPayloadLength: 1_048_576,
  });

  server.start();
  const wsUrl = `ws://127.0.0.1:${server.port}`;

  try {
    const results = [];
    for (const size of [256 * 1024, 1_024 * 1_024, Math.floor(1.25 * 1024 * 1024)]) {
      results.push(await sendWebSocketPayload(wsUrl, size));
    }

    return {
      key: "large_payload_guard",
      title: "Large Payload Handling",
      summary: "Measured how the WebSocket server reacts around the 1 MiB payload guardrail.",
      metrics: {
        maxPayloadLengthBytes: 1_048_576,
        payloads: results.map((result) => ({
          payload: bytes(result.payloadSizeBytes),
          stayedOpen: result.stayedOpen,
          latencyMs: result.latencyMs,
        })),
      },
    };
  } finally {
    await server.stop();
  }
}

async function benchmarkHttpRateLimiting(): Promise<BenchmarkSection> {
  const server = new GatewayServer({
    port: randomPort(),
    host: "127.0.0.1",
    skipAuth: true,
    eventBus: new EventBus(),
    onMessage: async () => null,
    httpRateLimitRpm: 30,
  });

  server.start();
  const url = `http://127.0.0.1:${server.port}/health`;

  try {
    const startedAt = now();
    const responses = await Promise.all(
      Array.from({ length: 60 }, async () => {
        const opStarted = now();
        const response = await fetch(url);
        return {
          status: response.status,
          latencyMs: now() - opStarted,
        };
      }),
    );

    return {
      key: "http_rate_limit",
      title: "HTTP Rate Limiting",
      summary: "Burst-tested `/health` against a low per-IP HTTP rate limit.",
      metrics: {
        configuredRpm: 30,
        totalRequests: responses.length,
        statusCounts: responses.reduce<Record<string, number>>((counts, response) => {
          const key = String(response.status);
          counts[key] = (counts[key] ?? 0) + 1;
          return counts;
        }, {}),
        stats: summarizeThroughput(
          responses.map((response) => response.latencyMs),
          startedAt,
        ),
      },
    };
  } finally {
    await server.stop();
  }
}

async function benchmarkConnectionCap(): Promise<BenchmarkSection> {
  const server = new GatewayServer({
    port: randomPort(),
    host: "127.0.0.1",
    skipAuth: true,
    eventBus: new EventBus(),
    onMessage: async () => null,
    maxConnectionsPerIp: 10,
  });

  server.start();
  const wsUrl = `ws://127.0.0.1:${server.port}`;
  const httpUrl = `http://127.0.0.1:${server.port}/`;
  const sockets: WebSocket[] = [];

  try {
    for (let i = 0; i < 10; i += 1) {
      sockets.push(await connectWs(wsUrl));
    }

    const rejections = await Promise.all(
      Array.from({ length: 5 }, async () => {
        const response = await fetch(httpUrl, {
          headers: {
            Upgrade: "websocket",
            Connection: "Upgrade",
            "Sec-WebSocket-Key": btoa(randomUUID()),
            "Sec-WebSocket-Version": "13",
          },
        });
        return response.status;
      }),
    );

    return {
      key: "connection_cap",
      title: "Connection Cap",
      summary: "Filled the per-IP WebSocket cap and measured the rejection path for extra upgrades.",
      metrics: {
        configuredCap: 10,
        acceptedConnections: sockets.length,
        rejectionStatuses: rejections,
      },
    };
  } finally {
    for (const socket of sockets) {
      socket.close();
    }
    await server.stop();
  }
}

async function benchmarkMemoryPressure(): Promise<BenchmarkSection> {
  maybeGc();
  const beforeRss = rssMb();
  const gateway = await createTestGateway({ maxConnectionsPerIp: 64 });
  const clients = await Promise.all(
    Array.from({ length: 20 }, () => createTestClient(gateway.wsUrl)),
  );

  try {
    const latencies: number[] = [];
    const startedAt = now();
    await Promise.all(clients.map(async (client) => {
      for (let i = 0; i < 50; i += 1) {
        const opStarted = now();
        await client.ping();
        latencies.push(now() - opStarted);
      }
    }));
    maybeGc();
    const afterRss = rssMb();

    return {
      key: "memory_pressure",
      title: "Memory Pressure",
      summary: "Measured RSS drift during a 1,000-operation WebSocket ping soak.",
      metrics: {
        rssBeforeMb: beforeRss,
        rssAfterMb: afterRss,
        rssDeltaMb: Number((afterRss - beforeRss).toFixed(2)),
        stats: summarizeThroughput(latencies, startedAt),
      },
    };
  } finally {
    await Promise.all(clients.map((client) => client.disconnect()));
    await gateway.cleanup();
  }
}

async function benchmarkRuntimeTurns(mode: RuntimeMode): Promise<BenchmarkSection> {
  const concurrency = mode === "success" ? 16 : 12;
  const operations = mode === "success" ? 96 : 72;
  const runtimes = Array.from({ length: concurrency }, () => (
    buildRuntime(new BenchmarkModelProvider(mode, mode === "success" ? 3 : 2))
  ));
  const startedAt = now();
  const results = await runWorkerPool(
    operations,
    concurrency,
    (index) => executeBenchmarkTurn(runtimes[index % runtimes.length], index),
  );
  const latencies = results.map((result) => result.latencyMs);

  return {
    key: mode === "success" ? "turn_contention" : "error_cascade",
    title: mode === "success" ? "Concurrent Turn Contention" : "Error Cascade Resilience",
    summary: mode === "success"
      ? "Ran concurrent same-space turns through `DefaultAgentRuntime` with a fast local stub provider."
      : "Ran concurrent same-space turns while the provider alternated rate-limit, 500, and timeout failures.",
    metrics: {
      concurrency,
      operations,
      runtimeInstances: runtimes.length,
      spaceMode: "same_space_multi_agent",
      completedTurns: results.filter((result) => result.completed).length,
      failedTurns: results.filter((result) => result.failed).length,
      stats: summarizeThroughput(latencies, startedAt),
    },
  };
}

async function benchmarkMiddlewareDepth(): Promise<BenchmarkSection> {
  const pipeline = new MiddlewarePipeline();
  const depth = 250;
  const invocations = 500;

  for (let index = 0; index < depth; index += 1) {
    const middleware: Middleware = {
      name: `benchmark-depth-${index}`,
      layer: "turn",
      order: index,
      process: async (ctx: MiddlewareContext, next) => {
        ctx.metadata[`mw_${index}`] = true;
        await next();
      },
    };
    pipeline.use(middleware);
  }

  const latencies: number[] = [];
  const startedAt = now();

  for (let index = 0; index < invocations; index += 1) {
    const opStarted = now();
    const ctx = MiddlewarePipeline.createContext("turn", { input: index });
    await pipeline.execute("turn", ctx, async () => {
      ctx.output = { ok: true };
    });
    latencies.push(now() - opStarted);
  }

  return {
    key: "middleware_depth",
    title: "Middleware Stack Depth",
    summary: "Executed a 250-layer onion middleware stack repeatedly to verify stack safety and latency.",
    metrics: {
      depth,
      invocations,
      stats: summarizeThroughput(latencies, startedAt),
    },
  };
}

async function benchmarkSanitizationFlood(): Promise<BenchmarkSection> {
  const gateway = await createTestGateway({ maxConnectionsPerIp: 32 });
  const client = await createTestClient(gateway.wsUrl);
  const operations = 64;
  const concurrency = 8;
  const startedAt = now();

  try {
    const results = await runWorkerPool(operations, concurrency, async (index) => {
      const opStarted = now();
      try {
        await client.createSpace({
          idempotencyKey: `benchmark-invalid-${index}`,
          name: "",
          resourceId: "",
        } as any);
        return { rejected: false, latencyMs: now() - opStarted, index };
      } catch {
        return { rejected: true, latencyMs: now() - opStarted, index };
      }
    });

    const latencies = results.map((result) => result.latencyMs);

    return {
      key: "sanitization_flood",
      title: "Sanitization Under Load",
      summary: "Flooded the gateway with invalid `space.create` payloads to verify fast, stable validation failure behavior.",
      metrics: {
        operations,
        concurrency,
        rejectedRequests: results.filter((result) => result.rejected).length,
        unexpectedlyAccepted: results.filter((result) => !result.rejected).length,
        stats: summarizeThroughput(latencies, startedAt),
      },
    };
  } finally {
    await client.disconnect();
    await gateway.cleanup();
  }
}

function printMarkdownReport(sections: BenchmarkSection[], startedAt: Date): void {
  console.log(`# Gateway Benchmark Report`);
  console.log("");
  console.log(`Generated: ${startedAt.toISOString()}`);
  console.log(`Host RSS at report time: ${rssMb()} MiB`);
  console.log(`Bun version: ${Bun.version}`);
  console.log("");

  for (const section of sections) {
    console.log(`## ${section.title}`);
    console.log(section.summary);
    console.log("");
    console.log("```json");
    console.log(JSON.stringify(section.metrics, null, 2));
    console.log("```");
    console.log("");
  }
}

async function main(): Promise<void> {
  const startedAt = new Date();
  const sections: BenchmarkSection[] = [
    await benchmarkPingThroughput(),
    await benchmarkRuntimeTurns("success"),
    await benchmarkLargePayloadGuard(),
    await benchmarkRuntimeTurns("mixed-error"),
    await benchmarkMemoryPressure(),
    await benchmarkSqliteWriteContention(),
    await benchmarkHttpRateLimiting(),
    await benchmarkConnectionCap(),
    await benchmarkMiddlewareDepth(),
    await benchmarkSanitizationFlood(),
  ];

  if (process.argv.includes("--json")) {
    console.log(JSON.stringify({
      generatedAt: startedAt.toISOString(),
      bunVersion: Bun.version,
      sections,
    }, null, 2));
    return;
  }

  printMarkdownReport(sections, startedAt);
}

await main();
