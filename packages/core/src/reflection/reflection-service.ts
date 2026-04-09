import { randomUUID } from "node:crypto";
import type { ModelMessage, ModelProvider } from "../agents/model-provider.js";
import { synthesizeSummary, type SummaryParticipantData } from "../orchestrator/unified-summarizer.js";
import type { ConversationTopology, TurnModelStrategy } from "../spaces/types.js";
import type { AgentObservation, Experience } from "../experiences/types.js";

export type ReflectionFallbackMode = "model" | "heuristic";

export interface ReflectionGenerationTrace {
  jobType: "summary" | "experience" | "insight";
  kind?: SummaryJobKind;
  source: string;
  fallbackMode: ReflectionFallbackMode;
  modelId?: string;
  generatedAt: string;
}

export type SummaryJobKind = "orchestrator" | "experience" | "space_digest";

export interface ReflectionModelTarget {
  modelProvider?: ModelProvider;
  modelId?: string;
}

export interface ReflectionModelPolicy {
  summary?: ReflectionModelTarget;
  experience?: ReflectionModelTarget;
  insight?: ReflectionModelTarget;
}

export interface ReflectionServiceOptions {
  modelPolicy?: ReflectionModelPolicy;
}

export interface ExperienceTurnRecord {
  turnId: string;
  agentId: string;
  input: string;
  output: string;
  promptTokens: number;
  completionTokens: number;
  status: string;
}

export interface ExperienceSpaceConfig {
  spaceId: string;
  resourceId: string;
  name: string;
  goal?: string;
  turnModel: string;
  agents: Array<{ agentId: string; profileId?: string; isPrimary?: boolean }>;
}

export interface InsightProposalRecord {
  insightId: string;
  experienceId: string;
  spaceId: string;
  profileId: string;
  baseRevision: number;
  proposedPromptDelta: string;
  rationale: string;
  confidence: number;
  status: "proposed";
}

export type SummaryJobInput =
  | {
    kind: "orchestrator";
    conversationTopology: ConversationTopology;
    turnModel: TurnModelStrategy;
    userInput: string;
    participants: SummaryParticipantData[];
    peerReview: {
      enabled: boolean;
      status: "not_run" | "skipped" | "completed" | "degraded";
      completed: number;
      assignments: number;
      failed: number;
    };
    highlights: Array<{ agentId: string; text: string }>;
  }
  | {
    kind: "experience";
    name: string;
    goal?: string;
    turnModel: string;
    agents: Array<{ agentId: string }>;
    turns: ExperienceTurnRecord[];
  }
  | {
    kind: "space_digest";
    spaceId: string;
    spaceName: string;
    goal?: string;
    activeAgents: number;
    turns: Array<{
      agentId: string;
      status: string;
      output: string;
      createdAt: string;
    }>;
    pendingActions: string[];
  };

export interface SummaryJobResult {
  summaryText: string;
  fallbackMode: ReflectionFallbackMode;
  trace: ReflectionGenerationTrace;
}

export interface ExperienceJobInput extends ExperienceSpaceConfig {
  turns: ExperienceTurnRecord[];
  requestingPrincipalId?: string;
}

export interface ExperienceJobResult {
  experience: Experience;
  insightProposals: InsightProposalRecord[];
  summaryTrace: ReflectionGenerationTrace;
  insightTrace: ReflectionGenerationTrace;
}

export interface InsightProposalJobInput {
  experienceId: string;
  spaceId: string;
  observations: AgentObservation[];
}

export interface InsightProposalJobResult {
  insights: InsightProposalRecord[];
  trace: ReflectionGenerationTrace;
}

const MAX_TURNS_IN_DIGEST = 3;
const MAX_OUTPUT_PREVIEW = 140;

function truncate(text: string, max = MAX_OUTPUT_PREVIEW): string {
  const value = text.trim();
  if (value.length <= max) return value;
  return `${value.slice(0, max - 3)}...`;
}

