import { describe, expect, test } from "bun:test";
import { loadConfig } from "../src/config.js";
import { resolveMainProfileRuntimeSelection } from "../src/main-defaults.js";

function withEnv(
  overrides: Record<string, string | undefined>,
  run: () => void,
): void {
  const previous = new Map<string, string | undefined>();
  for (const key of Object.keys(overrides)) {
    previous.set(key, Bun.env[key]);
    const nextValue = overrides[key];
    if (nextValue === undefined) {
      delete Bun.env[key];
    } else {
      Bun.env[key] = nextValue;
    }
  }
  try {
    run();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) {
        delete Bun.env[key];
      } else {
        Bun.env[key] = value;
      }
    }
  }
}

describe("resolveMainProfileRuntimeSelection", () => {
  test("prefers codex app server over Claude executors when defaults are unset", () => {
    withEnv({
      SPACESKIT_MODEL_PROVIDER: undefined,
      SPACESKIT_MODEL: undefined,
    }, () => {
      const selection = resolveMainProfileRuntimeSelection(loadConfig(), [
        { providerId: "claude", model: "claude/sonnet" },
        { providerId: "claude-agent-sdk", model: "claude-agent-sdk/claude-sonnet-4-6" },
        { providerId: "codex", model: "codex/gpt-5.2-codex" },
        { providerId: "codex-app-server", model: "codex-app-server/gpt-5.4" },
      ]);

      expect(selection).toEqual({
        providerHint: "codex-app-server",
        modelId: "codex-app-server/gpt-5.4",
      });
    });
  });
});
