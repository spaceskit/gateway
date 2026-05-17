import { spawn } from "node:child_process";
import type { Logger } from "@spaceskit/observability";
import { CliToolServiceError } from "./cli-tool-service-error.js";
import type { CliToolOutputMode } from "./cli-tool-service-types.js";

export async function executeCliTool(input: {
  executable: string;
  args: string[];
  cwd?: string;
  timeoutMs: number;
  maxOutputBytes: number;
  outputMode: CliToolOutputMode;
  logger: Logger;
  toolId: string;
}): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const child = spawn(input.executable, input.args, {
      cwd: input.cwd,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let outputOverflow = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 250).unref();
    }, input.timeoutMs);

    const onChunk = (chunk: string, target: "stdout" | "stderr") => {
      if (target === "stdout") {
        stdout += chunk;
      } else {
        stderr += chunk;
      }
      if (Buffer.byteLength(stdout, "utf8") + Buffer.byteLength(stderr, "utf8") > input.maxOutputBytes) {
        outputOverflow = true;
        child.kill("SIGTERM");
        setTimeout(() => child.kill("SIGKILL"), 250).unref();
      }
    };

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      onChunk(chunk, "stdout");
    });
    child.stderr?.on("data", (chunk: string) => {
      onChunk(chunk, "stderr");
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new CliToolServiceError(
          "FAILED_PRECONDITION",
          `CLI tool ${input.toolId} timed out after ${input.timeoutMs}ms.`,
        ));
        return;
      }
      if (outputOverflow) {
        reject(new CliToolServiceError(
          "FAILED_PRECONDITION",
          `CLI tool ${input.toolId} exceeded max output size (${input.maxOutputBytes} bytes).`,
        ));
        return;
      }
      if (code !== 0) {
        reject(new CliToolServiceError(
          "FAILED_PRECONDITION",
          stderr.trim() || `CLI tool ${input.toolId} exited with code ${code}.`,
        ));
        return;
      }
      const trimmed = stdout.trim();
      if (input.outputMode === "json") {
        try {
          resolve(trimmed ? JSON.parse(trimmed) : {});
          return;
        } catch (error) {
          input.logger.warn("Failed parsing CLI tool JSON output", {
            toolId: input.toolId,
            message: error instanceof Error ? error.message : String(error),
          });
          reject(new CliToolServiceError(
            "FAILED_PRECONDITION",
            `CLI tool ${input.toolId} returned invalid JSON output.`,
          ));
          return;
        }
      }
      resolve(trimmed);
    });
  });
}

export function renderArgs(template: string[], args: Record<string, unknown>): string[] {
  return template.map((entry) =>
    entry.replace(/\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g, (_match, key: string) => {
      const value = args[key];
      if (value === undefined || value === null) {
        return "";
      }
      if (typeof value === "string") {
        return value;
      }
      return JSON.stringify(value);
    }),
  );
}
