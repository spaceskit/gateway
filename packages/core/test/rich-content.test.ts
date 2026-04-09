import { describe, expect, test } from "vitest";
import {
  buildRichContentRecordFromText,
  deriveEnvelopeText,
  normalizeRichContent,
} from "../src/rich-content.js";

describe("rich-content", () => {
  test("normalizes plain text strings", () => {
    const envelope = normalizeRichContent({
      content: "hello world",
    });

    expect(envelope.primaryMimeType).toBe("text/plain");
    expect(envelope.supportsInline).toBe(true);
    expect(envelope.parts[0]?.type).toBe("text");
    expect(envelope.parts[0]?.text).toBe("hello world");
  });

  test("infers markdown for basic artifacts", () => {
    const envelope = normalizeRichContent({
      content: {
        kind: "space.basic_md",
        markdown: "# basic.md\nhello",
      },
      title: "basic.md",
      artifactType: "space.basic_md",
    });

    expect(envelope.primaryMimeType).toBe("text/markdown");
    expect(envelope.parts[0]?.text).toContain("# basic.md");
  });

  test("pretty prints json objects", () => {
    const envelope = normalizeRichContent({
      content: { ok: true, count: 2 },
    });

    expect(envelope.primaryMimeType).toBe("application/json");
    expect(envelope.parts[0]?.type).toBe("data");
    expect(envelope.parts[0]?.data).toContain("\"ok\": true");
  });

  test("escapes html instead of rendering it", () => {
    const envelope = normalizeRichContent({
      content: "<script>alert('x')</script>",
      mimeType: "text/html",
    });

    expect(envelope.primaryMimeType).toBe("text/plain");
    expect(envelope.parts[0]?.text).toContain("&lt;script&gt;");
    expect(envelope.metadata?.htmlEscaped).toBe(true);
  });

  test("builds turn records with envelope metadata", () => {
    const record = buildRichContentRecordFromText("# Heading", { allowMarkdownInference: true });

    expect(record.text).toBe("# Heading");
    expect(record.mimeType).toBe("text/markdown");
    expect(deriveEnvelopeText(record.contentEnvelope as never)).toContain("# Heading");
  });
});
