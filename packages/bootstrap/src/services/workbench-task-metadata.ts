import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { Logger } from "@spaceskit/observability";
import type {
  WorkbenchQueueItemPayload,
  WorkbenchVerificationModePayload,
} from "@spaceskit/server";
import {
  validateGoalContractMarkdown,
  type GoalContractIssue,
} from "./planning-goal-contract.js";

export interface ParsedTaskMetadata {
  id: string;
  title: string;
  status: string;
  priority?: string;
  owner?: string;
  autonomous: boolean;
  dependsOn: string[];
  summary?: string;
  sourceFile?: string;
  claimedAt?: string;
  claimExpiresAt?: string;
  delegation: string;
  hasExplicitDelegationMetadata: boolean;
  parallelKeys: string[];
  aiShippable: boolean;
  hasExplicitAiShippableMetadata: boolean;
  products: string[];
  verificationMode: WorkbenchVerificationModePayload;
  verificationCommands: string[];
  executionModeBlockers: string[];
  malformedVerificationBlock: boolean;
  verificationBlockerMessage?: string;
  goalContractErrors: GoalContractIssue[];
  goalContractWarnings: GoalContractIssue[];
}

export interface CentralTaskRecord {
  path: string;
  metadata: ParsedTaskMetadata;
  body: string;
  frontmatter: Map<string, string>;
}

export function centralTasksRoot(workProjectsRoot: string, projectSlug: string): string {
  return join(workProjectsRoot, projectSlug, "tasks");
}

export function loadCentralTasks(
  workProjectsRoot: string,
  projectSlug: string,
  now: Date,
  logger: Logger | null,
): CentralTaskRecord[] {
  const root = centralTasksRoot(workProjectsRoot, projectSlug);
  if (!existsSync(root)) {
    logger?.warn("Workbench central task directory not found", { tasksRoot: root });
    return [];
  }
  return readdirSync(root)
    .filter((entry) => /^T-\d+\.md$/i.test(entry))
    .sort((left, right) => left.localeCompare(right))
    .map((entry) => join(root, entry))
    .map((taskPath) => parseCentralTaskFile(taskPath, projectSlug, now));
}

export function extractNextAction(body: string): string | null {
  const match = body.match(/^Next action:\s*(.+)$/im);
  return match?.[1]?.trim() ?? null;
}

export function updateCentralTaskFile(taskFilePath: string, input: {
  status: "in-progress" | "review" | "blocked";
  updated: string;
  owner?: string;
  claimedAt?: string;
  claimExpiresAt?: string;
  logMessage: string;
  nowIso: string;
}): void {
  const content = readFileSync(taskFilePath, "utf8");
  const match = content.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) return;
  const body = content.slice(match[0].length);
  const lines = match[1]!.split("\n");
  const setLine = (key: string, value: string | undefined) => {
    if (value === undefined) return;
    const index = lines.findIndex((line) => line.startsWith(`${key}:`));
    const next = `${key}: ${value}`;
    if (index >= 0) lines[index] = next;
    else lines.push(next);
  };
  setLine("status", input.status);
  setLine("updated", input.updated);
  setLine("owner", input.owner);
  setLine("claimed-at", input.claimedAt);
  setLine("claim-expires-at", input.claimExpiresAt);
  const logEntry = `- ${input.nowIso} - ${input.logMessage}`;
  const nextBody = body.includes("\n## Log\n")
    ? body.replace(/\n## Log\n/, `\n## Log\n\n${logEntry}\n`)
    : `${body.trimEnd()}\n\n## Log\n\n${logEntry}\n`;
  writeFileSync(taskFilePath, `---\n${lines.join("\n")}\n---\n\n${nextBody.replace(/^\n+/, "")}`);
}

export function tryParseTaskFile(taskFilePath: string): ParsedTaskMetadata | null {
  if (!existsSync(taskFilePath)) return null;
  try {
    return parseTaskFile(taskFilePath);
  } catch {
    return null;
  }
}

