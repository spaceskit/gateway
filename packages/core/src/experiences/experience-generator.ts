/**
 * ExperienceGenerator — converts completed spaces into structured experiences.
 *
 * Pipeline:
 * 1. Listen for "space.self_check" events via EventBus
 * 2. Load space config + turn history from database
 * 3. Summarize execution (LLM or heuristic)
 * 4. Extract agent observations
 * 5. Generate PersonalityInsight proposals
 * 6. Save to database + memory system
 * 7. Emit "experience.created" event
 */

import type { Experience, AgentObservation } from "./types.js";
import type { ModelProvider, ModelMessage } from "../agents/model-provider.js";
import type { EventBus } from "../events/event-bus.js";
import type { MemoryProvider } from "../memory/types.js";
import { randomUUID } from "node:crypto";
import { ReflectionService, type InsightProposalRecord } from "../reflection/reflection-service.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExperienceGeneratorOptions {
  eventBus: EventBus;
  /** Model provider for LLM-based summarization. If absent, uses heuristic. */
  modelProvider?: ModelProvider;
  /** Model ID to use for summarization. */
  modelId?: string;
  /** Memory provider to save experiences to. */
  memoryProvider?: MemoryProvider;
  /** Load turn history for a space. */
  loadHistory: (spaceId: string) => Promise<TurnRecord[]>;
  /** Load space config. */
  loadSpaceConfig: (spaceId: string) => Promise<SpaceConfigRecord | null>;
  /** Save experience to database. */
  saveExperience: (experience: Experience) => Promise<void>;
  /** Save personality insight to database (optional). */
  saveInsight?: (insight: InsightRecord) => Promise<void>;
  /** Shared reflection pipeline for summary + insight generation. */
  reflectionService?: ReflectionService;
}

export interface TurnRecord {
  turnId: string;
  agentId: string;
  input: string;
  output: string;
  promptTokens: number;
  completionTokens: number;
  status: string;
}

export interface SpaceConfigRecord {
  spaceId: string;
  resourceId: string;
  name: string;
  goal?: string;
  turnModel: string;
  agents: Array<{ agentId: string; profileId?: string; isPrimary?: boolean }>;
}

export interface InsightRecord {
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

// ---------------------------------------------------------------------------
// Generator
// ---------------------------------------------------------------------------

export class ExperienceGenerator {
  private options: ExperienceGeneratorOptions;
  private unsubscribe: (() => void) | null = null;
  private selfCheckUnsubscribe: (() => void) | null = null;
  private turnStartedUnsubscribe: (() => void) | null = null;
  private readonly principalScopeBySpace = new Map<string, string>();

  constructor(options: ExperienceGeneratorOptions) {
    this.options = options;

    this.turnStartedUnsubscribe = this.options.eventBus.on("space.turn_started", (event) => {
      const typed = event as { spaceId?: unknown; requestedByPrincipalId?: unknown };
      const spaceId = typeof typed.spaceId === "string" ? typed.spaceId.trim() : "";
      const principalId = typeof typed.requestedByPrincipalId === "string"
        ? typed.requestedByPrincipalId.trim()
        : "";
      if (spaceId && principalId) {
        this.principalScopeBySpace.set(spaceId, principalId);
      }
    });

    // Canonical trigger: replay session self-check cadence.
    this.selfCheckUnsubscribe = this.options.eventBus.on("space.self_check", (event) => {
      const spaceId = (event as any).spaceId as string;
      if (spaceId) {
        this.generate(spaceId).catch((err) => {
          console.error(`Experience generation failed for space ${spaceId}:`, err);
        });
      }
    });

    // Backward-compatible trigger for older emitters.
    this.unsubscribe = this.options.eventBus.on("space.completed", (event) => {
      const spaceId = (event as any).spaceId as string;
      if (spaceId) {
        this.generate(spaceId).catch((err) => {
          console.error(`Experience generation failed for space ${spaceId}:`, err);
        });
      }
    });
  }

  /** Clean up event listener. */
  destroy(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.selfCheckUnsubscribe?.();
    this.selfCheckUnsubscribe = null;
    this.turnStartedUnsubscribe?.();
    this.turnStartedUnsubscribe = null;
    this.principalScopeBySpace.clear();
  }