function trace(
  jobType: ReflectionGenerationTrace["jobType"],
  kind: SummaryJobKind | undefined,
  source: string,
  fallbackMode: ReflectionFallbackMode,
  modelId?: string,
): ReflectionGenerationTrace {
  return {
    jobType,
    kind,
    source,
    fallbackMode,
    modelId,
    generatedAt: new Date().toISOString(),
  };
}

function heuristicExperienceSummary(input: Extract<SummaryJobInput, { kind: "experience" }>): string {
  const agentNames = input.agents.map((agent) => agent.agentId).join(", ");
  const totalTokens = input.turns.reduce((sum, turn) => sum + turn.promptTokens + turn.completionTokens, 0);
  const failedTurns = input.turns.filter((turn) => turn.status === "failed").length;
  let summary =
    `Space "${input.name}" executed ${input.turns.length} turns with agents [${agentNames}] using ${input.turnModel} strategy. Total tokens: ${totalTokens}.`;
  if (failedTurns > 0) {
    summary += ` ${failedTurns} turns failed.`;
  }
  return summary;
}

function heuristicOrchestratorSummary(input: Extract<SummaryJobInput, { kind: "orchestrator" }>): string {
  const failed = input.participants.filter((participant) => participant.status === "failed");
  const primary = input.participants.find((participant) => participant.isPrimary);
  const guestCount = Math.max(input.participants.length - (primary ? 1 : 0), 0);
  const summaryParts = [
    `Master coordinated ${guestCount} ${guestCount === 1 ? "guest" : "guests"}`,
    failed.length > 0 || input.peerReview.failed > 0 ? "degraded" : "completed",
    "Full log available",
  ];
  if (failed.length > 0) {
    summaryParts.push(`failed: ${failed.map((participant) => participant.agentId).join(", ")}`);
  }
  if (input.peerReview.status !== "not_run" && input.peerReview.status !== "skipped") {
    summaryParts.push(`peer-review: ${input.peerReview.completed}/${input.peerReview.assignments} completed`);
  }
  return summaryParts.join(" · ");
}

function heuristicSpaceDigest(input: Extract<SummaryJobInput, { kind: "space_digest" }>): string {
  const highlights = input.turns
    .slice(0, MAX_TURNS_IN_DIGEST)
    .map((turn) => `${turn.agentId}: ${truncate(turn.output)}`);
  const parts = [
    `${input.spaceName} has ${input.activeAgents} active ${input.activeAgents === 1 ? "agent" : "agents"}.`,
  ];
  if (highlights.length > 0) {
    parts.push(`Recent activity: ${highlights.join(" ")}`);
  }
  if (input.pendingActions.length > 0) {
    parts.push(`Pending actions: ${input.pendingActions.join(", ")}.`);
  }
  return parts.join(" ");
}

async function generateExperienceSummary(
  provider: ModelProvider,
  modelId: string,
  input: Extract<SummaryJobInput, { kind: "experience" }>,
): Promise<string> {
  const conversationText = input.turns
    .map((turn) => `[${turn.agentId}]: ${truncate(turn.output, 200)}`)
    .join("\n");
  const messages: ModelMessage[] = [
    {
      role: "system",
      content: "You summarize multi-agent space executions in 2-3 concise sentences. Focus on what was accomplished and how agents collaborated.",
    },
    {
      role: "user",
      content: `Summarize this space execution.\nGoal: ${input.goal ?? input.name}\nTurn model: ${input.turnModel}\nAgents: ${input.agents.map((agent) => agent.agentId).join(", ")}\n\nConversation:\n${conversationText}`,
    },
  ];
  const result = await provider.generate(modelId, {
    messages,
    maxTokens: 200,
    temperature: 0.3,
  });
  return result.message.content.trim();
}

