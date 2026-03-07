/**
 * Orchestrator summary protocol — deterministic summary generation.
 * Pure functions — no I/O, no logging.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SummaryDecision {
  text: string;
  proposedBy: string;     // agentId
  status: "proposed" | "accepted" | "rejected";
}

export interface OrchestratorSummaryPayload {
  summaryId: string;
  spaceId: string;
  turnIds: string[];          // contributing turn IDs
  synthesizedText: string;
  keyDecisions: SummaryDecision[];
  participatingAgents: string[];    // agentIds
  completedAt: string;
  version: number;                  // protocol version, start at 1
}

// ---------------------------------------------------------------------------
// Eligibility
// ---------------------------------------------------------------------------

export function isSummaryEligible(turnCount: number, agentCount: number): boolean {
  return agentCount >= 2 && turnCount >= 3;
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

export interface SummaryTurnInput {
  turnId: string;
  agentId: string;
  text: string;
}

export function assembleSummary(opts: {
  summaryId: string;
  spaceId: string;
  turns: SummaryTurnInput[];
  decisions?: SummaryDecision[];
  nowIso?: string;
}): OrchestratorSummaryPayload {
  const agents = [...new Set(opts.turns.map((t) => t.agentId))];
  const turnIds = opts.turns.map((t) => t.turnId);

  // Simple synthesis: concatenate agent contributions with attribution
  const lines = opts.turns.map((t) => `[${t.agentId}]: ${t.text}`);
  const synthesized = lines.join("\n\n");

  return {
    summaryId: opts.summaryId,
    spaceId: opts.spaceId,
    turnIds,
    synthesizedText: synthesized,
    keyDecisions: opts.decisions ?? [],
    participatingAgents: agents,
    completedAt: opts.nowIso ?? new Date().toISOString(),
    version: 1,
  };
}
