import type { ActiveSpace } from "./space-manager-agent-sessions.js";
import {
  resolveMasterModePromptTemplates as resolvePromptTemplates,
  type MasterModePromptTemplates,
} from "./master-mode-prompts.js";
import type {
  SpaceAgentAssignment,
  TurnModelConfig,
  TurnModelStrategy,
} from "./types.js";

export interface MasterModeTurnModelConfig {
  masterModeEnabled?: boolean;
  masterPlannerPromptTemplate?: string;
  guestAgentPromptTemplate?: string;
  peerReviewEnabled?: boolean;
  peerReviewTopology?: "ring";
  peerReviewPromptTemplate?: string;
  masterSynthesisPromptTemplate?: string;
}

export interface MasterFlowAssignments {
  master: SpaceAgentAssignment;
  guests: SpaceAgentAssignment[];
}

const MASTER_MODE_SUPPORTED_TURN_MODELS = new Set<TurnModelStrategy>([
  "sequential_all",
  "primary_only",
]);

export interface PlannerInstructions {
  globalInstruction: string;
  guestInstructions: Map<string, string>;
}

export interface PlannerJsonPayload {
  globalInstruction?: unknown;
  guestInstructions?: unknown;
}

export interface PlannerPhaseResult {
  instructions: PlannerInstructions;
  source: "slash" | "planner" | "fallback";
  rawOutput?: string;
  fallbackReason?: string;
}

export interface GuestReport {
  agentId: string;
  status: "completed" | "failed";
  report: string;
}

export interface PeerReviewAssignment {
  reviewerAgentId: string;
  targetAgentId: string;
  targetReport: string;
}

export interface PeerReviewResult {
  reviewerAgentId: string;
  targetAgentId: string;
  status: "completed" | "failed";
  verdict: "approve" | "needs_revision" | "conflict" | "error";
  issues: string[];
  confidence?: number;
  notes?: string;
  raw: string;
}

export function parsePlannerInstructions(
  rawPlannerOutput: string,
  guests: SpaceAgentAssignment[],
): PlannerInstructions | null {
  const parsed = parsePlannerJsonPayload(rawPlannerOutput);
  if (!parsed) return null;

  const globalInstruction = typeof parsed.globalInstruction === "string"
    ? parsed.globalInstruction.trim()
    : typeof (parsed as Record<string, unknown>).global_instruction === "string"
      ? ((parsed as Record<string, unknown>).global_instruction as string).trim()
      : "";
  if (!globalInstruction) return null;
  const rawGuestInstructions = parsed.guestInstructions
    ?? (parsed as Record<string, unknown>).guest_instructions;
  const guestInstructionRecord = (
    rawGuestInstructions && typeof rawGuestInstructions === "object"
      ? rawGuestInstructions as Record<string, unknown>
      : {}
  );
  const guestInstructions = new Map<string, string>();
  const orderedInstructionValues = Object.values(guestInstructionRecord)
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  let orderedValueIndex = 0;
  for (const guest of guests) {
    const raw = guestInstructionRecord[guest.agentId];
    let instruction = typeof raw === "string" ? raw.trim() : "";
    if (!instruction && guests.length === 1 && orderedInstructionValues.length > 0) {
      instruction = orderedInstructionValues[0] ?? "";
    } else if (!instruction && orderedInstructionValues.length === guests.length) {
      instruction = orderedInstructionValues[orderedValueIndex] ?? "";
      orderedValueIndex += 1;
    }
    if (!instruction) {
      instruction = globalInstruction;
    }
    guestInstructions.set(guest.agentId, instruction);
  }

  return { globalInstruction, guestInstructions };
}

