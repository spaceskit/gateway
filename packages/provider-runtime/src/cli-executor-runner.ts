import { spawn, spawnSync, type ChildProcessWithoutNullStreams, type SpawnSyncReturns } from "node:child_process";
import type { CommandSpec } from "./cli-executor-command-types.js";

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export type CommandRunner = (spec: CommandSpec, signal?: AbortSignal) => Promise<CommandResult>;
export type CommandRunnerSync = (command: string, args: string[]) => SpawnSyncReturns<string>;
export type CommandStreamEvent =
  | { type: "stdout"; chunk: string }
  | { type: "stderr"; chunk: string }
  | { type: "exit"; exitCode: number };
export type CommandStreamRunner = (spec: CommandSpec, signal?: AbortSignal) => AsyncIterable<CommandStreamEvent>;

export async function defaultRunCommand(spec: CommandSpec, signal?: AbortSignal): Promise<CommandResult> {
  return await new Promise<CommandResult>((resolve, reject) => {
    const proc: ChildProcessWithoutNullStreams = spawn(spec.executable, spec.args, {
      stdio: "pipe",
      env: process.env,
      cwd: spec.cwd,
      signal,
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.setEncoding("utf8");
    proc.stderr.setEncoding("utf8");
    proc.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    proc.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    proc.stdin.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "EPIPE") {
        stderr += `\n${error.message}`;
        return;
      }
      reject(error);
    });
    proc.on("error", reject);
    proc.on("close", (code) => {
      resolve({
        exitCode: code ?? 1,
        stdout,
        stderr,
      });
    });

    if (spec.stdin) {
      proc.stdin.write(spec.stdin);
    }
    proc.stdin.end();
  });
}

export async function* defaultRunCommandStream(
  spec: CommandSpec,
  signal?: AbortSignal,
): AsyncIterable<CommandStreamEvent> {
  const queue = new AsyncStreamQueue<CommandStreamEvent>();
  const proc: ChildProcessWithoutNullStreams = spawn(spec.executable, spec.args, {
    stdio: "pipe",
    env: process.env,
    cwd: spec.cwd,
    signal,
  });

  proc.stdout.setEncoding("utf8");
  proc.stderr.setEncoding("utf8");
  proc.stdout.on("data", (chunk: string) => {
    queue.push({ type: "stdout", chunk });
  });
  proc.stderr.on("data", (chunk: string) => {
    queue.push({ type: "stderr", chunk });
  });
  proc.stdin.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EPIPE") {
      queue.push({ type: "stderr", chunk: `\n${error.message}` });
      return;
    }
    queue.fail(error);
  });
  proc.on("error", (error) => {
    queue.fail(error);
  });
  proc.on("close", (code) => {
    queue.push({ type: "exit", exitCode: code ?? 1 });
    queue.close();
  });

  if (spec.stdin) {
    proc.stdin.write(spec.stdin);
  }
  proc.stdin.end();

  for await (const event of queue) {
    yield event;
  }
}

export function defaultRunCommandSync(command: string, args: string[]): SpawnSyncReturns<string> {
  return spawnSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 1_500,
  });
}

class AsyncStreamQueue<T> implements AsyncIterable<T> {
  private readonly values: T[] = [];
  private readonly resolvers: Array<(result: IteratorResult<T>) => void> = [];
  private closed = false;
  private error: Error | null = null;

  push(value: T): void {
    if (this.closed) return;
    const resolver = this.resolvers.shift();
    if (resolver) {
      resolver({ value, done: false });
      return;
    }
    this.values.push(value);
  }

  fail(error: unknown): void {
    if (this.closed) return;
    this.error = error instanceof Error ? error : new Error(String(error));
    this.close();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    while (this.resolvers.length > 0) {
      const resolver = this.resolvers.shift()!;
      resolver({ value: undefined as T, done: true });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        if (this.values.length > 0) {
          return Promise.resolve({ value: this.values.shift()!, done: false });
        }
        if (this.error) {
          const error = this.error;
          this.error = null;
          return Promise.reject(error);
        }
        if (this.closed) {
          return Promise.resolve({ value: undefined as T, done: true });
        }
        return new Promise<IteratorResult<T>>((resolve) => {
          this.resolvers.push(resolve);
        });
      },
    };
  }
}
