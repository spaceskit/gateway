import { describe, expect, test } from "bun:test";
import { normalizeMcpToolPayload } from "../src/services/space-mcp-service.js";

describe("normalizeMcpToolPayload", () => {
  test("prefers structuredContent when present", () => {
    const result = normalizeMcpToolPayload({
      content: [{ type: "text", text: "{\"ignored\":true}" }],
      structuredContent: {
        outputText: "hello",
      },
    });

    expect(result).toEqual({
      outputText: "hello",
    });
  });

  test("falls back to parsing JSON text content", () => {
    const result = normalizeMcpToolPayload({
      content: [{ type: "text", text: "{\"agents\":[{\"remoteAgentId\":\"remote-1\"}]}" }],
    });

    expect(result).toEqual({
      agents: [{ remoteAgentId: "remote-1" }],
    });
  });

  test("returns original payload when no structured data exists", () => {
    const raw = {
      content: [{ type: "text", text: "plain text" }],
    };

    expect(normalizeMcpToolPayload(raw)).toEqual({
      text: "plain text",
    });
  });
});
