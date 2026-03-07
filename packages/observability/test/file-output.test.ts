import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("createFileOutput", () => {
  it("schedules file writes asynchronously so log calls stay non-blocking", async () => {
    const { Logger, createFileOutput } = await import("../src/logger.js");
    const dir = await mkdtemp(join(tmpdir(), "spaceskit-observability-"));
    const filePath = join(dir, "async.log");

    try {
      const output = createFileOutput({ filePath, tee: false });
      const logger = new Logger({ minLevel: "debug", output });

      logger.info("first");

      // Verify no synchronous persistence in the caller stack.
      const immediate = await readFile(filePath, "utf-8").catch(() => "");
      expect(immediate).toBe("");

      await output.flush();
      const persisted = await readFile(filePath, "utf-8");
      const persistedLines = persisted.trim().split("\n");
      expect(persistedLines).toHaveLength(1);
      expect(JSON.parse(persistedLines[0]!).msg).toBe("first");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("flush persists all buffered entries as valid JSONL", async () => {
    const { Logger, createFileOutput } = await import("../src/logger.js");

    const dir = await mkdtemp(join(tmpdir(), "spaceskit-observability-"));
    const filePath = join(dir, "gateway.log");

    try {
      const output = createFileOutput({ filePath, tee: false });
      const logger = new Logger({ minLevel: "debug", module: "test-module", output });

      logger.info("alpha", { requestId: "req-1" });
      logger.warn("beta", { traceId: "trace-2" });
      logger.error("gamma", new Error("boom"), { spaceId: "space-3" });

      await output.flush();

      const text = await readFile(filePath, "utf-8");
      const lines = text.trim().split("\n");
      const entries = lines.map((line) => JSON.parse(line) as Record<string, unknown>);

      expect(lines).toHaveLength(3);
      expect(entries.map((entry) => entry.msg)).toEqual(["alpha", "beta", "gamma"]);
      expect(entries.map((entry) => entry.level)).toEqual(["info", "warn", "error"]);
      expect(entries[2]?.error).toBe("boom");
      expect(entries.every((entry) => typeof entry.ts === "string")).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
