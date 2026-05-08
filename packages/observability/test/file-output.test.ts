import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

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

  describe("size-based rotation", () => {
    const ENV_KEYS = ["SPACESKIT_LOG_MAX_SIZE_MB", "SPACESKIT_LOG_RETENTION_COUNT"] as const;
    const savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

    beforeEach(() => {
      for (const key of ENV_KEYS) {
        savedEnv[key] = process.env[key];
        delete process.env[key];
      }
    });

    afterEach(() => {
      for (const key of ENV_KEYS) {
        if (savedEnv[key] === undefined) delete process.env[key];
        else process.env[key] = savedEnv[key];
      }
    });

    it("rotates the primary file when size threshold is exceeded", async () => {
      const { Logger, createFileOutput } = await import("../src/logger.js");
      const dir = await mkdtemp(join(tmpdir(), "spaceskit-observability-rotate-"));
      const filePath = join(dir, "rotate.log");

      try {
        const output = createFileOutput({ filePath, tee: false, maxSizeBytes: 200 });
        const logger = new Logger({ minLevel: "debug", output });

        // Each entry serializes to ~80 bytes. Five entries puts us above 200B.
        for (let i = 0; i < 5; i += 1) {
          logger.info(`message-${i}`, { padding: "x".repeat(40) });
        }
        await output.flush();

        // Pre-rotation total bytes ≈ 5 * ~80 = ~400; force one more line so primary exists post-rotation.
        logger.info("after-rotation");
        await output.flush();

        const rotated = await readFile(`${filePath}.1`, "utf-8");
        expect(rotated.length).toBeGreaterThan(0);
        expect(rotated.trim().split("\n").length).toBeGreaterThanOrEqual(5);

        // Primary must exist and be smaller than the rotated archive (the measurable outcome).
        const primary = await readFile(filePath, "utf-8");
        const primarySize = (await stat(filePath)).size;
        const rotatedSize = (await stat(`${filePath}.1`)).size;
        expect(primarySize).toBeLessThan(rotatedSize);
        expect(primary).toContain("after-rotation");
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });

    it("retention prunes the oldest rotated files", async () => {
      const { Logger, createFileOutput } = await import("../src/logger.js");
      const dir = await mkdtemp(join(tmpdir(), "spaceskit-observability-retain-"));
      const filePath = join(dir, "retain.log");

      try {
        const output = createFileOutput({
          filePath,
          tee: false,
          maxSizeBytes: 100,
          retentionCount: 2,
        });
        const logger = new Logger({ minLevel: "debug", output });

        // Force ≥ 4 rotations: each iteration writes > 100 bytes then flushes.
        for (let cycle = 0; cycle < 4; cycle += 1) {
          logger.info(`cycle-${cycle}`, { padding: "x".repeat(140) });
          await output.flush();
        }
        // One last write so a primary exists at the end.
        logger.info("tail");
        await output.flush();

        const entries = await readdir(dir);
        const rotatedFiles = entries.filter((name) => /\.\d+$/.test(name)).sort();
        expect(rotatedFiles).toEqual(["retain.log.1", "retain.log.2"]);
        expect(entries).not.toContain("retain.log.3");
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });

    it("does not rotate when no rotation options or env vars are set", async () => {
      const { Logger, createFileOutput } = await import("../src/logger.js");
      const dir = await mkdtemp(join(tmpdir(), "spaceskit-observability-norotate-"));
      const filePath = join(dir, "norotate.log");

      try {
        const output = createFileOutput({ filePath, tee: false });
        const logger = new Logger({ minLevel: "debug", output });

        for (let i = 0; i < 50; i += 1) {
          logger.info(`line-${i}`, { padding: "y".repeat(200) });
        }
        await output.flush();

        const entries = await readdir(dir);
        expect(entries).toEqual(["norotate.log"]);

        const sizeAfter = (await stat(filePath)).size;
        expect(sizeAfter).toBeGreaterThan(50 * 200);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });

    it("env vars enable rotation when explicit options are not set", async () => {
      // 0.0001 MB ≈ 105 bytes — small enough to trigger on the first entry batch.
      process.env.SPACESKIT_LOG_MAX_SIZE_MB = "0.0001";
      process.env.SPACESKIT_LOG_RETENTION_COUNT = "3";

      const { Logger, createFileOutput } = await import("../src/logger.js");
      const dir = await mkdtemp(join(tmpdir(), "spaceskit-observability-env-"));
      const filePath = join(dir, "env.log");

      try {
        const output = createFileOutput({ filePath, tee: false });
        const logger = new Logger({ minLevel: "debug", output });

        for (let cycle = 0; cycle < 6; cycle += 1) {
          logger.info(`env-${cycle}`, { padding: "z".repeat(120) });
          await output.flush();
        }
        logger.info("env-tail");
        await output.flush();

        const entries = await readdir(dir);
        const rotatedFiles = entries.filter((name) => /\.\d+$/.test(name));
        expect(rotatedFiles.length).toBeGreaterThan(0);
        expect(rotatedFiles.length).toBeLessThanOrEqual(3);
        expect(entries).not.toContain("env.log.4");
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });

    it("logging stays non-blocking even when rotation is enabled", async () => {
      const { Logger, createFileOutput } = await import("../src/logger.js");
      const dir = await mkdtemp(join(tmpdir(), "spaceskit-observability-async-rotate-"));
      const filePath = join(dir, "async-rotate.log");

      try {
        const output = createFileOutput({ filePath, tee: false, maxSizeBytes: 100 });
        const logger = new Logger({ minLevel: "debug", output });

        logger.info("first", { padding: "p".repeat(120) });

        // Rotation must not be performed synchronously in the caller stack.
        const immediate = await readFile(filePath, "utf-8").catch(() => "");
        expect(immediate).toBe("");

        await output.flush();

        // After the awaited flush, content has landed (either in primary or in .1).
        const primary = await readFile(filePath, "utf-8").catch(() => "");
        const rotated = await readFile(`${filePath}.1`, "utf-8").catch(() => "");
        const combined = primary + rotated;
        expect(combined).toContain("first");
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });
  });
});