async function generateSpaceDigestSummary(
  provider: ModelProvider,
  modelId: string,
  input: Extract<SummaryJobInput, { kind: "space_digest" }>,
): Promise<string> {
  const lines = input.turns
    .slice(0, MAX_TURNS_IN_DIGEST)
    .map((turn) => `[${turn.agentId}] (${turn.status}) ${truncate(turn.output, 180)}`);
  const messages: ModelMessage[] = [
    {
      role: "system",
      content: "Write a brief cross-space digest for a concierge. Keep it factual, compact, and action-oriented.",
    },
    {
      role: "user",
      content: [
        `Space: ${input.spaceName}`,
        input.goal ? `Goal: ${input.goal}` : null,
        `Active agents: ${input.activeAgents}`,
        `Recent turns:\n${lines.join("\n")}`,
        `Pending actions: ${input.pendingActions.join(", ") || "none"}`,
      ].filter(Boolean).join("\n"),
    },
  ];
  const result = await provider.generate(modelId, {
    messages,
    maxTokens: 180,
    temperature: 0.2,
  });
  return result.message.content.trim();
}

function extractLessons(turns: ExperienceTurnRecord[], agentCount: number): { strengths: string[]; weaknesses: string[] } {
  const strengths: string[] = [];
  const weaknesses: string[] = [];
  const failedTurns = turns.filter((turn) => turn.status === "failed");
  const successTurns = turns.filter((turn) => turn.status !== "failed");

  if (successTurns.length > 0) strengths.push(`${successTurns.length}/${turns.length} turns completed successfully`);
  if (agentCount > 1) strengths.push(`Multi-agent collaboration (${agentCount} agents)`);
  if (failedTurns.length === 0) strengths.push("Zero failures");
  if (failedTurns.length > 0) weaknesses.push(`${failedTurns.length} turns failed`);

  const avgTokensPerTurn = turns.reduce((sum, turn) => sum + turn.promptTokens + turn.completionTokens, 0) / turns.length;
  if (avgTokensPerTurn > 5000) {
    weaknesses.push(`High token usage (avg ${Math.round(avgTokensPerTurn)} per turn)`);
  }

  return { strengths, weaknesses };
}

function generateObservations(
  config: ExperienceSpaceConfig,
  turns: ExperienceTurnRecord[],
): AgentObservation[] {
  const byAgent = new Map<string, ExperienceTurnRecord[]>();
  for (const turn of turns) {
    if (!byAgent.has(turn.agentId)) byAgent.set(turn.agentId, []);
    byAgent.get(turn.agentId)!.push(turn);
  }

  const observations: AgentObservation[] = [];
  for (const [agentId, agentTurns] of byAgent) {
    const failed = agentTurns.filter((turn) => turn.status === "failed").length;
    const succeeded = agentTurns.length - failed;
    const totalTokens = agentTurns.reduce((sum, turn) => sum + turn.promptTokens + turn.completionTokens, 0);
    const assignment = config.agents.find((agent) => agent.agentId === agentId);
    let observation = `Agent ${agentId} executed ${agentTurns.length} turns (${succeeded} succeeded, ${failed} failed). Used ${totalTokens} tokens.`;
    const relevance = failed === 0 ? 0.6 : 0.8;
    let suggestion: string | undefined;
    if (failed > 0) {
      const failRate = failed / agentTurns.length;
      if (failRate > 0.5) {
        suggestion = "Consider adjusting agent prompt or reducing complexity of delegated tasks";
        observation += " High failure rate suggests prompt or capability mismatch.";
      }
    }
    observations.push({
      agentId,
      profileId: assignment?.profileId ?? agentId,
      observation,
      profileDeltaSuggestion: suggestion,
      relevance,
    });
  }

  return observations;
}

function generateTags(config: ExperienceSpaceConfig, turns: ExperienceTurnRecord[]): string[] {
  const tags: string[] = [];
  tags.push(`strategy:${config.turnModel}`);
  tags.push(`agents:${config.agents.length}`);
  if (turns.length <= 5) tags.push("turns:few");
  else if (turns.length <= 20) tags.push("turns:moderate");
  else tags.push("turns:many");
  const failRate = turns.filter((turn) => turn.status === "failed").length / turns.length;
  if (failRate === 0) tags.push("outcome:success");
  else if (failRate < 0.3) tags.push("outcome:partial");
  else tags.push("outcome:failed");
  if (config.goal) {
    tags.push(...config.goal.toLowerCase().split(/\s+/).slice(0, 3).filter((word) => word.length > 3));
  }
  return tags;
}