export function parsePlannerJsonPayload(rawPlannerOutput: string): PlannerJsonPayload | null {
  const normalized = rawPlannerOutput.trim();
  if (!normalized) return null;

  const parseRecord = (candidate: string): PlannerJsonPayload | null => {
    try {
      const parsed = JSON.parse(candidate);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return null;
      }
      return parsed as PlannerJsonPayload;
    } catch {
      return null;
    }
  };

  const direct = parseRecord(normalized);
  if (direct) return direct;

  const fencedMatch = normalized.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fencedMatch?.[1]) {
    const fencedParsed = parseRecord(fencedMatch[1].trim());
    if (fencedParsed) return fencedParsed;
  }

  const firstBrace = normalized.indexOf("{");
  const lastBrace = normalized.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return parseRecord(normalized.slice(firstBrace, lastBrace + 1).trim());
  }

  return null;
}

export function buildFallbackPlannerInstructions(
  guests: SpaceAgentAssignment[],
  userInput?: string,
): PlannerInstructions {
  const guestInstructions = new Map<string, string>();
  for (const guest of guests) {
    guestInstructions.set(
      guest.agentId,
      buildFallbackGuestInstruction(guest.agentId, userInput),
    );
  }
  const normalizedUserInput = userInput?.trim();
  return {
    globalInstruction: normalizedUserInput && normalizedUserInput.length > 0
      ? `Coordinate guest execution to resolve the user request: "${normalizedUserInput}".`
      : "Coordinate guest execution and prepare for final synthesis.",
    guestInstructions,
  };
}

export function checkMasterModeConvergence(
  results: Array<{ verdict?: string; confidence?: number }>,
  threshold: number,
): boolean {
  if (results.length === 0) return true;
  const validResults = results.filter((result) => result.verdict);
  if (validResults.length === 0) return true;
  const allApproved = validResults.every((result) => result.verdict === "approve");
  if (!allApproved) return false;
  const avgConfidence = validResults.reduce(
    (sum, result) => sum + (result.confidence ?? 0),
    0,
  ) / validResults.length;
  return avgConfidence >= threshold;
}

export function buildRevisionFeedback(
  results: Array<{ verdict?: string; issues?: string[]; notes?: string }>,
): string {
  const feedbackParts: string[] = [];
  for (const result of results) {
    if (result.verdict === "approve") continue;
    if (result.issues?.length) {
      feedbackParts.push(`Issues: ${result.issues.join("; ")}`);
    }
    if (result.notes?.trim()) {
      feedbackParts.push(`Notes: ${result.notes.trim()}`);
    }
  }
  return feedbackParts.length > 0
    ? feedbackParts.join("\n")
    : "Peer review flagged issues but provided no specific feedback.";
}

export function buildFallbackGuestInstruction(guestAgentId: string, userInput?: string): string {
  const normalizedUserInput = userInput?.trim();
  if (normalizedUserInput && normalizedUserInput.length > 0) {
    return [
      `Guest ${guestAgentId}: execute the user's request directly ("${normalizedUserInput}").`,
      "Use available tools when they help gather concrete facts.",
      "Return concise actionable findings plus blockers for synthesis.",
    ].join(" ");
  }
  return [
    `Guest ${guestAgentId}: execute the user's request directly.`,
    "Use available tools when they help gather concrete facts.",
    "Return concise actionable findings plus blockers for synthesis.",
  ].join(" ");
}

export function parseSlashPlannerDirectives(
  userInput: string,
  guests: SpaceAgentAssignment[],
): PlannerInstructions | null {
  const lines = userInput.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0);
  const hasDirective = lines.some((line) => line.startsWith("/global") || line.startsWith("/guest"));
  if (!hasDirective) return null;

  let globalInstruction = "";
  const guestInstructions = new Map<string, string>();
  for (const line of lines) {
    if (line.startsWith("/global")) {
      const parsed = line.replace(/^\/global\s*:?\s*/i, "").trim();
      if (parsed.length > 0) {
        globalInstruction = parsed;
      }
      continue;
    }
    if (line.startsWith("/guest")) {
      const match = line.match(/^\/guest\s+([^\s:]+)\s*:?\s*(.+)$/i);
      if (!match) continue;
      const guestAgentId = match[1]?.trim();
      const instruction = match[2]?.trim();
      if (!guestAgentId || !instruction) continue;
      guestInstructions.set(guestAgentId, instruction);
    }
  }

  const normalizedGlobal = globalInstruction.length > 0
    ? globalInstruction
    : "Coordinate concise guest reports and prepare for final synthesis.";
  const normalizedGuestInstructions = new Map<string, string>();
  for (const guest of guests) {
    normalizedGuestInstructions.set(
      guest.agentId,
      guestInstructions.get(guest.agentId) ?? buildFallbackGuestInstruction(guest.agentId, userInput),
    );
  }

  return {
    globalInstruction: normalizedGlobal,
    guestInstructions: normalizedGuestInstructions,
  };
}

