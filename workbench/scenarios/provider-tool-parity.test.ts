import { describe, expect, test } from "bun:test";
import {
  classifyLiveParityFailureStatus,
  extractObservedRuntimeSelection,
  liveParityTimeoutMs,
  normalizeProviderParityToolName,
  shouldRetryLiveParityFailure,
  SUPPORTED_PROVIDERS,
  validateObservedRuntimeSelection,
  validateLiveParityObservation,
} from "./provider-tool-parity.js";

describe("provider tool parity helpers", () => {
  test("includes codex app server in the supported provider parity set", () => {
    expect(SUPPORTED_PROVIDERS).toContain("codex-app-server");
  });

  test("normalizes bridge MCP tool names to canonical gateway tool names", () => {
    expect(normalizeProviderParityToolName("lists.echo")).toBe("lists.echo");
    expect(normalizeProviderParityToolName("mcp__spaceskit-gateway__lists_echo")).toBe("lists.echo");
  });

  test("bridge transport accepts matching tool start plus terminal marker without tool result", () => {
    expect(validateLiveParityObservation({
      transport: "bridge",
      observedToolCallName: "mcp__spaceskit-gateway__lists_echo",
      observedToolResultPresent: false,
      finalAnswer: "PARITY_OK marker-123",
      marker: "marker-123",
    })).toEqual({ ok: true });
  });

  test("mediated transport still requires a tool result", () => {
    expect(validateLiveParityObservation({
      transport: "mediated",
      observedToolCallName: "lists.echo",
      observedToolResultPresent: false,
      finalAnswer: "PARITY_OK marker-123",
      marker: "marker-123",
    })).toEqual({
      ok: false,
      failureReason: "Expected a tool result event for the echoed marker.",
    });
  });

  test("mediated fallback transport still requires a tool result", () => {
    expect(validateLiveParityObservation({
      transport: "mediated_fallback",
      observedToolCallName: "lists.echo",
      observedToolResultPresent: false,
      finalAnswer: "PARITY_OK marker-123",
      marker: "marker-123",
    })).toEqual({
      ok: false,
      failureReason: "Expected a tool result event for the echoed marker.",
    });
  });

  test("unrelated namespaced tools do not false-positive", () => {
    expect(validateLiveParityObservation({
      transport: "bridge",
      observedToolCallName: "mcp__spaceskit-gateway__search_web",
      observedToolResultPresent: false,
      finalAnswer: "PARITY_OK marker-123",
      marker: "marker-123",
    })).toEqual({
      ok: false,
      failureReason: "Expected a lists.echo tool call during the turn.",
    });
  });

  test("uses a longer live timeout window for bridge and mediated providers", () => {
    expect(liveParityTimeoutMs("bridge")).toBe(45_000);
    expect(liveParityTimeoutMs("native")).toBe(20_000);
    expect(liveParityTimeoutMs("mediated")).toBe(45_000);
    expect(liveParityTimeoutMs("mediated_fallback")).toBe(45_000);
  });

  test("retries transient bridge parity failures once", () => {
    expect(shouldRetryLiveParityFailure({
      provider: "codex",
      transport: "bridge",
      failureReason: "Timed out waiting for the turn to reach a terminal event.",
      attempt: 1,
      maxAttempts: 2,
    })).toBe(true);
    expect(shouldRetryLiveParityFailure({
      provider: "claude",
      transport: "bridge",
      failureReason: "Expected a lists.echo tool call during the turn.",
      attempt: 1,
      maxAttempts: 2,
    })).toBe(true);
  });

  test("retries transient apple native parity misses once", () => {
    expect(shouldRetryLiveParityFailure({
      provider: "apple",
      transport: "native",
      failureReason: "Expected a lists.echo tool call during the turn.",
      attempt: 1,
      maxAttempts: 2,
    })).toBe(true);
  });

  test("does not retry non-bridge or terminal parity failures", () => {
    expect(shouldRetryLiveParityFailure({
      provider: "codex-app-server",
      transport: "mediated",
      failureReason: "Timed out waiting for the turn to reach a terminal event.",
      attempt: 1,
      maxAttempts: 2,
    })).toBe(false);
    expect(shouldRetryLiveParityFailure({
      provider: "lmstudio",
      transport: "native",
      failureReason: "Timed out waiting for the turn to reach a terminal event.",
      attempt: 1,
      maxAttempts: 2,
    })).toBe(false);
    expect(shouldRetryLiveParityFailure({
      provider: "claude",
      transport: "bridge",
      failureReason: "Final answer did not include marker marker-123.",
      attempt: 1,
      maxAttempts: 2,
    })).toBe(false);
    expect(shouldRetryLiveParityFailure({
      provider: "codex",
      transport: "bridge",
      failureReason: "Timed out waiting for the turn to reach a terminal event.",
      attempt: 2,
      maxAttempts: 2,
    })).toBe(false);
  });

  test("classifies gemini quota and rate-limit evidence as unavailable", () => {
    expect(classifyLiveParityFailureStatus({
      provider: "gemini",
      transport: "mediated_fallback",
      failureReason: "Timed out waiting for the turn to reach a terminal event.",
      sawRateLimitedEvent: true,
    })).toBe("unavailable");
    expect(classifyLiveParityFailureStatus({
      provider: "gemini",
      transport: "mediated_fallback",
      failureReason: "Attempt 1 failed: You have exhausted your capacity on this model. Your quota will reset after 1s.. Retrying after 5648ms...",
      sawRateLimitedEvent: false,
    })).toBe("unavailable");
  });

  test("keeps non-gemini and non-transient parity failures as hard failures", () => {
    expect(classifyLiveParityFailureStatus({
      provider: "codex",
      transport: "bridge",
      failureReason: "Attempt 1 failed: You have exhausted your capacity on this model.",
      sawRateLimitedEvent: true,
    })).toBe("fail");
    expect(classifyLiveParityFailureStatus({
      provider: "gemini",
      transport: "mediated_fallback",
      failureReason: "Expected a lists.echo tool call during the turn.",
      sawRateLimitedEvent: false,
    })).toBe("fail");
  });

  test("prefers turn.completed metadata when extracting observed runtime selection", () => {
    expect(extractObservedRuntimeSelection({
      turnEvents: [{
        spaceId: "space-1",
        spaceUid: "space-1",
        turnId: "turn-1",
        eventType: "completed",
        data: {},
        typedPayload: {
          kind: "turn.completed",
          metadata: {
            providerId: "codex-app-server",
            modelId: "codex-app-server/gpt-5.4",
          },
        },
      }] as any,
      trace: {
        spaceId: "space-1",
        turnId: "turn-1",
        total: 0,
        events: [],
        toolCalls: [],
        activities: [],
        artifactIds: [],
        executionRuns: [{
          executionId: "exec-1",
          stepIndex: 0,
          providerId: "claude",
          modelId: "claude/sonnet",
          status: "completed",
          transcriptTruncated: false,
        }],
      } as any,
    })).toEqual({
      providerId: "codex-app-server",
      modelId: "codex-app-server/gpt-5.4",
    });
  });

  test("falls back to trace execution metadata when completed-event metadata is missing", () => {
    expect(extractObservedRuntimeSelection({
      turnEvents: [{
        spaceId: "space-1",
        spaceUid: "space-1",
        turnId: "turn-1",
        eventType: "completed",
        data: {},
        typedPayload: {
          kind: "turn.completed",
        },
      }] as any,
      trace: {
        spaceId: "space-1",
        turnId: "turn-1",
        total: 0,
        events: [],
        toolCalls: [],
        activities: [],
        artifactIds: [],
        executionRuns: [{
          executionId: "exec-1",
          stepIndex: 0,
          providerId: "codex-app-server",
          modelId: "codex-app-server/gpt-5.4-mini",
          status: "completed",
          transcriptTruncated: false,
        }],
      } as any,
    })).toEqual({
      providerId: "codex-app-server",
      modelId: "codex-app-server/gpt-5.4-mini",
    });
  });

  test("treats observed provider/model mismatches as hard failures", () => {
    expect(validateObservedRuntimeSelection({
      requestedProviderId: "codex-app-server",
      requestedModelId: "codex-app-server/gpt-5.4",
      observedProviderId: "claude",
      observedModelId: "claude/sonnet",
      requireObservedRuntime: true,
    })).toEqual({
      ok: false,
      failureReason: "Observed runtime claude/sonnet did not match requested codex-app-server/gpt-5.4.",
    });
  });

  test("requires observed runtime metadata for codex app server assertions", () => {
    expect(validateObservedRuntimeSelection({
      requestedProviderId: "codex-app-server",
      requestedModelId: "codex-app-server/gpt-5.4",
      requireObservedRuntime: true,
    })).toEqual({
      ok: false,
      failureReason: "Turn completed without provider/model execution metadata.",
    });
  });
});
