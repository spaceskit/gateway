import { describe, expect, test } from "bun:test";
import { ReflectionService } from "../../src/reflection/reflection-service.js";

describe("ReflectionService", () => {
  test("falls back to heuristic orchestrator summaries when no model is configured", async () => {
    const service = new ReflectionService();

    const result = await service.runSummaryJob({
      kind: "orchestrator",
      conversationTopology: "broadcast_team",
      turnModel: "primary_only",
      userInput: "Investigate rollout health",
      participants: [
        {
          agentId: "coordinator",
          isPrimary: true,
          status: "completed",
          finalMessage: "Delegated work and synthesized the result.",
        },
        {
          agentId: "worker-1",
          isPrimary: false,
          status: "completed",
          finalMessage: "Validated the deployment path.",
        },
      ],
      peerReview: {
        enabled: false,
        status: "skipped",
        completed: 0,
        assignments: 0,
        failed: 0,
      },
      highlights: [],
    });

    expect(result.fallbackMode).toBe("heuristic");
    expect(result.summaryText).toContain("coordinated");
    expect(result.trace.jobType).toBe("summary");
    expect(result.trace.kind).toBe("orchestrator");
  });

  test("uses the configured model for orchestrator summaries when available", async () => {
    const service = new ReflectionService({
      modelPolicy: {
        summary: {
          modelId: "summary-model",
          modelProvider: {
            async generate() {
              return {
                message: { role: "assistant", content: "Model synthesized summary." },
                usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
                finishReason: "stop",
              };
            },
          },
        },
      },
    });

    const result = await service.runSummaryJob({
      kind: "orchestrator",
      conversationTopology: "shared_team_chat",
      turnModel: "sequential_all",
      userInput: "Plan the release train",
      participants: [
        {
          agentId: "agent-1",
          isPrimary: true,
          status: "completed",
          finalMessage: "Initial release plan.",
        },
        {
          agentId: "agent-2",
          isPrimary: false,
          status: "completed",
          finalMessage: "Operational checks.",
        },
      ],
      peerReview: {
        enabled: true,
        status: "completed",
        completed: 1,
        assignments: 1,
        failed: 0,
      },
      highlights: [],
    });

    expect(result.fallbackMode).toBe("model");
    expect(result.summaryText).toBe("Model synthesized summary.");
    expect(result.trace.modelId).toBe("summary-model");
  });

  test("builds experiences and insight proposals through the shared reflection pipeline", async () => {
    const service = new ReflectionService();

    const result = await service.runExperienceJob({
      spaceId: "space-1",
      resourceId: "resource-1",
      name: "Reliability Review",
      goal: "Investigate gateway reliability",
      turnModel: "broadcast_team",
      agents: [{ agentId: "agent-1", profileId: "profile-1", isPrimary: true }],
      turns: [
        {
          turnId: "turn-1",
          agentId: "agent-1",
          input: "Investigate gateway reliability",
          output: "Failure rate stayed high because retries were misconfigured.",
          promptTokens: 120,
          completionTokens: 40,
          status: "failed",
        },
      ],
      requestingPrincipalId: "user-1",
    });

    expect(result.experience.status).toBe("accepted");
    expect(result.experience.summary.length).toBeGreaterThan(0);
    expect(result.experience.agentObservations).toHaveLength(1);
    expect(result.insightProposals).toHaveLength(1);
    expect(result.insightProposals[0]?.experienceId).toBe(result.experience.experienceId);
    expect(result.summaryTrace.jobType).toBe("summary");
    expect(result.insightTrace.jobType).toBe("insight");
  });

  test("produces concise space digests for concierge consumers", async () => {
    const service = new ReflectionService();

    const result = await service.runSummaryJob({
      kind: "space_digest",
      spaceId: "space-1",
      spaceName: "Gateway Ops",
      goal: "Track runtime health",
      activeAgents: 2,
      turns: [
        {
          agentId: "agent-1",
          status: "completed",
          output: "Observed a reconnect spike on the external gateway.",
          createdAt: "2026-03-28T10:00:00.000Z",
        },
        {
          agentId: "agent-2",
          status: "completed",
          output: "Identified the sync queue backlog as the likely cause.",
          createdAt: "2026-03-28T10:01:00.000Z",
        },
      ],
      pendingActions: ["Review reconnect policy"],
    });

    expect(result.summaryText).toContain("Gateway Ops");
    expect(result.summaryText).toContain("Review reconnect policy");
    expect(result.trace.kind).toBe("space_digest");
  });
});