  // -----------------------------------------------------------------------
  // Main pipeline
  // -----------------------------------------------------------------------

  async generate(spaceId: string): Promise<Experience | null> {
    // 1. Load data
    const [config, turns] = await Promise.all([
      this.options.loadSpaceConfig(spaceId),
      this.options.loadHistory(spaceId),
    ]);

    if (!config || turns.length === 0) return null;

    const requestingPrincipalId = this.principalScopeBySpace.get(config.spaceId);
    this.principalScopeBySpace.delete(config.spaceId);
    const reflectionService = this.options.reflectionService ?? new ReflectionService({
      modelPolicy: {
        experience: {
          modelProvider: this.options.modelProvider,
          modelId: this.options.modelId,
        },
      },
    });
    const reflectionResult = await reflectionService.runExperienceJob({
      ...config,
      turns,
      requestingPrincipalId,
    });
    const experience = reflectionResult.experience;

    // 7. Save
    await this.options.saveExperience(experience);

    // 8. Save to memory system
    if (this.options.memoryProvider) {
      await this.options.memoryProvider.save({
        content: `${experience.goal}: ${experience.summary}`,
        type: "semantic",
        scope: requestingPrincipalId
          ? { spaceId: config.spaceId, userId: requestingPrincipalId }
          : { spaceId: config.spaceId },
        metadata: {
          experienceId: experience.experienceId,
          sourceType: "experience",
          sourceId: experience.experienceId,
          sourceStatus: experience.status,
          principalId: requestingPrincipalId,
          strengths: experience.strengths,
          weaknesses: experience.weaknesses,
          agentCount: config.agents.length,
          turnCount: turns.length,
        },
        importance: 0.7,
        tags: experience.tags,
      });
    }

    // 9. Emit event
    this.options.eventBus.emit({
      type: "experience.created",
      spaceId: config.spaceId,
      experienceId: experience.experienceId,
      timestamp: new Date(),
    });

    // 10. Generate personality insights (optional)
    if (this.options.saveInsight) {
      await this.generateInsights(reflectionResult.insightProposals);
    }

    return experience;
  }

  // -----------------------------------------------------------------------
  // Summarization
  // -----------------------------------------------------------------------

  private async summarize(config: SpaceConfigRecord, turns: TurnRecord[]): Promise<string> {
    // Try LLM summarization
    if (this.options.modelProvider && this.options.modelId) {
      try {
        return await this.llmSummarize(config, turns);
      } catch {
        // Fall through to heuristic
      }
    }

    // Heuristic summarization
    return this.heuristicSummarize(config, turns);
  }

  private async llmSummarize(config: SpaceConfigRecord, turns: TurnRecord[]): Promise<string> {
    const conversationText = turns
      .map((t) => `[${t.agentId}]: ${t.output.slice(0, 200)}`)
      .join("\n");

    const messages: ModelMessage[] = [
      {
        role: "system",
        content: "You summarize multi-agent space executions in 2-3 concise sentences. Focus on what was accomplished and how agents collaborated.",
      },
      {
        role: "user",
        content: `Summarize this space execution.\nGoal: ${config.goal ?? config.name}\nTurn model: ${config.turnModel}\nAgents: ${config.agents.map((a) => a.agentId).join(", ")}\n\nConversation:\n${conversationText}`,
      },
    ];

    const result = await this.options.modelProvider!.generate(this.options.modelId!, {
      messages,
      maxTokens: 200,
      temperature: 0.3,
    });

    return result.message.content || this.heuristicSummarize(config, turns);
  }

  private heuristicSummarize(config: SpaceConfigRecord, turns: TurnRecord[]): string {
    const agentNames = config.agents.map((a) => a.agentId).join(", ");
    const totalTokens = turns.reduce((sum, t) => sum + t.promptTokens + t.completionTokens, 0);
    const failedTurns = turns.filter((t) => t.status === "failed").length;

    let summary = `Space "${config.name}" executed ${turns.length} turns with agents [${agentNames}] using ${config.turnModel} strategy. Total tokens: ${totalTokens}.`;
    if (failedTurns > 0) {
      summary += ` ${failedTurns} turns failed.`;
    }
    return summary;
  }

