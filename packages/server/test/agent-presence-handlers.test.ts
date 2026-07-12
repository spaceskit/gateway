import { afterEach, describe, expect, test } from "bun:test";
import {
  AGENT_PRESENCE_ANSWER_FLAG,
  AGENT_PRESENCE_READ_FLAG,
  handleAgentAnswer,
  handleAgentPresenceList,
  handleAgentPresenceSubscribe,
  type AgentPresenceHandlerContext,
  type AgentPresenceSource,
} from "../src/handlers/agent-presence-handlers.js";
import { MessageTypes, type GatewayMessage } from "../src/protocol.js";
import type {
  AgentPresenceRowPayload,
  AgentPresenceSnapshotPayload,
} from "../src/protocol.js";

function makeClient(overrides: Record<string, unknown> = {}): any {
  return {
    id: "client-agent-presence-test",
    authenticated: true,
    clientType: "sdk",
    publicKey: "principal-owner",
    subscribedSpaces: new Set<string>(),
    connectedAt: new Date(),
    ...overrides,
  };
}

function makeMessage<T>(type: string, payload: T): GatewayMessage<T> {
  return { type, id: crypto.randomUUID(), ts: new Date().toISOString(), payload };
}

function makeRow(overrides: Partial<AgentPresenceRowPayload> = {}): AgentPresenceRowPayload {
  return {
    key: "claude:sess-1",
    provider: "claude",
    sessionId: "sess-1",
    cwd: "/tmp/project",
    status: "question",
    summary: "Pick a deploy target",
    options: [
      { label: "staging", description: "" },
      { label: "prod", description: "" },
    ],
    hash: "abc123",
    at: 1_700_000_000_000.5,
    live: true,
    ...overrides,
  };
}

function makeSnapshot(rows: AgentPresenceRowPayload[]): AgentPresenceSnapshotPayload {
  return { agents: rows, generatedAt: 1_700_000_000_001.25 };
}

interface CtxOverrides {
  flags?: Record<string, unknown>;
  source?: AgentPresenceSource | null;
  sent?: GatewayMessage[];
}

function makeContext(overrides: CtxOverrides = {}): AgentPresenceHandlerContext {
  const sent = overrides.sent ?? [];
  return {
    agentPresenceSource: overrides.source ?? null,
    getGatewayGlobalFlags: () => overrides.flags,
    sendToClient: (_clientId, msg) => {
      sent.push(msg);
    },
    response: (correlationId, type, payload) => ({
      type,
      id: crypto.randomUUID(),
      ts: new Date().toISOString(),
      replyTo: correlationId,
      payload,
    }),
    errorResponse: (correlationId, code, message) => ({
      type: MessageTypes.ERROR,
      id: crypto.randomUUID(),
      ts: new Date().toISOString(),
      replyTo: correlationId,
      payload: { code, message, retryable: false, correlationId },
    }),
  };
}

function makeSource(snapshot: AgentPresenceSnapshotPayload): {
  source: AgentPresenceSource;
  subscribed: string[];
  unsubscribed: string[];
} {
  const subscribed: string[] = [];
  const unsubscribed: string[] = [];
  return {
    subscribed,
    unsubscribed,
    source: {
      topic: "agent-presence",
      getSnapshot: async () => snapshot,
      subscribe: (clientId) => subscribed.push(clientId),
      unsubscribe: (clientId) => unsubscribed.push(clientId),
    },
  };
}

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

// Committed contract fixtures generated from the (private, infra-pulse-side)
// @agent-presence/contracts package — the answer tests assert against these so
// drift between infra-pulse's wire format and this handler fails here.
const fixturesDir = new URL("./fixtures/agent-presence/", import.meta.url);
const answerResponseFixtures = (await Bun.file(
  new URL("answer-responses.json", fixturesDir).pathname,
).json()) as Record<string, Record<string, unknown>>;
const answerRequestFixtures = (await Bun.file(
  new URL("answer-requests.json", fixturesDir).pathname,
).json()) as Record<string, Record<string, unknown>>;