export function parsePeerReviewResult(
  reviewerAgentId: string,
  targetAgentId: string,
  rawOutput: string,
): PeerReviewResult | null {
  const parsed = parsePlannerJsonPayload(rawOutput);
  if (!parsed) return null;

  const verdictRaw = typeof (parsed as Record<string, unknown>).verdict === "string"
    ? ((parsed as Record<string, unknown>).verdict as string).trim().toLowerCase()
    : "";
  const verdict = verdictRaw === "approve" || verdictRaw === "needs_revision" || verdictRaw === "conflict"
    ? verdictRaw
    : null;
  if (!verdict) return null;

  const issuesRaw = (parsed as Record<string, unknown>).issues;
  const issues = Array.isArray(issuesRaw)
    ? issuesRaw.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : [];
  const notes = typeof (parsed as Record<string, unknown>).notes === "string"
    ? ((parsed as Record<string, unknown>).notes as string).trim()
    : undefined;
  const confidenceRaw = (parsed as Record<string, unknown>).confidence;
  const confidence = typeof confidenceRaw === "number" && Number.isFinite(confidenceRaw)
    ? Math.max(0, Math.min(1, confidenceRaw))
    : undefined;

  return {
    reviewerAgentId,
    targetAgentId,
    status: "completed",
    verdict,
    issues,
    confidence,
    notes: notes && notes.length > 0 ? notes : undefined,
    raw: rawOutput,
  };
}

export function buildRingPeerReviewAssignments(
  guests: SpaceAgentAssignment[],
  guestReports: GuestReport[],
): PeerReviewAssignment[] {
  if (guests.length < 2) return [];
  const reportByAgentId = new Map(guestReports.map((report) => [report.agentId, report]));
  const sortedGuests = sortSpaceAgentAssignments(guests);
  const assignments: PeerReviewAssignment[] = [];
  for (let idx = 0; idx < sortedGuests.length; idx += 1) {
    const reviewer = sortedGuests[idx]!;
    const target = sortedGuests[(idx + 1) % sortedGuests.length]!;
    const targetReport = reportByAgentId.get(target.agentId)?.report
      ?? "Target agent did not provide a report.";
    assignments.push({
      reviewerAgentId: reviewer.agentId,
      targetAgentId: target.agentId,
      targetReport,
    });
  }
  return assignments;
}

export function formatPeerReviewResults(results: PeerReviewResult[]): string {
  if (results.length === 0) return "(no peer-review results)";
  return results.map((result) => {
    const issues = result.issues.length > 0
      ? result.issues.join("; ")
      : "none";
    return [
      `- reviewer=${result.reviewerAgentId}`,
      `target=${result.targetAgentId}`,
      `status=${result.status}`,
      `verdict=${result.verdict}`,
      `issues=${issues}`,
    ].join(" ");
  }).join("\n");
}

export function formatGuestList(guests: SpaceAgentAssignment[]): string {
  if (guests.length === 0) return "(none)";
  return guests
    .map((guest) => `${guest.turnOrder}. ${guest.agentId}`)
    .join("\n");
}

