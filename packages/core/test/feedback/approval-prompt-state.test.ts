import { describe, expect, test } from "bun:test";
import {
  INITIAL_APPROVAL_PROMPT_PHASE,
  createInitialApprovalPromptState,
  transitionApprovalPrompt,
  shouldFallbackToPhone,
  toWatchPrompt,
} from "../../src/feedback/approval-prompt-state.js";
import type {
  ApprovalPromptState,
  ApprovalPromptPhase,
} from "../../src/feedback/approval-prompt-state.js";

const NOW = "2026-02-28T12:00:00Z";

function makeState(overrides: Partial<ApprovalPromptState> = {}): ApprovalPromptState {
  return {
    correlationId: "corr-001",
    feedbackId: "fb-001",
    spaceId: "space-001",
    phase: "pending",
    timeoutSeconds: 30,
    ...overrides,
  };
}

describe("createInitialApprovalPromptState", () => {
  test("defaults to pending phase with 30s timeout", () => {
    const state = createInitialApprovalPromptState({
      correlationId: "corr-001",
      feedbackId: "fb-001",
      spaceId: "space-001",
    });
    expect(state.phase).toBe("pending");
    expect(state.timeoutSeconds).toBe(30);
    expect(state.correlationId).toBe("corr-001");
    expect(state.feedbackId).toBe("fb-001");
    expect(state.spaceId).toBe("space-001");
    expect(state.deliveredAt).toBeUndefined();
    expect(state.actedAt).toBeUndefined();
    expect(state.actionResult).toBeUndefined();
  });

  test("accepts custom timeoutSeconds", () => {
    const state = createInitialApprovalPromptState({
      correlationId: "corr-002",
      feedbackId: "fb-002",
      spaceId: "space-002",
      timeoutSeconds: 60,
    });
    expect(state.timeoutSeconds).toBe(60);
  });
});

describe("INITIAL_APPROVAL_PROMPT_PHASE", () => {
  test("is pending", () => {
    expect(INITIAL_APPROVAL_PROMPT_PHASE).toBe("pending");
  });
});

describe("transitionApprovalPrompt", () => {
  test("pending -> watch_delivered", () => {
    const state = makeState();
    const next = transitionApprovalPrompt(state, "watch_delivered", NOW);
    expect(next.phase).toBe("delivered_to_watch");
    expect(next.deliveredAt).toBe(NOW);
  });

  test("pending -> phone_delivered", () => {
    const state = makeState();
    const next = transitionApprovalPrompt(state, "phone_delivered", NOW);
    expect(next.phase).toBe("delivered_to_phone");
    expect(next.deliveredAt).toBe(NOW);
  });

  test("pending -> watch_delivery_failed -> fallback_to_phone", () => {
    const state = makeState();
    const next = transitionApprovalPrompt(state, "watch_delivery_failed", NOW);
    expect(next.phase).toBe("fallback_to_phone");
  });

  test("pending -> timed_out -> expired", () => {
    const state = makeState();
    const next = transitionApprovalPrompt(state, "timed_out", NOW);
    expect(next.phase).toBe("expired");
  });

  test("delivered_to_watch -> approved -> acted", () => {
    const state = makeState({ phase: "delivered_to_watch", deliveredAt: NOW });
    const actedAt = "2026-02-28T12:01:00Z";
    const next = transitionApprovalPrompt(state, "approved", actedAt);
    expect(next.phase).toBe("acted");
    expect(next.actedAt).toBe(actedAt);
    expect(next.actionResult).toBe("approved");
  });

  test("delivered_to_watch -> denied -> acted", () => {
    const state = makeState({ phase: "delivered_to_watch", deliveredAt: NOW });
    const next = transitionApprovalPrompt(state, "denied", NOW);
    expect(next.phase).toBe("acted");
    expect(next.actionResult).toBe("denied");
  });

  test("delivered_to_watch -> revised -> acted", () => {
    const state = makeState({ phase: "delivered_to_watch", deliveredAt: NOW });
    const next = transitionApprovalPrompt(state, "revised", NOW);
    expect(next.phase).toBe("acted");
    expect(next.actionResult).toBe("revised");
  });

  test("delivered_to_watch -> timed_out -> fallback_to_phone", () => {
    const state = makeState({ phase: "delivered_to_watch", deliveredAt: NOW });
    const next = transitionApprovalPrompt(state, "timed_out", NOW);
    expect(next.phase).toBe("fallback_to_phone");
  });

  test("fallback_to_phone -> phone_delivered", () => {
    const state = makeState({ phase: "fallback_to_phone" });
    const next = transitionApprovalPrompt(state, "phone_delivered", NOW);
    expect(next.phase).toBe("delivered_to_phone");
    expect(next.deliveredAt).toBe(NOW);
  });

  test("delivered_to_phone -> approved -> acted", () => {
    const state = makeState({ phase: "delivered_to_phone", deliveredAt: NOW });
    const actedAt = "2026-02-28T12:02:00Z";
    const next = transitionApprovalPrompt(state, "approved", actedAt);
    expect(next.phase).toBe("acted");
    expect(next.actedAt).toBe(actedAt);
    expect(next.actionResult).toBe("approved");
  });

  test("acted is terminal — no transitions", () => {
    const state = makeState({ phase: "acted", actedAt: NOW, actionResult: "approved" });
    const next = transitionApprovalPrompt(state, "approved", NOW);
    expect(next).toBe(state); // same reference
    expect(next.phase).toBe("acted");
  });

  test("expired is terminal — no transitions", () => {
    const state = makeState({ phase: "expired" });
    const next = transitionApprovalPrompt(state, "phone_delivered", NOW);
    expect(next).toBe(state); // same reference
    expect(next.phase).toBe("expired");
  });

  test("no-op for invalid event in pending", () => {
    const state = makeState({ phase: "pending" });
    const next = transitionApprovalPrompt(state, "approved", NOW);
    expect(next).toBe(state);
  });
});