export class ReflectionService {
  constructor(private readonly options: ReflectionServiceOptions = {}) {}

  async runSummaryJob(input: SummaryJobInput): Promise<SummaryJobResult> {
    const policy = input.kind === "experience"
      ? this.options.modelPolicy?.experience
      : this.options.modelPolicy?.summary;

    if (input.kind === "orchestrator" && policy?.modelProvider && policy.modelId) {
      try {
        const summaryText = await synthesizeSummary(input, {
          modelProvider: policy.modelProvider,
          modelId: policy.modelId,
        });
        return {
          summaryText,
          fallbackMode: "model",
          trace: trace("summary", input.kind, "reflection-service", "model", policy.modelId),
        };
      } catch {
        // Fall through to heuristic.
      }
    }

    if (input.kind === "experience" && policy?.modelProvider && policy.modelId) {
      try {
        const summaryText = await generateExperienceSummary(policy.modelProvider, policy.modelId, input);
        if (summaryText) {
          return {
            summaryText,
            fallbackMode: "model",
            trace: trace("summary", input.kind, "reflection-service", "model", policy.modelId),
          };
        }
      } catch {
        // Fall through to heuristic.
      }
    }

    if (input.kind === "space_digest" && policy?.modelProvider && policy.modelId) {
      try {
        const summaryText = await generateSpaceDigestSummary(policy.modelProvider, policy.modelId, input);
        if (summaryText) {
          return {
            summaryText,
            fallbackMode: "model",
            trace: trace("summary", input.kind, "reflection-service", "model", policy.modelId),
          };
        }
      } catch {
        // Fall through to heuristic.
      }
    }

    const summaryText = input.kind === "orchestrator"
      ? heuristicOrchestratorSummary(input)
      : input.kind === "experience"
        ? heuristicExperienceSummary(input)
        : heuristicSpaceDigest(input);

    return {
      summaryText,
      fallbackMode: "heuristic",
      trace: trace("summary", input.kind, "reflection-service", "heuristic"),
    };
  }

  async runInsightProposalJob(input: InsightProposalJobInput): Promise<InsightProposalJobResult> {
    const insights = input.observations
      .filter((observation) => observation.profileDeltaSuggestion)
      .map((observation) => ({
        insightId: randomUUID(),
        experienceId: input.experienceId,
        spaceId: input.spaceId,
        profileId: observation.profileId,
        baseRevision: 0,
        proposedPromptDelta: observation.profileDeltaSuggestion!,
        rationale: `From experience ${input.experienceId}: ${observation.observation}`,
        confidence: observation.relevance,
        status: "proposed" as const,
      }));

    return {
      insights,
      trace: trace("insight", undefined, "reflection-service", "heuristic"),
    };
  }

  async runExperienceJob(input: ExperienceJobInput): Promise<ExperienceJobResult> {
    const summary = await this.runSummaryJob({
      kind: "experience",
      name: input.name,
      goal: input.goal,
      turnModel: input.turnModel,
      agents: input.agents.map((agent) => ({ agentId: agent.agentId })),
      turns: input.turns,
    });
    const { strengths, weaknesses } = extractLessons(input.turns, input.agents.length);
    const observations = generateObservations(input, input.turns);
    const experienceId = randomUUID();
    const experience: Experience = {
      experienceId,
      spaceId: input.spaceId,
      resourceId: input.resourceId,
      status: input.requestingPrincipalId ? "accepted" : "draft",
      goal: input.goal ?? input.name,
      summary: summary.summaryText,
      strengths,
      weaknesses,
      agentObservations: observations,
      tags: generateTags(input, input.turns),
      sourcePath: `./experiences/${input.spaceId}_${Date.now()}.md`,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const insightResult = await this.runInsightProposalJob({
      experienceId,
      spaceId: input.spaceId,
      observations,
    });
    return {
      experience,
      insightProposals: insightResult.insights,
      summaryTrace: summary.trace,
      insightTrace: insightResult.trace,
    };
  }
}
