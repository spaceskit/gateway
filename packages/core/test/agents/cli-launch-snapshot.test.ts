import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { resolveCliLaunchSnapshot } from "../../src/agents/cli-launch-snapshot.js";

describe("resolveCliLaunchSnapshot", () => {
  const originalOpenAiKey = process.env.OPENAI_API_KEY;

  beforeEach(() => {
    delete process.env.OPENAI_API_KEY;
  });

  afterEach(() => {
    if (originalOpenAiKey === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = originalOpenAiKey;
    }
  });

  test("uses OpenAI preflight model metadata when available", async () => {
    const snapshot = await resolveCliLaunchSnapshot({
      agentId: "agent-1",
      providerId: "codex",
      modelId: "codex/gpt-5.2-codex",
      systemPrompt: "System prompt",
      messages: [{ role: "user", content: "Explain the repo" }],
      apiKey: "sk-test",
      fetchImpl: async () => new Response(JSON.stringify({
        data: [
          { id: "gpt-5.2-codex", context_length: 1_048_576 },
          { id: "gpt-5.1-codex", context_length: 1_048_576 },
        ],
      }), { status: 200, headers: { "content-type": "application/json" } }),
    });

    expect(snapshot).toMatchObject({
      agentId: "agent-1",
      providerId: "codex",
      modelId: "gpt-5.2-codex",
      contextWindowTokens: 1_048_576,
      source: "preflight",
    });
    expect(snapshot?.estimatedPromptTokens).toBeGreaterThan(0);
    expect(snapshot?.estimatedRemainingTokens).toBe(
      1_048_576 - (snapshot?.estimatedPromptTokens ?? 0),
    );
  });

  test("falls back to the registry when preflight data is unavailable", async () => {
    const snapshot = await resolveCliLaunchSnapshot({
      agentId: "agent-2",
      providerId: "codex",
      modelId: "codex/gpt-5.1-codex",
      systemPrompt: "System prompt",
      messages: [{ role: "user", content: "Explain the repo" }],
    });

    expect(snapshot).toMatchObject({
      agentId: "agent-2",
      providerId: "codex",
      modelId: "gpt-5.1-codex",
      contextWindowTokens: 1_048_576,
      source: "registry",
    });
  });
});