describe("shouldFallbackToPhone", () => {
  test("returns true after timeout elapsed", () => {
    const deliveredAt = "2026-02-28T12:00:00Z";
    const deliveredMs = new Date(deliveredAt).getTime();
    const state = makeState({
      phase: "delivered_to_watch",
      deliveredAt,
      timeoutSeconds: 30,
    });
    // 31 seconds later
    const nowMs = deliveredMs + 31_000;
    expect(shouldFallbackToPhone(state, nowMs)).toBe(true);
  });

  test("returns false before timeout", () => {
    const deliveredAt = "2026-02-28T12:00:00Z";
    const deliveredMs = new Date(deliveredAt).getTime();
    const state = makeState({
      phase: "delivered_to_watch",
      deliveredAt,
      timeoutSeconds: 30,
    });
    // 10 seconds later
    const nowMs = deliveredMs + 10_000;
    expect(shouldFallbackToPhone(state, nowMs)).toBe(false);
  });

  test("returns true at exact timeout boundary", () => {
    const deliveredAt = "2026-02-28T12:00:00Z";
    const deliveredMs = new Date(deliveredAt).getTime();
    const state = makeState({
      phase: "delivered_to_watch",
      deliveredAt,
      timeoutSeconds: 30,
    });
    const nowMs = deliveredMs + 30_000;
    expect(shouldFallbackToPhone(state, nowMs)).toBe(true);
  });

  test("returns false for non-watch phase", () => {
    const state = makeState({ phase: "delivered_to_phone", deliveredAt: NOW });
    const nowMs = new Date(NOW).getTime() + 60_000;
    expect(shouldFallbackToPhone(state, nowMs)).toBe(false);
  });

  test("returns false if deliveredAt is undefined", () => {
    const state = makeState({ phase: "delivered_to_watch" });
    expect(shouldFallbackToPhone(state, Date.now())).toBe(false);
  });
});

describe("toWatchPrompt", () => {
  test("maps fields correctly with defaults", () => {
    const request = {
      feedbackId: "fb-001",
      category: "permission",
      prompt: "Allow file access?",
    };
    const prompt = toWatchPrompt(request, "corr-001");
    expect(prompt.correlationId).toBe("corr-001");
    expect(prompt.feedbackId).toBe("fb-001");
    expect(prompt.category).toBe("permission");
    expect(prompt.prompt).toBe("Allow file access?");
    expect(prompt.options).toEqual(["Approve", "Deny"]);
    expect(prompt.timeoutSeconds).toBe(30);
  });

  test("uses provided options and timeout", () => {
    const request = {
      feedbackId: "fb-002",
      category: "budget",
      prompt: "Approve spend?",
      options: ["Yes", "No", "Maybe"],
      timeoutSeconds: 60,
    };
    const prompt = toWatchPrompt(request, "corr-002");
    expect(prompt.options).toEqual(["Yes", "No", "Maybe"]);
    expect(prompt.timeoutSeconds).toBe(60);
  });
});
