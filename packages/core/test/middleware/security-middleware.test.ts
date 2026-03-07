import { describe, test, expect } from "bun:test";
import { createSecurityMiddleware } from "../../src/middleware/builtin/security-middleware.js";
import type { MiddlewareContext } from "../../src/middleware/types.js";
import type { AgentSecurityScope } from "../../src/security/types.js";
import { EventBus } from "../../src/events/event-bus.js";

function makeContext(overrides?: Partial<MiddlewareContext>): MiddlewareContext {
  return {
    layer: "turn",
    input: {},
    metadata: {},
    terminate: false,
    startedAt: new Date(),
    ...overrides,
  };
}

function makeSandboxScope(agentId: string): AgentSecurityScope {
  return {
    agentId,
    permissionMode: "sandbox",
    allowedCapabilities: [],
    filesystemScope: "",
    allowNetwork: false,
    allowShell: false,
    commandAllowlist: [],
    maxTokensPerTurn: 16384,
    maxToolCallsPerTurn: 20,
    requireOutputReview: false,
  };
}

describe("security middleware — pre-hook", () => {
  test("sets security scope metadata for sandbox agents", async () => {
    const eventBus = new EventBus();
    const scope = makeSandboxScope("agent-1");

    const mw = createSecurityMiddleware({
      eventBus,
      resolveScope: async () => scope,
    });

    const ctx = makeContext({ spaceId: "space-1", agentId: "agent-1" });
    await mw.process(ctx, async () => {});

    expect(ctx.metadata.securityScope).toEqual(scope);
  });
});

describe("security middleware — post-hook output inspection", () => {
  test("detects secrets in output when inspectAgentOutput enabled", async () => {
    const eventBus = new EventBus();
    const emitted: unknown[] = [];
    eventBus.on("security.secrets_detected", (evt) => emitted.push(evt));

    const mw = createSecurityMiddleware({
      eventBus,
      policy: {
        policyId: "test",
        defaultPermissionMode: "sandbox",
        outOfScopeVerdict: "deny",
        inspectAgentOutput: true,
        maxCallDepth: 5,
        crossSpaceRequiresApproval: true,
        auditCapabilityInvocations: false,
        redactionMode: "STANDARD",
        updatedAt: new Date(),
      },
      secretsConfig: {
        scanAgentOutput: true,
        scanToolResults: true,
        autoRedact: false,
        confidenceThreshold: 0.7,
        customPatterns: [],
      },
    });

    const ctx = makeContext({
      spaceId: "space-1",
      agentId: "agent-1",
    });

    // Set output with a secret after next()
    await mw.process(ctx, async () => {
      ctx.output = "Here is the key: sk_abcdefghijklmnopqrstuvwxyz123456";
    });

    expect(emitted.length).toBe(1);
  });

  test("ignores clean output", async () => {
    const eventBus = new EventBus();
    const emitted: unknown[] = [];
    eventBus.on("security.secrets_detected", (evt) => emitted.push(evt));

    const mw = createSecurityMiddleware({
      eventBus,
      policy: {
        policyId: "test",
        defaultPermissionMode: "sandbox",
        outOfScopeVerdict: "deny",
        inspectAgentOutput: true,
        maxCallDepth: 5,
        crossSpaceRequiresApproval: true,
        auditCapabilityInvocations: false,
        redactionMode: "STANDARD",
        updatedAt: new Date(),
      },
      secretsConfig: {
        scanAgentOutput: true,
        scanToolResults: true,
        autoRedact: false,
        confidenceThreshold: 0.7,
        customPatterns: [],
      },
    });

    const ctx = makeContext({
      spaceId: "space-1",
      agentId: "agent-1",
    });

    await mw.process(ctx, async () => {
      ctx.output = "This is perfectly clean output with no secrets at all.";
    });

    expect(emitted.length).toBe(0);
  });

  test("detects API key patterns (sk-proj-...)", async () => {
    const eventBus = new EventBus();
    const emitted: Array<Record<string, unknown>> = [];
    eventBus.on("security.secrets_detected", (evt) => emitted.push(evt as Record<string, unknown>));

    const mw = createSecurityMiddleware({
      eventBus,
      policy: {
        policyId: "test",
        defaultPermissionMode: "sandbox",
        outOfScopeVerdict: "deny",
        inspectAgentOutput: true,
        maxCallDepth: 5,
        crossSpaceRequiresApproval: true,
        auditCapabilityInvocations: false,
        redactionMode: "STANDARD",
        updatedAt: new Date(),
      },
      secretsConfig: {
        scanAgentOutput: true,
        scanToolResults: true,
        autoRedact: false,
        confidenceThreshold: 0.7,
        customPatterns: [],
      },
    });

    const ctx = makeContext({ spaceId: "s1", agentId: "a1" });

    await mw.process(ctx, async () => {
      ctx.output = "Use this key: sk_abc123def456ghi789jklmnopqrstuvw";
    });

    expect(emitted.length).toBe(1);
    expect((emitted[0].types as string[]).some((t: string) => t === "api_key")).toBe(true);
  });

  test("detects Bearer token patterns", async () => {
    const eventBus = new EventBus();
    const emitted: Array<Record<string, unknown>> = [];
    eventBus.on("security.secrets_detected", (evt) => emitted.push(evt as Record<string, unknown>));

    const mw = createSecurityMiddleware({
      eventBus,
      policy: {
        policyId: "test",
        defaultPermissionMode: "sandbox",
        outOfScopeVerdict: "deny",
        inspectAgentOutput: true,
        maxCallDepth: 5,
        crossSpaceRequiresApproval: true,
        auditCapabilityInvocations: false,
        redactionMode: "STANDARD",
        updatedAt: new Date(),
      },
      secretsConfig: {
        scanAgentOutput: true,
        scanToolResults: true,
        autoRedact: false,
        confidenceThreshold: 0.7,
        customPatterns: [],
      },
    });

    const ctx = makeContext({ spaceId: "s1", agentId: "a1" });

    await mw.process(ctx, async () => {
      ctx.output = "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.signature";
    });

    expect(emitted.length).toBe(1);
    expect((emitted[0].types as string[]).some((t: string) => t === "bearer_token")).toBe(true);
  });
});