export function formatGuestReports(guestReports: GuestReport[]): string {
  if (guestReports.length === 0) return "(no guest reports)";
  return guestReports
    .map((entry) => {
      const normalizedReport = entry.report.replace(/\s+/g, " ").trim();
      const clippedReport = normalizedReport.length > 500 ? `${normalizedReport.slice(0, 500)}...` : normalizedReport;
      return `- ${entry.agentId} [${entry.status}]: ${clippedReport || "(empty report)"}`;
    })
    .join("\n");
}

export function resolveMasterModePromptTemplates(
  space: ActiveSpace,
  overrides: {
    masterPlannerPromptTemplate?: string;
    guestAgentPromptTemplate?: string;
    peerReviewPromptTemplate?: string;
    masterSynthesisPromptTemplate?: string;
  },
): MasterModePromptTemplates {
  return resolvePromptTemplates(
    space.config.turnModelConfig as TurnModelConfig | undefined,
    overrides,
  );
}

export function resolvePeerReviewEnabled(space: ActiveSpace): boolean {
  const config = getMasterModeTurnModelConfig(space);
  if (config?.peerReviewEnabled === false) {
    return false;
  }
  return true;
}

export function resolvePeerReviewTopology(space: ActiveSpace): "ring" {
  const config = getMasterModeTurnModelConfig(space);
  if (config?.peerReviewTopology === "ring") {
    return "ring";
  }
  return "ring";
}

export function shouldUseMasterMode(
  space: ActiveSpace,
  masterModeEnabled: boolean | undefined,
): boolean {
  const config = getMasterModeTurnModelConfig(space);
  if ((masterModeEnabled ?? true) === false) {
    return false;
  }
  if (config?.masterModeEnabled === false) {
    return false;
  }
  if (!MASTER_MODE_SUPPORTED_TURN_MODELS.has(space.config.turnModel)) {
    return false;
  }

  const sortedAgents = sortSpaceAgentAssignments(space.config.agents);
  const coordinator = sortedAgents.find((assignment) => assignment.role === "global_coordinator");
  if (coordinator) {
    return sortedAgents.some((assignment) => assignment.agentId !== coordinator.agentId);
  }

  if (config?.masterModeEnabled !== true) {
    return false;
  }
  const primaries = sortedAgents.filter((assignment) => assignment.isPrimary);
  if (primaries.length !== 1) {
    return false;
  }
  return sortedAgents.some((assignment) => assignment.agentId !== primaries[0]!.agentId);
}

export function resolveMasterFlowAssignments(space: ActiveSpace): MasterFlowAssignments | null {
  const sortedAgents = sortSpaceAgentAssignments(space.config.agents);
  const coordinator = sortedAgents.find((assignment) => assignment.role === "global_coordinator");
  if (coordinator) {
    const guests = sortedAgents.filter((assignment) => assignment.agentId !== coordinator.agentId);
    if (guests.length === 0) return null;
    return { master: coordinator, guests };
  }

  const config = getMasterModeTurnModelConfig(space);
  if (config?.masterModeEnabled !== true) return null;
  const primaries = sortedAgents.filter((assignment) => assignment.isPrimary);
  if (primaries.length !== 1) return null;
  const master = primaries[0]!;
  const guests = sortedAgents.filter((assignment) => assignment.agentId !== master.agentId);
  if (guests.length === 0) return null;
  return { master, guests };
}

export function getMasterModeTurnModelConfig(space: ActiveSpace): MasterModeTurnModelConfig | undefined {
  const config = space.config.turnModelConfig;
  if (!config || typeof config !== "object") return undefined;
  return config as unknown as MasterModeTurnModelConfig;
}

export function sortSpaceAgentAssignments(assignments: SpaceAgentAssignment[]): SpaceAgentAssignment[] {
  return [...assignments].sort((lhs, rhs) => {
    if (lhs.turnOrder !== rhs.turnOrder) return lhs.turnOrder - rhs.turnOrder;
    return lhs.agentId.localeCompare(rhs.agentId);
  });
}
