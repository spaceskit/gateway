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

  test("honors a stored onboarding default over the priority order when its provider is configured", () => {
    withEnv({
      SPACESKIT_MODEL_PROVIDER: undefined,
      SPACESKIT_MODEL: undefined,
    }, () => {
      const selection = resolveMainProfileRuntimeSelection(
        loadConfig(),
        [
          { providerId: "claude", model: "claude/sonnet" },
          { providerId: "codex-app-server", model: "codex-app-server/gpt-5.4" },
        ],
        { providerHint: "claude", modelId: "claude/claude-opus-4-8" },
      );

      expect(selection).toEqual({
        providerHint: "claude",
        modelId: "claude/claude-opus-4-8",
      });
    });
  });

  test("ignores a stored onboarding default when its provider is no longer configured", () => {
    withEnv({
      SPACESKIT_MODEL_PROVIDER: undefined,
      SPACESKIT_MODEL: undefined,
    }, () => {
      const selection = resolveMainProfileRuntimeSelection(
        loadConfig(),
        [{ providerId: "codex-app-server", model: "codex-app-server/gpt-5.4" }],
        { providerHint: "claude", modelId: "claude/claude-opus-4-8" },
      );

      expect(selection).toEqual({
        providerHint: "codex-app-server",
        modelId: "codex-app-server/gpt-5.4",
      });
    });
  });

  test("falls back to the priority order when the stored default is empty", () => {
    withEnv({
      SPACESKIT_MODEL_PROVIDER: undefined,
      SPACESKIT_MODEL: undefined,
    }, () => {
      const selection = resolveMainProfileRuntimeSelection(
        loadConfig(),
        [{ providerId: "codex-app-server", model: "codex-app-server/gpt-5.4" }],
        { providerHint: "", modelId: "" },
      );

      expect(selection).toEqual({
        providerHint: "codex-app-server",
        modelId: "codex-app-server/gpt-5.4",
      });
    });
  });
});
