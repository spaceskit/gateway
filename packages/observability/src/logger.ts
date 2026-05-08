/**
 * Structured logger for the Spaceskit gateway.
 *
 * Outputs JSON lines to stdout/stderr. Each log entry includes:
 * - timestamp, level, message
 * - optional structured fields (space_id, agent_id, etc.)
 * - optional error with stack trace
 *
 * Designed to be piped into any log aggregator.
 */

import { existsSync, mkdirSync } from "node:fs";
import { appendFile, rename, stat, unlink } from "node:fs/promises";
import { dirname } from "node:path";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export interface LogEntry {
  ts: string;
  level: LogLevel;
  msg: string;
  module?: string;
  [key: string]: unknown;
}

export interface LoggerOptions {
  /** Minimum log level to output. Default: "info" */
  minLevel?: LogLevel;
  /** Module/component name included in every entry. */
  module?: string;
  /** Custom output function. Defaults to console.log / console.error. */
  output?: (entry: LogEntry) => void;
}

// ---------------------------------------------------------------------------
// File output
// ---------------------------------------------------------------------------

export interface FileLoggerOptions {
  /** Path to the log file (e.g. ~/.spaceskit/logs/gateway.log). */
  filePath: string;
  /** Also write to stdout/stderr. Default: true. */
  tee?: boolean;
  /**
   * Rotate the file when its size reaches this many bytes.
   * Falsy (0 / undefined) disables rotation. Defaults read from
   * SPACESKIT_LOG_MAX_SIZE_MB; explicit option wins.
   */
  maxSizeBytes?: number;
  /**
   * Number of rotated files to keep (.1 .. .N). Older are deleted
   * during rotation. Defaults to 5 when rotation is enabled. Reads
   * SPACESKIT_LOG_RETENTION_COUNT; explicit option wins.
   */
  retentionCount?: number;
}

interface ResolvedRotation {
  maxSizeBytes: number;
  retentionCount: number;
}

const DEFAULT_RETENTION_COUNT = 5;

function resolveRotationFromEnv(options: FileLoggerOptions): ResolvedRotation {
  const envMaxMb = process.env.SPACESKIT_LOG_MAX_SIZE_MB;
  const envRetention = process.env.SPACESKIT_LOG_RETENTION_COUNT;

  let maxSizeBytes = options.maxSizeBytes ?? 0;
  if (maxSizeBytes === 0 && envMaxMb !== undefined) {
    const parsed = Number.parseFloat(envMaxMb);
    if (Number.isFinite(parsed) && parsed > 0) {
      maxSizeBytes = Math.ceil(parsed * 1024 * 1024);
    }
  }

  let retentionCount = options.retentionCount ?? 0;
  if (retentionCount === 0 && envRetention !== undefined) {
    const parsed = Number.parseInt(envRetention, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      retentionCount = parsed;
    }
  }
  if (retentionCount === 0 && maxSizeBytes > 0) {
    retentionCount = DEFAULT_RETENTION_COUNT;
  }

  return { maxSizeBytes, retentionCount };
}

function isEnoent(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "ENOENT";
}

export interface BufferedFileOutput {
  (entry: LogEntry): void;
  flush(): Promise<void>;
  close(): Promise<void>;
}

/**
 * Create an output function that appends JSON log lines to a file.
 *
 * Usage:
 *   const logger = new Logger({
 *     output: createFileOutput({ filePath: "~/.spaceskit/logs/gateway.log" }),
 *   });
 */