function fixtureResponse(name: string, status = 200): Response {
  const body = answerResponseFixtures[name];
  if (!body) throw new Error(`unknown answer-response fixture: ${name}`);
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("handleAgentPresenceList", () => {
  test("rejects when the read flag is off (default)", async () => {
    const { source } = makeSource(makeSnapshot([makeRow()]));
    const ctx = makeContext({ source });
    const res = await handleAgentPresenceList(ctx, makeClient(), makeMessage(MessageTypes.AGENT_PRESENCE_LIST, {}));
    expect(res?.type).toBe(MessageTypes.ERROR);
    expect((res?.payload as any).code).toBe("FAILED_PRECONDITION");
  });

  test("returns the snapshot when enabled", async () => {
    const { source } = makeSource(makeSnapshot([makeRow()]));
    const ctx = makeContext({ source, flags: { [AGENT_PRESENCE_READ_FLAG]: true } });
    const res = await handleAgentPresenceList(ctx, makeClient(), makeMessage(MessageTypes.AGENT_PRESENCE_LIST, {}));
    expect(res?.type).toBe(MessageTypes.AGENT_PRESENCE_LIST);
    const payload = res?.payload as { agents: AgentPresenceRowPayload[]; generatedAt: number };
    expect(payload.agents).toHaveLength(1);
    expect(payload.agents[0]?.key).toBe("claude:sess-1");
    // `at` fraction preserved (double, not truncated).
    expect(payload.agents[0]?.at).toBe(1_700_000_000_000.5);
    expect(payload.generatedAt).toBe(1_700_000_000_001.25);
  });

  test("filters out non-waiting rows unless includeInactive", async () => {
    const rows = [makeRow(), makeRow({ key: "codex:idle", provider: "codex", status: "idle_dead" })];
    const { source } = makeSource(makeSnapshot(rows));
    const ctx = makeContext({ source, flags: { [AGENT_PRESENCE_READ_FLAG]: true } });
    const waiting = await handleAgentPresenceList(ctx, makeClient(), makeMessage(MessageTypes.AGENT_PRESENCE_LIST, {}));
    expect((waiting?.payload as any).agents).toHaveLength(1);
    const all = await handleAgentPresenceList(
      ctx,
      makeClient(),
      makeMessage(MessageTypes.AGENT_PRESENCE_LIST, { includeInactive: true }),
    );
    expect((all?.payload as any).agents).toHaveLength(2);
  });

  test("filters by provider", async () => {
    const rows = [makeRow(), makeRow({ key: "codex:s", provider: "codex", status: "turn_end" })];
    const { source } = makeSource(makeSnapshot(rows));
    const ctx = makeContext({ source, flags: { [AGENT_PRESENCE_READ_FLAG]: true } });
    const res = await handleAgentPresenceList(
      ctx,
      makeClient(),
      makeMessage(MessageTypes.AGENT_PRESENCE_LIST, { providers: ["codex"] }),
    );
    const agents = (res?.payload as any).agents as AgentPresenceRowPayload[];
    expect(agents).toHaveLength(1);
    expect(agents[0]?.provider).toBe("codex");
  });

  test("reports UNAVAILABLE when source missing", async () => {
    const ctx = makeContext({ source: null, flags: { [AGENT_PRESENCE_READ_FLAG]: true } });
    const res = await handleAgentPresenceList(ctx, makeClient(), makeMessage(MessageTypes.AGENT_PRESENCE_LIST, {}));
    expect((res?.payload as any).code).toBe("UNAVAILABLE");
  });
});

describe("handleAgentPresenceSubscribe", () => {
  test("registers the client and pushes the initial snapshot", async () => {
    const sent: GatewayMessage[] = [];
    const { source, subscribed } = makeSource(makeSnapshot([makeRow()]));
    const ctx = makeContext({ source, sent, flags: { [AGENT_PRESENCE_READ_FLAG]: true } });
    const client = makeClient();
    const res = await handleAgentPresenceSubscribe(
      ctx,
      client,
      makeMessage(MessageTypes.AGENT_PRESENCE_SUBSCRIBE, {}),
    );
    expect(res?.type).toBe(MessageTypes.AGENT_PRESENCE_SUBSCRIBE);
    expect((res?.payload as any).subscribed).toBe(true);
    expect(subscribed).toEqual([client.id]);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.type).toBe(MessageTypes.AGENT_PRESENCE_UPDATED);
    expect((sent[0]?.payload as any).agents).toHaveLength(1);
  });

  test("skips the initial snapshot when includeInitialSnapshot=false", async () => {
    const sent: GatewayMessage[] = [];
    const { source } = makeSource(makeSnapshot([makeRow()]));
    const ctx = makeContext({ source, sent, flags: { [AGENT_PRESENCE_READ_FLAG]: true } });
    await handleAgentPresenceSubscribe(
      ctx,
      makeClient(),
      makeMessage(MessageTypes.AGENT_PRESENCE_SUBSCRIBE, { includeInitialSnapshot: false }),
    );
    expect(sent).toHaveLength(0);
  });

  test("rejects when read flag is off", async () => {
    const { source } = makeSource(makeSnapshot([]));
    const ctx = makeContext({ source });
    const res = await handleAgentPresenceSubscribe(
      ctx,
      makeClient(),
      makeMessage(MessageTypes.AGENT_PRESENCE_SUBSCRIBE, {}),
    );
    expect((res?.payload as any).code).toBe("FAILED_PRECONDITION");
  });
});

