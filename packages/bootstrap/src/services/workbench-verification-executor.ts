import { spawn } from "node:child_process";

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_MAX_LOG_BYTES = 512 * 1024;

export interface WorkbenchCommandEvidence {
  command: string;
  status: "passed" | "failed";
  exitCode: number | null;
  durationMs: number;
  startedAt: string;
  completedAt: string;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  summary: string;
}

export interface RunWorkbenchCommandOptions {
  command: string;
  cwd: string;
  timeoutMs?: number;
  maxLogBytes?: number;
  now?: () => Date;
}

export async function runWorkbenchCommand(
  options: RunWorkbenchCommandOptions,
): Promise<WorkbenchCommandEvidence> {
  const now = options.now ?? (() => new Date());
  const startedAtDate = now();
  const startedAt = startedAtDate.toISOString();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxLogBytes = options.maxLogBytes ?? DEFAULT_MAX_LOG_BYTES;

  return await new Promise((resolve) => {
    const child = spawn(options.command, {
      cwd: options.cwd,
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let finished = false;
    const startedMs = startedAtDate.getTime();
    let killTimer: ReturnType<typeof setTimeout> | null = null;

    const finish = (exitCode: number | null, summary: string) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (killTimer) {
        clearTimeout(killTimer);
      }
      const completedAtDate = now();
      resolve({
        command: options.command,
        status: exitCode === 0 && !timedOut ? "passed" : "failed",
        exitCode: timedOut ? null : exitCode,
        durationMs: Math.max(0, completedAtDate.getTime() - startedMs),
        startedAt,
        completedAt: completedAtDate.toISOString(),
        stdout,
        stderr,
        timedOut,
        summary,
      });
    };

    const appendBounded = (current: string, chunk: Buffer): string => {
      const next = current + chunk.toString("utf8");
      return next.length > maxLogBytes ? next.slice(next.length - maxLogBytes) : next;
    };

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      killTimer = setTimeout(() => {
        if (!finished) {
          child.kill("SIGKILL");
        }
      }, 2_000);
    }, timeoutMs);

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout = appendBounded(stdout, chunk);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = appendBounded(stderr, chunk);
    });
    child.on("close", (code) => {
      finish(
        code,
        timedOut
          ? `Command timed out after ${timeoutMs}ms.`
          : `Command exited with code ${code ?? "unknown"}.`,
      );
    });
    child.on("error", (error) => {
      finish(null, error.message);
    });
  });
}
