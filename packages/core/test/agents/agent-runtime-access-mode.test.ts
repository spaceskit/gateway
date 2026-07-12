import { describe, expect, test } from "bun:test";
import {
  buildCliExecutorAccessModeGuidance,
  isNativeCliToolsMode,
} from "../../src/agents/agent-runtime-access-mode.js";

describe("agent runtime CLI access mode mapping", () => {
  test("treats Antigravity full-access turns as native CLI tools and default turns as mediated", () => {
    expect(isNativeCliToolsMode("antigravity", "full_access")).toBe(true);
    expect(isNativeCliToolsMode("antigravity", "default")).toBe(false);
  });

  test("treats OpenCode full-access turns as native CLI tools and default turns as mediated", () => {
    expect(isNativeCliToolsMode("opencode", "full_access")).toBe(true);
    expect(isNativeCliToolsMode("opencode", "default")).toBe(false);
  });

  test("describes Antigravity mediated default turns without implying native tools are available", () => {
    const guidance = buildCliExecutorAccessModeGuidance("antigravity", "default", { isMediated: true });

    expect(guidance).toContain("DEFAULT access mode");
    expect(guidance).toContain("fenced `tool_call` blocks");
    expect(guidance).toContain("Native Antigravity CLI tools are not available");
  });

  test("describes OpenCode mediated default turns without implying native tools are available", () => {
    const guidance = buildCliExecutorAccessModeGuidance("opencode", "default", { isMediated: true });

    expect(guidance).toContain("DEFAULT access mode");
    expect(guidance).toContain("fenced `tool_call` blocks");
    expect(guidance).toContain("Native OpenCode CLI tools are not available");
  });
});
