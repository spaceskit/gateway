import { describe, test, expect } from "bun:test";
import { createSecretsMiddleware } from "../../src/middleware/builtin/secrets-middleware.js";
import type { MiddlewareContext } from "../../src/middleware/types.js";
import { EventBus } from "../../src/events/event-bus.js";

function makeContext(overrides?: Partial<MiddlewareContext>): MiddlewareContext {
  return {
    layer: "capability",
    input: {},
    metadata: {},
    terminate: false,
    startedAt: new Date(),
    ...overrides,
  };
}

describe("secrets middleware — pattern detection", () => {
  test("AWS access key detected", async () => {
    const eventBus = new EventBus();
    const emitted: unknown[] = [];
    eventBus.on("security.secrets_detected", (evt) => emitted.push(evt));

    const mw = createSecretsMiddleware({
      eventBus,
      config: { autoRedact: false },
    });

    const ctx = makeContext({
      input: "Use this key: AKIAIOSFODNN7EXAMPLE",
    });

    await mw.process(ctx, async () => {});

    expect(emitted.length).toBeGreaterThanOrEqual(1);
  });

  test("OpenAI key detected", async () => {
    const eventBus = new EventBus();
    const emitted: unknown[] = [];
    eventBus.on("security.secrets_detected", (evt) => emitted.push(evt));

    const mw = createSecretsMiddleware({
      eventBus,
      config: { autoRedact: false },
    });

    const ctx = makeContext({
      input: "export OPENAI_API_KEY=sk-abc123def456ghi789jklmnopqrstuvwxyz",
    });

    await mw.process(ctx, async () => {});

    expect(emitted.length).toBeGreaterThanOrEqual(1);
  });

  test("Bearer token detected", async () => {
    const eventBus = new EventBus();
    const emitted: unknown[] = [];
    eventBus.on("security.secrets_detected", (evt) => emitted.push(evt));

    const mw = createSecretsMiddleware({
      eventBus,
      config: { autoRedact: false },
    });

    const ctx = makeContext({
      input: "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U",
    });

    await mw.process(ctx, async () => {});

    expect(emitted.length).toBeGreaterThanOrEqual(1);
  });

  test("private key block detected", async () => {
    const eventBus = new EventBus();
    const emitted: unknown[] = [];
    eventBus.on("security.secrets_detected", (evt) => emitted.push(evt));

    const mw = createSecretsMiddleware({
      eventBus,
      config: { autoRedact: false },
    });

    const ctx = makeContext({
      input: "-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAK...\n-----END RSA PRIVATE KEY-----",
    });

    await mw.process(ctx, async () => {});

    expect(emitted.length).toBeGreaterThanOrEqual(1);
  });

  test("high-entropy string detected", async () => {
    const eventBus = new EventBus();
    const emitted: unknown[] = [];
    eventBus.on("security.secrets_detected", (evt) => emitted.push(evt));

    const mw = createSecretsMiddleware({
      eventBus,
      config: { autoRedact: false, confidenceThreshold: 0.3 },
    });

    // A random-looking high-entropy string (base64-like)
    const ctx = makeContext({
      input: "token=aB3cD4eF5gH6iJ7kL8mN9oP0qR1sT2u",
    });

    await mw.process(ctx, async () => {});

    expect(emitted.length).toBeGreaterThanOrEqual(1);
  });

  test("clean text passes through", async () => {
    const eventBus = new EventBus();
    const emitted: unknown[] = [];
    eventBus.on("security.secrets_detected", (evt) => emitted.push(evt));

    const mw = createSecretsMiddleware({
      eventBus,
      config: { autoRedact: false },
    });

    const ctx = makeContext({
      input: "This is a normal sentence with no secrets or credentials.",
    });

    await mw.process(ctx, async () => {});

    expect(emitted.length).toBe(0);
    expect(ctx.terminate).toBe(false);
  });
});

describe("secrets middleware — block mode", () => {
  test("sets ctx.terminate on detection when blockOnDetection is true", async () => {
    const eventBus = new EventBus();

    const mw = createSecretsMiddleware({
      eventBus,
      blockOnDetection: true,
      config: { autoRedact: false },
    });

    const ctx = makeContext({
      input: "key: AKIAIOSFODNN7EXAMPLE",
    });

    let nextCalled = false;
    await mw.process(ctx, async () => {
      nextCalled = true;
    });

    expect(ctx.terminate).toBe(true);
    expect(nextCalled).toBe(false);
    expect(ctx.output).toBeDefined();
    const output = ctx.output as Record<string, unknown>;
    expect(output.error).toBe("SECRETS_DETECTED");
  });
});

describe("secrets middleware — multiple secrets", () => {
  test("multiple secrets in one input all detected", async () => {
    const eventBus = new EventBus();
    const emitted: Array<Record<string, unknown>> = [];
    eventBus.on("security.secrets_detected", (evt) => emitted.push(evt as Record<string, unknown>));

    const mw = createSecretsMiddleware({
      eventBus,
      config: { autoRedact: false },
    });

    const ctx = makeContext({
      input:
        "AWS: AKIAIOSFODNN7EXAMPLE\n" +
        "OpenAI: sk-abc123def456ghi789jklmnopqrstuvwxyz\n" +
        "-----BEGIN RSA PRIVATE KEY-----\nblob\n-----END RSA PRIVATE KEY-----",
    });

    await mw.process(ctx, async () => {});

    expect(emitted.length).toBeGreaterThanOrEqual(1);
    // The event should aggregate multiple secrets
    const evt = emitted[0];
    expect((evt.secretCount as number)).toBeGreaterThanOrEqual(3);
  });
});