export function itemsConflict(left: WorkbenchQueueItemPayload, right: WorkbenchQueueItemPayload): boolean {
  if (left.queueItemId === right.queueItemId) return true;
  if (left.parallelKeys.includes("independent") || right.parallelKeys.includes("independent")) {
    return false;
  }
  const leftKeys = left.parallelKeys.length > 0 ? left.parallelKeys : left.products;
  const rightKeys = right.parallelKeys.length > 0 ? right.parallelKeys : right.products;
  return leftKeys.some((key) => rightKeys.includes(key));
}

export function resolvePlanningRepoRoot(startPath: string, logger: Logger | null): string {
  let current = startPath;
  while (true) {
    if (existsSync(join(current, ".git")) || existsSync(join(current, "gateway", "package.json"))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  logger?.warn("Workbench repo root has no planning queue; falling back to configured path", {
    repoRoot: startPath,
  });
  return startPath;
}

function parseCentralTaskFile(taskFilePath: string, projectSlug: string, now: Date): CentralTaskRecord {
  const content = readFileSync(taskFilePath, "utf8");
  const frontmatter = parseFrontmatter(content);
  const body = stripFrontmatter(content);
  const id = requiredFrontmatter(frontmatter, "id", `${projectSlug}/${basename(taskFilePath, ".md")}`);
  const title = stripQuotes(requiredFrontmatter(frontmatter, "title", extractTaskTitle(body) ?? basename(taskFilePath, ".md")));
  const status = normalizeCentralStatus(requiredFrontmatter(frontmatter, "status", "ready"));
  const autonomous = parseBoolean(frontmatter.get("autonomous"));
  const verification = extractMachineReadableVerification(body);
  const dependsOn = parseFrontmatterList(frontmatter.get("depends-on"));
  const legacyMetadata = collectMetadata(body);
  const products = splitMetadataList(legacyMetadata.get("products") ?? frontmatter.get("products") ?? frontmatter.get("tags") ?? projectSlug);
  const parallelKeys = splitMetadataList(legacyMetadata.get("parallel") ?? frontmatter.get("parallel") ?? frontmatter.get("tags") ?? products.join(","));
  const delegation = autonomous ? "autonomous" : "supervised";
  const hasActiveClaim = hasUnexpiredClaim(frontmatter.get("claim-expires-at"), now);
  const unmetDependencies = dependsOn.filter((dependency) => dependency.trim().length > 0);
  const executionModeBlockers = collectCentralExecutionModeBlockers({
    status,
    autonomous,
    verificationMode: verification.mode,
    verificationBlockerMessage: verification.blockerMessage,
    unmetDependencies,
    hasActiveClaim,
  });
  const goalContract = validateGoalContractMarkdown({
    markdown: body,
    expectedGoalId: sourceFileGoalId(frontmatter.get("source-file")) ?? (id.includes("/") ? id.split("/").pop()! : id),
    metadata: {
      owner: legacyMetadata.get("owner"),
      status: legacyMetadata.get("status"),
      delegation: legacyMetadata.get("delegation") ?? delegation,
      aiShippable: legacyMetadata.has("ai-shippable")
        ? normalizeMetadataBoolean(legacyMetadata.get("ai-shippable"))
        : autonomous,
      products,
    },
    verificationCommands: verification.commands,
  });
  return {
    path: taskFilePath,
    body,
    frontmatter,
    metadata: {
      id,
      title,
      status,
      priority: frontmatter.get("priority"),
      owner: frontmatter.get("owner"),
      autonomous,
      dependsOn,
      summary: stripQuotes(frontmatter.get("summary") ?? "") || undefined,
      sourceFile: frontmatter.get("source-file"),
      claimedAt: frontmatter.get("claimed-at"),
      claimExpiresAt: frontmatter.get("claim-expires-at"),
      delegation,
      hasExplicitDelegationMetadata: true,
      parallelKeys: parallelKeys.length > 0 ? parallelKeys : [projectSlug],
      aiShippable: autonomous,
      hasExplicitAiShippableMetadata: true,
      products: products.length > 0 ? products : [projectSlug],
      verificationMode: verification.mode,
      verificationCommands: verification.commands,
      executionModeBlockers,
      malformedVerificationBlock: verification.malformed,
      verificationBlockerMessage: verification.blockerMessage,
      goalContractErrors: goalContract.errors.filter((issue) => issue.code === "malformed_contract"),
      goalContractWarnings: goalContract.warnings,
    },
  };
}

function sourceFileGoalId(sourceFile: string | undefined): string | null {
  if (!sourceFile) return null;
  return basename(stripQuotes(sourceFile), ".md");
}

function normalizeMetadataBoolean(value: string | undefined): boolean {
  const normalized = (value ?? "").trim().toLowerCase();
  return normalized === "yes" || normalized === "true";
}

function parseFrontmatter(content: string): Map<string, string> {
  const result = new Map<string, string>();
  const match = content.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) return result;
  for (const line of match[1]!.split("\n")) {
    const keyValue = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!keyValue) continue;
    result.set(keyValue[1]!.trim(), keyValue[2]!.trim());
  }
  return result;
}