  // -----------------------------------------------------------------------
  // Lesson extraction
  // -----------------------------------------------------------------------

  private async extractLessons(
    config: SpaceConfigRecord,
    turns: TurnRecord[],
  ): Promise<{ strengths: string[]; weaknesses: string[] }> {
    const strengths: string[] = [];
    const weaknesses: string[] = [];

    const failedTurns = turns.filter((t) => t.status === "failed");
    const successTurns = turns.filter((t) => t.status !== "failed");

    if (successTurns.length > 0) {
      strengths.push(`${successTurns.length}/${turns.length} turns completed successfully`);
    }
    if (config.agents.length > 1) {
      strengths.push(`Multi-agent collaboration (${config.agents.length} agents)`);
    }
    if (failedTurns.length === 0) {
      strengths.push("Zero failures");
    }
    if (failedTurns.length > 0) {
      weaknesses.push(`${failedTurns.length} turns failed`);
    }

    // Token efficiency
    const avgTokensPerTurn = turns.reduce((s, t) => s + t.promptTokens + t.completionTokens, 0) / turns.length;
    if (avgTokensPerTurn > 5000) {
      weaknesses.push(`High token usage (avg ${Math.round(avgTokensPerTurn)} per turn)`);
    }

    return { strengths, weaknesses };
  }

  // -----------------------------------------------------------------------
  // Agent observations
  // -----------------------------------------------------------------------

  private generateObservations(
    config: SpaceConfigRecord,
    turns: TurnRecord[],
  ): AgentObservation[] {
    const byAgent = new Map<string, TurnRecord[]>();
    for (const turn of turns) {
      if (!byAgent.has(turn.agentId)) byAgent.set(turn.agentId, []);
      byAgent.get(turn.agentId)!.push(turn);
    }

    const observations: AgentObservation[] = [];
    for (const [agentId, agentTurns] of byAgent) {
      const failed = agentTurns.filter((t) => t.status === "failed").length;
      const succeeded = agentTurns.length - failed;
      const totalTokens = agentTurns.reduce((s, t) => s + t.promptTokens + t.completionTokens, 0);
      const assignment = config.agents.find((a) => a.agentId === agentId);

      let observation = `Agent ${agentId} executed ${agentTurns.length} turns (${succeeded} succeeded, ${failed} failed). Used ${totalTokens} tokens.`;

      const relevance = failed === 0 ? 0.6 : 0.8; // Failed agents get higher relevance for learning
      let suggestion: string | undefined;

      if (failed > 0 && agentTurns.length > 0) {
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

  // -----------------------------------------------------------------------
  // Tag generation
  // -----------------------------------------------------------------------

  private generateTags(config: SpaceConfigRecord, turns: TurnRecord[]): string[] {
    const tags: string[] = [];

    // Turn model tag
    tags.push(`strategy:${config.turnModel}`);

    // Agent count
    tags.push(`agents:${config.agents.length}`);

    // Turn count bucket
    if (turns.length <= 5) tags.push("turns:few");
    else if (turns.length <= 20) tags.push("turns:moderate");
    else tags.push("turns:many");

    // Success rate
    const failRate = turns.filter((t) => t.status === "failed").length / turns.length;
    if (failRate === 0) tags.push("outcome:success");
    else if (failRate < 0.3) tags.push("outcome:partial");
    else tags.push("outcome:failed");

    // Goal keywords
    if (config.goal) {
      const words = config.goal.toLowerCase().split(/\s+/).slice(0, 3);
      tags.push(...words.filter((w) => w.length > 3));
    }

    return tags;
  }

  // -----------------------------------------------------------------------
  // Personality insights
  // -----------------------------------------------------------------------

  private async generateInsights(insights: InsightProposalRecord[]): Promise<void> {
    for (const insight of insights) {
      try {
        await this.options.saveInsight!(insight);
      } catch (err) {
        console.error(`Failed to save insight for profile ${insight.profileId}:`, err);
      }
    }
  }
}