describe("handleAgentAnswer", () => {
  test("rejects when answer flag is off (default), even if read flag is on", async () => {
    const ctx = makeContext({ flags: { [AGENT_PRESENCE_READ_FLAG]: true } });
    const res = await handleAgentAnswer(
      ctx,
      makeClient(),
      makeMessage(MessageTypes.AGENT_PRESENCE_ANSWER, { key: "claude:sess-1" }),
    );
    expect((res?.payload as any).code).toBe("FAILED_PRECONDITION");
  });

  test("requires a key", async () => {
    const ctx = makeContext({ flags: { [AGENT_PRESENCE_ANSWER_FLAG]: true } });
    const res = await handleAgentAnswer(
      ctx,
      makeClient(),
      makeMessage(MessageTypes.AGENT_PRESENCE_ANSWER, { key: "  " }),
    );
    expect((res?.payload as any).code).toBe("INVALID_ARGUMENT");
  });

  test("POSTs the camelCase contract body and round-trips mode=fork_resume honestly", async () => {
    let capturedUrl = "";
    let capturedBody: any = null;
    globalThis.fetch = (async (url: any, init: any) => {
      capturedUrl = String(url);
      capturedBody = JSON.parse(init.body as string);
      return fixtureResponse("forkResume");
    }) as typeof fetch;

    const ctx = makeContext({ flags: { [AGENT_PRESENCE_ANSWER_FLAG]: true } });
    const req = answerRequestFixtures.optionWithText as {
      key: string;
      optionIndex: number;
      text: string;
      expectedHash: string;
    };
    const res = await handleAgentAnswer(ctx, makeClient(), makeMessage(MessageTypes.AGENT_PRESENCE_ANSWER, req));
    expect(capturedUrl).toBe("http://localhost:9091/api/agent-presence/answer");
    // The outbound body IS the contract's AgentPresenceAnswerRequest (camelCase).
    expect(capturedBody).toEqual({
      key: req.key,
      optionIndex: req.optionIndex,
      text: req.text,
      expectedHash: req.expectedHash,
    });
    expect(res?.type).toBe(MessageTypes.AGENT_PRESENCE_ANSWER);
    const payload = res?.payload as any;
    expect(payload.ok).toBe(true);
    expect(payload.deliveredAnswer).toBe("Yes, update the docs too.");
    // The honest contract: fork answers MUST surface as fork_resume.
    expect(payload.deliveryMode).toBe("fork_resume");
    // The raw detector row (kebab-case status) is normalized onto the wire enum.
    expect(payload.agent.status).toBe("turn_end");
    expect(payload.error).toBeUndefined();
  });

  test("omits unset optionIndex instead of sending -1", async () => {
    let capturedBody: any = null;
    globalThis.fetch = (async (_url: any, init: any) => {
      capturedBody = JSON.parse(init.body as string);
      return fixtureResponse("inPlace");
    }) as typeof fetch;
    const ctx = makeContext({ flags: { [AGENT_PRESENCE_ANSWER_FLAG]: true } });
    await handleAgentAnswer(
      ctx,
      makeClient(),
      makeMessage(MessageTypes.AGENT_PRESENCE_ANSWER, { key: "opencode:s2", optionIndex: -1, text: "yes" }),
    );
    expect(capturedBody).toEqual({ key: "opencode:s2", text: "yes" });
  });

  test("round-trips mode=in_place", async () => {
    globalThis.fetch = (async () => fixtureResponse("inPlace")) as typeof fetch;
    const ctx = makeContext({ flags: { [AGENT_PRESENCE_ANSWER_FLAG]: true } });
    const res = await handleAgentAnswer(
      ctx,
      makeClient(),
      makeMessage(MessageTypes.AGENT_PRESENCE_ANSWER, { key: "opencode:s2", text: "yes" }),
    );
    expect((res?.payload as any).deliveryMode).toBe("in_place");
  });

  test("maps an unknown mode to unspecified", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ ok: true, mode: "teleport" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as typeof fetch;
    const ctx = makeContext({ flags: { [AGENT_PRESENCE_ANSWER_FLAG]: true } });
    const res = await handleAgentAnswer(
      ctx,
      makeClient(),
      makeMessage(MessageTypes.AGENT_PRESENCE_ANSWER, { key: "codex:s3" }),
    );
    expect((res?.payload as any).deliveryMode).toBe("unspecified");
  });

  test("round-trips a 409 stale-ask as ok:false with the FRESH agent row", async () => {
    globalThis.fetch = (async () => fixtureResponse("staleHash", 409)) as typeof fetch;
    const ctx = makeContext({ flags: { [AGENT_PRESENCE_ANSWER_FLAG]: true } });
    const res = await handleAgentAnswer(
      ctx,
      makeClient(),
      makeMessage(MessageTypes.AGENT_PRESENCE_ANSWER, { key: "claude:fixture-question", expectedHash: "old" }),
    );
    const payload = res?.payload as any;
    expect(res?.type).toBe(MessageTypes.AGENT_PRESENCE_ANSWER);
    expect(payload.ok).toBe(false);
    expect(payload.error.code).toBe("stale_ask");
    expect(payload.error.message).toContain("stale");
    expect(payload.agent.key).toBe("claude:fixture-question");
    expect(payload.deliveryMode).toBe("read_only");
  });

  test("round-trips a 503 answer-disabled response honestly", async () => {
    globalThis.fetch = (async () => fixtureResponse("readOnlyDisabled", 503)) as typeof fetch;
    const ctx = makeContext({ flags: { [AGENT_PRESENCE_ANSWER_FLAG]: true } });
    const res = await handleAgentAnswer(
      ctx,
      makeClient(),
      makeMessage(MessageTypes.AGENT_PRESENCE_ANSWER, { key: "codex:s4", text: "hi" }),
    );
    const payload = res?.payload as any;
    expect(payload.ok).toBe(false);
    expect(payload.error.code).toBe("answer_disabled");
    expect(payload.deliveryMode).toBe("read_only");
  });

  test("returns UNAVAILABLE when infra-pulse returns a non-JSON error body", async () => {
    globalThis.fetch = (async () => new Response("nope", { status: 502 })) as typeof fetch;
    const ctx = makeContext({ flags: { [AGENT_PRESENCE_ANSWER_FLAG]: true } });
    const res = await handleAgentAnswer(
      ctx,
      makeClient(),
      makeMessage(MessageTypes.AGENT_PRESENCE_ANSWER, { key: "codex:s4" }),
    );
    expect((res?.payload as any).code).toBe("UNAVAILABLE");
  });

  test("returns UNAVAILABLE when fetch throws (infra-pulse down)", async () => {
    globalThis.fetch = (async () => {
      throw new Error("ECONNREFUSED");
    }) as typeof fetch;
    const ctx = makeContext({ flags: { [AGENT_PRESENCE_ANSWER_FLAG]: true } });
    const res = await handleAgentAnswer(
      ctx,
      makeClient(),
      makeMessage(MessageTypes.AGENT_PRESENCE_ANSWER, { key: "codex:s5" }),
    );
    expect((res?.payload as any).code).toBe("UNAVAILABLE");
    expect((res?.payload as any).message).toContain("ECONNREFUSED");
  });
});