function stripFrontmatter(content: string): string {
  return content.replace(/^---\n[\s\S]*?\n---\n?/, "");
}

function requiredFrontmatter(frontmatter: Map<string, string>, key: string, fallback: string): string {
  return stripQuotes(frontmatter.get(key) ?? fallback).trim();
}

function stripQuotes(value: string): string {
  return value.replace(/^["']|["']$/g, "");
}

function parseBoolean(value: string | undefined): boolean {
  return (value ?? "").trim().toLowerCase() === "true";
}

function normalizeCentralStatus(value: string): string {
  return value.trim().toLowerCase();
}

function parseFrontmatterList(value: string | undefined): string[] {
  if (!value) return [];
  const trimmed = value.trim();
  if (trimmed === "[]") return [];
  return trimmed
    .replace(/^\[/, "")
    .replace(/\]$/, "")
    .split(",")
    .map((entry) => stripQuotes(entry.trim()))
    .filter(Boolean);
}

function hasUnexpiredClaim(claimExpiresAt: string | undefined, now: Date): boolean {
  if (!claimExpiresAt) return false;
  const expiresAt = Date.parse(stripQuotes(claimExpiresAt));
  return Number.isFinite(expiresAt) && expiresAt > now.getTime();
}

function collectCentralExecutionModeBlockers(input: {
  status: string;
  autonomous: boolean;
  verificationMode: WorkbenchVerificationModePayload;
  verificationBlockerMessage?: string;
  unmetDependencies: string[];
  hasActiveClaim: boolean;
}): string[] {
  const blockers: string[] = [];
  if (input.status !== "ready") {
    blockers.push(`Task status is ${input.status}, not ready.`);
  }
  if (!input.autonomous) {
    blockers.push("autonomous is not true.");
  }
  if (input.unmetDependencies.length > 0) {
    blockers.push(`Unmet dependencies: ${input.unmetDependencies.join(", ")}.`);
  }
  if (input.hasActiveClaim) {
    blockers.push("Task has an active unexpired claim.");
  }
  if (input.verificationMode !== "machine_readable") {
    blockers.push(input.verificationBlockerMessage ?? "No machine-readable verification declared.");
  }
  return blockers;
}

function parseTaskFile(taskFilePath: string): ParsedTaskMetadata {
  const content = readFileSync(taskFilePath, "utf8");
  const metadata = collectMetadata(content);
  const title = extractTaskTitle(content) ?? basename(taskFilePath, ".md");
  const products = splitMetadataList(metadata.get("products"));
  const parallelKeys = splitMetadataList(metadata.get("parallel"));
  const verification = extractMachineReadableVerification(content);
  const hasExplicitDelegationMetadata = metadata.has("delegation");
  const hasExplicitAiShippableMetadata = metadata.has("ai-shippable") || metadata.has("ai shippable");
  const delegation = (metadata.get("delegation") ?? "supervised").trim().toLowerCase();
  const aiShippable = (metadata.get("ai-shippable") ?? metadata.get("ai shippable") ?? "no").trim().toLowerCase() === "yes";
  const goalContract = validateGoalContractMarkdown({
    markdown: content,
    expectedGoalId: basename(taskFilePath, ".md"),
    metadata: {
      owner: metadata.get("owner"),
      status: metadata.get("status"),
      delegation,
      aiShippable,
      products,
    },
    verificationCommands: verification.commands,
  });
  const executionModeBlockers = collectExecutionModeBlockers({
    delegation,
    aiShippable,
    verificationMode: verification.mode,
    verificationBlockerMessage: verification.blockerMessage,
  }).concat(goalContract.errors.map((issue) => `Goal contract: ${issue.message}`));
  return {
    id: basename(taskFilePath),
    title,
    status: metadata.get("status") ?? "planned",
    autonomous: delegation === "autonomous",
    dependsOn: [],
    delegation,
    hasExplicitDelegationMetadata,
    parallelKeys: parallelKeys.length > 0 ? parallelKeys : products,
    aiShippable,
    hasExplicitAiShippableMetadata,
    products,
    verificationMode: verification.mode,
    verificationCommands: verification.commands,
    executionModeBlockers,
    malformedVerificationBlock: verification.malformed,
    verificationBlockerMessage: verification.blockerMessage,
    goalContractErrors: goalContract.errors,
    goalContractWarnings: goalContract.warnings,
  };
}

function collectMetadata(content: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const line of content.split("\n")) {
    const bullet = line.match(/^\s*-\s+([^:]+):\s*(.+)\s*$/);
    if (bullet) {
      result.set(normalizeMetadataKey(bullet[1]!), bullet[2]!.trim());
      continue;
    }
    const bold = line.match(/^\s*\*\*([^*]+)\*\*:\s*(.+)\s*$/);
    if (bold) {
      result.set(normalizeMetadataKey(bold[1]!), bold[2]!.trim());
    }
  }
  return result;
}

function normalizeMetadataKey(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, " ");
}

