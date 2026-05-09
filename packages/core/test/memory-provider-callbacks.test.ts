/**
 * Tests for the optional `onSdkUnavailable` callback on LettaProvider and
 * Mem0Provider. Both providers lazy-import optional SDK packages
 * (`@letta-ai/letta-client`, `mem0ai`). When the package is missing the
 * provider should:
 *   1. Invoke the callback (if supplied) with the import error.
 *   2. Stay silent (no console.warn) when no callback is supplied.
 *   3. Set `available = false` either way.
 *
 * In this test environment both SDKs are absent (verified via
 * `bun -e 'import("@letta-ai/letta-client")...'`), so we can call
 * `initialize()` directly and observe the failure path with no mocking.
 */

import { describe, expect, test } from "bun:test";
import { LettaProvider } from "../src/memory/letta-provider.js";
import { Mem0Provider } from "../src/memory/mem0-provider.js";

describe("LettaProvider.initialize — onSdkUnavailable callback", () => {
  test("calls onSdkUnavailable with the import error when SDK is missing", async () => {
    const errors: unknown[] = [];
    const provider = new LettaProvider({
      onSdkUnavailable: (err) => {
        errors.push(err);
      },
    });

    await provider.initialize();

    expect(errors.length).toBe(1);
    expect(errors[0]).toBeDefined();
    expect(provider.available).toBe(false);
  });

  test("default (no callback supplied) is silent — no console.warn output", async () => {
    const provider = new LettaProvider({});
    const originalWarn = console.warn;
    const warnings: unknown[][] = [];
    console.warn = ((...args: unknown[]) => {
      warnings.push(args);
    }) as typeof console.warn;

    try {
      await provider.initialize();
    } finally {
      console.warn = originalWarn;
    }

    expect(warnings).toEqual([]);
    expect(provider.available).toBe(false);
  });
});

describe("Mem0Provider.initialize — onSdkUnavailable callback", () => {
  test("calls onSdkUnavailable with the import error when SDK is missing", async () => {
    const errors: unknown[] = [];
    const provider = new Mem0Provider({
      apiKey: "test-key",
      onSdkUnavailable: (err) => {
        errors.push(err);
      },
    });

    await provider.initialize();

    expect(errors.length).toBe(1);
    expect(errors[0]).toBeDefined();
    expect(provider.available).toBe(false);
  });

  test("default (no callback supplied) is silent — no console.warn output", async () => {
    const provider = new Mem0Provider({ apiKey: "test-key" });
    const originalWarn = console.warn;
    const warnings: unknown[][] = [];
    console.warn = ((...args: unknown[]) => {
      warnings.push(args);
    }) as typeof console.warn;

    try {
      await provider.initialize();
    } finally {
      console.warn = originalWarn;
    }

    expect(warnings).toEqual([]);
    expect(provider.available).toBe(false);
  });
});
