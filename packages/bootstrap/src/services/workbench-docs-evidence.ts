import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { listGeneratedSpacesDocsKnowledgeEntries } from "../seed/runtime-docs-knowledge-base.js";
import type {
  RunWorkbenchCommandOptions,
  WorkbenchCommandEvidence,
} from "./workbench-verification-executor.js";

export type WorkbenchDocsPreflightStatus = "fresh" | "drifted" | "failed" | "not_available";

export interface WorkbenchDocsCheck {
  cwd: string;
  command: string;
  displayCommand: string;
}

export interface RunWorkbenchDocsPreflightOptions {
  worktreePath: string;
  timeoutMs: number;
  now: () => Date;
  verificationExecutor: (options: RunWorkbenchCommandOptions) => Promise<WorkbenchCommandEvidence>;
}

export interface WorkbenchDocsPreflightEvidence {
  status: WorkbenchDocsPreflightStatus;
  check: WorkbenchDocsCheck | null;
  evidence?: WorkbenchCommandEvidence;
}

export function resolveWorkbenchDocsCheck(worktreePath: string): WorkbenchDocsCheck | null {
  const gatewayPath = join(worktreePath, "gateway");
  const packageJsonPath = join(gatewayPath, "package.json");
  if (!existsSync(packageJsonPath)) {
    return null;
  }
  const packageJson = parseJson<{ scripts?: Record<string, unknown> }>(readFileSync(packageJsonPath, "utf8"));
  if (typeof packageJson?.scripts?.["docs:check"] !== "string") {
    return null;
  }
  return {
    cwd: gatewayPath,
    command: "bun run docs:check",
    displayCommand: "cd gateway && bun run docs:check",
  };
}

export async function runWorkbenchDocsPreflight(
  options: RunWorkbenchDocsPreflightOptions,
): Promise<WorkbenchDocsPreflightEvidence> {
  const check = resolveWorkbenchDocsCheck(options.worktreePath);
  if (!check) {
    return {
      status: "not_available",
      check: null,
    };
  }

  const evidence = await options.verificationExecutor({
    command: check.command,
    cwd: check.cwd,
    timeoutMs: options.timeoutMs,
    now: options.now,
  });
  return {
    status: docsPreflightStatus(evidence),
    check,
    evidence,
  };
}

export function buildGeneratedDocsKnowledgeArtifact(worktreePath: string): string {
  const entries = listGeneratedSpacesDocsKnowledgeEntries(worktreePath);
  return [
    "# Attached Generated Docs Knowledge",
    "",
    "Workbench attached these generated Spaces documentation knowledge entries for implementation context:",
    "",
    ...entries.flatMap((entry) => [
      `## ${entry.name}`,
      "",
      `- Entry ID: \`${entry.entryId}\``,
      `- URI: \`${entry.uri}\``,
      `- Tags: ${entry.tags.map((tag) => `\`${tag}\``).join(", ")}`,
      `- Description: ${entry.description}`,
      "",
    ]),
  ].join("\n");
}

function docsPreflightStatus(evidence: WorkbenchCommandEvidence): Exclude<WorkbenchDocsPreflightStatus, "not_available"> {
  if (evidence.status === "passed") {
    return "fresh";
  }
  if (evidence.timedOut || evidence.exitCode === null) {
    return "failed";
  }
  const combinedOutput = `${evidence.stdout}\n${evidence.stderr}`.toLowerCase();
  return evidence.exitCode === 1 || combinedOutput.includes("drift") ? "drifted" : "failed";
}

function parseJson<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}