function extractTaskTitle(content: string): string | null {
  const match = content.match(/^#\s+(?:Task:\s+)?(.+)$/m);
  return match?.[1]?.trim() ?? null;
}

function extractMachineReadableVerification(content: string): {
  mode: WorkbenchVerificationModePayload;
  commands: string[];
  malformed: boolean;
  blockerMessage?: string;
} {
  const section = extractSection(content, "Verification Commands (Machine-Readable)");
  if (!section) {
    return {
      mode: "review_only",
      commands: [],
      malformed: false,
      blockerMessage: "No machine-readable verification declared.",
    };
  }
  const commands = section
    .split("\n")
    .map((line) => line.match(/^\s*\d+\.\s+`([^`]+)`/))
    .filter((match): match is RegExpMatchArray => Boolean(match))
    .map((match) => match[1]!);
  if (commands.length === 0) {
    return {
      mode: "review_only",
      commands: [],
      malformed: true,
      blockerMessage: "Machine-readable verification block is malformed.",
    };
  }
  return {
    mode: "machine_readable",
    commands,
    malformed: false,
  };
}

function extractSection(content: string, headingTitle: string): string | null {
  const lines = content.split("\n");
  const headingIndex = lines.findIndex((line) => line.startsWith("## ") && line.slice(3).trim() === headingTitle);
  if (headingIndex === -1) return null;
  const sectionLines: string[] = [];
  for (let index = headingIndex + 1; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (line.startsWith("## ")) break;
    sectionLines.push(line);
  }
  return sectionLines.join("\n").trim() || null;
}

function collectExecutionModeBlockers(input: {
  delegation: string;
  aiShippable: boolean;
  verificationMode: WorkbenchVerificationModePayload;
  verificationBlockerMessage?: string;
}): string[] {
  const blockers: string[] = [];
  if (!input.aiShippable) {
    blockers.push("AI-Shippable is not set to yes.");
  }
  if (input.delegation !== "autonomous") {
    blockers.push("Delegation is not autonomous.");
  }
  if (input.verificationMode !== "machine_readable") {
    blockers.push(input.verificationBlockerMessage ?? "No machine-readable verification declared.");
  }
  return blockers;
}

function splitMetadataList(raw: string | undefined): string[] {
  if (!raw) return [];
  return Array.from(
    new Set(
      raw
        .split(/[|,]/)
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean),
    ),
  );
}