export function createFileOutput(options: FileLoggerOptions): BufferedFileOutput {
  const { filePath, tee = true } = options;
  const rotation = resolveRotationFromEnv(options);

  // Ensure parent directory exists
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const pendingLines: string[] = [];
  let flushScheduled = false;
  let queuedCount = 0;
  let persistedCount = 0;
  let writeChain: Promise<void> = Promise.resolve();
  const waiters: Array<{ target: number; resolve: () => void }> = [];

  const resolveWaiters = (): void => {
    while (waiters.length > 0 && waiters[0]!.target <= persistedCount) {
      waiters.shift()!.resolve();
    }
  };

  const maybeRotate = async (): Promise<void> => {
    if (rotation.maxSizeBytes <= 0) return;

    let size: number;
    try {
      const s = await stat(filePath);
      size = s.size;
    } catch (err) {
      if (isEnoent(err)) return;
      throw err;
    }

    if (size < rotation.maxSizeBytes) return;

    // Cascade .N -> drop, .N-1 -> .N, ..., .1 -> .2, primary -> .1
    for (let i = rotation.retentionCount; i >= 1; i -= 1) {
      const src = `${filePath}.${i}`;
      try {
        if (i === rotation.retentionCount) {
          await unlink(src);
        } else {
          await rename(src, `${filePath}.${i + 1}`);
        }
      } catch (err) {
        if (!isEnoent(err)) {
          process.stderr.write(`[log-rotate-error] Could not rotate ${src}: ${String(err)}\n`);
        }
      }
    }
    try {
      await rename(filePath, `${filePath}.1`);
    } catch (err) {
      if (!isEnoent(err)) {
        process.stderr.write(`[log-rotate-error] Could not rotate ${filePath}: ${String(err)}\n`);
      }
    }
  };

  const flushNow = async (): Promise<void> => {
    flushScheduled = false;
    if (pendingLines.length === 0) {
      resolveWaiters();
      return;
    }

    const lineCount = pendingLines.length;
    const chunk = pendingLines.join("");
    pendingLines.length = 0;

    try {
      await appendFile(filePath, chunk, "utf-8");
      await maybeRotate();
    } catch {
      process.stderr.write(`[log-file-error] Could not write to ${filePath}\n`);
    } finally {
      persistedCount += lineCount;
      resolveWaiters();
    }

    if (pendingLines.length > 0) {
      scheduleFlush();
    }
  };

  const scheduleFlush = (): void => {
    if (flushScheduled) {
      return;
    }
    flushScheduled = true;
    queueMicrotask(() => {
      writeChain = writeChain.then(async () => {
        try {
          await flushNow();
        } catch {
          process.stderr.write(`[log-file-error] Unexpected flush failure for ${filePath}\n`);
        }
      });
    });
  };

  const output = ((entry: LogEntry) => {
    pendingLines.push(JSON.stringify(entry) + "\n");
    queuedCount += 1;
    scheduleFlush();

    if (tee) {
      defaultOutput(entry);
    }
  }) as BufferedFileOutput;

  output.flush = async (): Promise<void> => {
    const target = queuedCount;
    if (target <= persistedCount) {
      return;
    }

    scheduleFlush();
    await new Promise<void>((resolve) => {
      waiters.push({ target, resolve });
      resolveWaiters();
    });
    await writeChain;
  };

  output.close = async (): Promise<void> => {
    await output.flush();
  };

  return output;
}

/**
 * Create an output function that writes to multiple outputs.
 *
 * Usage:
 *   const logger = new Logger({
 *     output: combineOutputs(
 *       defaultOutput,
 *       createFileOutput({ filePath: "./gateway.log", tee: false }),
 *     ),
 *   });
 */
export function combineOutputs(
  ...outputs: Array<(entry: LogEntry) => void>
): (entry: LogEntry) => void {
  return (entry: LogEntry) => {
    for (const output of outputs) {
      output(entry);
    }
  };
}

export class Logger {
  private minLevel: number;
  private module: string | undefined;
  private output: (entry: LogEntry) => void;

  constructor(options: LoggerOptions = {}) {
    this.minLevel = LEVEL_ORDER[options.minLevel ?? "info"];
    this.module = options.module;
    this.output = options.output ?? defaultOutput;
  }

  /** Create a child logger with additional default fields. */
  child(fields: { module?: string; [key: string]: unknown }): Logger {
    const parent = this;
    const child = new Logger({
      minLevel: Object.entries(LEVEL_ORDER).find(([, v]) => v === this.minLevel)?.[0] as LogLevel,
      module: fields.module ?? this.module,
      output: (entry) => {
        parent.output({ ...fields, ...entry });
      },
    });
    return child;
  }

  debug(msg: string, fields?: Record<string, unknown>): void {
    this.log("debug", msg, fields);
  }

  info(msg: string, fields?: Record<string, unknown>): void {
    this.log("info", msg, fields);
  }

  warn(msg: string, fields?: Record<string, unknown>): void {
    this.log("warn", msg, fields);
  }

  error(msg: string, error?: unknown, fields?: Record<string, unknown>): void {
    const extra: Record<string, unknown> = { ...fields };
    if (error instanceof Error) {
      extra.error = error.message;
      extra.stack = error.stack;
    } else if (error !== undefined) {
      extra.error = String(error);
    }
    this.log("error", msg, extra);
  }

  private log(level: LogLevel, msg: string, fields?: Record<string, unknown>): void {
    if (LEVEL_ORDER[level] < this.minLevel) return;

    const entry: LogEntry = {
      ts: new Date().toISOString(),
      level,
      msg,
      ...(this.module ? { module: this.module } : {}),
      ...fields,
    };

    this.output(entry);
  }
}

function defaultOutput(entry: LogEntry): void {
  const line = JSON.stringify(entry);
  if (entry.level === "error" || entry.level === "warn") {
    process.stderr.write(line + "\n");
  } else {
    process.stdout.write(line + "\n");
  }
}
