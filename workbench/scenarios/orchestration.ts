import {
  GatewayClient,
  generateAuthKeyPair,
  type SpaceTurnTrace,
} from "../client.js";
import type {
  SchedulerEvalCheckpointPayload,
  SchedulerEvalRecommendationPayload,
  SchedulerEvalRunPayload,
  SchedulerEvalScenarioResultPayload,
} from "../../packages/server/src/protocol/scheduler.js";
import type { ScenarioOutcome, Layer, ScenarioContext } from "./index.js";

interface OrchestrationJournalEntry {
  eventId: string;
  eventType: string;
  actorId: string;
  createdAt: string;
  payload: Record<string, unknown>;
}

interface TurnEvidenceBundle {
  trace: SpaceTurnTrace;
  journalEntries: OrchestrationJournalEntry[];
}

const SUMMARY_MODE: SchedulerEvalRunPayload["summaryMode"] = "final_summary";
const ORCHESTRATION_PROVIDER = "apple";
const ORCHESTRATION_MODEL = "apple/apple-on-device";
const ORCHESTRATION_EVIDENCE_TIMEOUT_MS = 180_000;

async function makeClient(wsUrl: string): Promise<GatewayClient> {
  const keyPair = await generateAuthKeyPair();
  const client = new GatewayClient({
    url: wsUrl,
    reconnect: false,
    requestTimeoutMs: 15_000,
    deviceId: `bench-orch-${crypto.randomUUID().slice(0, 8)}`,
    devicePublicKey: keyPair.publicKeyBase64,
  });
  client.setAuthKeyPair(keyPair);
  await client.connect();

  const start = Date.now();
  while (Date.now() - start < 5000) {
    await new Promise((r) => setTimeout(r, 100));
    try {
      await client.ping();
      return client;
    } catch {
      // Not ready yet.
    }
  }

  throw new Error("Auth timeout");
}

async function createCollaborativeSpace(client: GatewayClient, label: string): Promise<{
  profileId: string;
  spaceId: string;
  spaceUid: string;
  agentIds: string[];
}> {
  const definition = await client.createAgentDefinition({
    name: `Orch ${label} Agent`,
    instructions: [
      "You are a collaborative workbench orchestration agent.",
      "This benchmark measures planner, guest, peer-review, synthesis, and summary phases.",
      "Do not use shell, filesystem, web, or MCP tools unless the prompt explicitly requires them.",
      "Work only from the prompt and produce concise textual analysis.",
    ].join(" "),
    providerHint: ORCHESTRATION_PROVIDER,
    modelHint: ORCHESTRATION_MODEL,
  });
  const profileId = definition.agentDefinition.agentDefinitionId;
  const agentIds = [
    `orch-coordinator-${crypto.randomUUID().slice(0, 8)}`,
    `orch-guest-a-${crypto.randomUUID().slice(0, 8)}`,
    `orch-guest-b-${crypto.randomUUID().slice(0, 8)}`,
    `orch-guest-c-${crypto.randomUUID().slice(0, 8)}`,
  ];

  const space = await client.createSpace({
    idempotencyKey: `workbench:orchestration:${crypto.randomUUID()}`,
    name: `bench-orch-${label}`,
    resourceId: `resource:bench-orch:${label}:${crypto.randomUUID().slice(0, 8)}`,
    goal: "Multi-agent orchestration evaluation",
    turnModel: "sequential_all",
    capabilities: ["lists"],
    initialAgents: [
      {
        agentId: agentIds[0],
        profileId,
        role: "global_coordinator" as const,
        isPrimary: true,
      },
      {
        agentId: agentIds[1],
        profileId,
        role: "participant" as const,
        isPrimary: false,
      },
      {
        agentId: agentIds[2],
        profileId,
        role: "participant" as const,
        isPrimary: false,
      },
      {
        agentId: agentIds[3],
        profileId,
        role: "participant" as const,
        isPrimary: false,
      },
    ],
  });

  const spaceId = space.id;
  const spaceUid = space.spaceUid ?? space.id;

  if (!spaceId || !spaceUid) {
    throw new Error("Multi-agent space creation failed");
  }

  return {
    profileId,
    spaceId,
    spaceUid,
    agentIds,
  };
}

async function waitForTurnEvidence(
  client: GatewayClient,
  spaceId: string,
  turnId: string,
): Promise<TurnEvidenceBundle> {
  const startedAt = Date.now();
  let lastError: string | undefined;
  let lastObservedFailure: string | undefined;

  while (Date.now() - startedAt < ORCHESTRATION_EVIDENCE_TIMEOUT_MS) {
    try {
      const [trace, journalResponse] = await Promise.all([
        client.getTurnTrace({ spaceId, turnId }),
        client.listOrchestrationJournal({ spaceId, turnId }),
      ]);
      const journalEntries = (journalResponse.entries ?? []) as OrchestrationJournalEntry[];
      const observedFailure = latestObservedFailure(trace, journalEntries);
      if (observedFailure) {
        lastObservedFailure = observedFailure;
      }
      const hasTerminalEvent = trace.events.some((event) =>
        event.eventType === "summary.completed" || event.eventType === "summary.failed",
      ) || journalEntries.some((entry) =>
        entry.eventType === "summary.completed" || entry.eventType === "summary.failed",
      );
      if (hasTerminalEvent || hasSyntheticTerminalSummary(trace, journalEntries)) {
        return { trace, journalEntries };
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }

    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  throw new Error(
    `Timed out waiting for orchestration evidence${lastObservedFailure ? ` (${lastObservedFailure})` : lastError ? ` (${lastError})` : ""}`,
  );
}

function latestObservedFailure(
  trace: SpaceTurnTrace,
  journalEntries: OrchestrationJournalEntry[],
): string | undefined {
  const traceFailure = [...trace.events].reverse().find((event) => event.eventType === "error");
  const traceMessage = extractFailureMessage(traceFailure?.payload);
  if (traceMessage) {
    return traceMessage;
  }

  const journalFailure = [...journalEntries].reverse().find((entry) => entry.eventType === "failure");
  const journalMessage = extractFailureMessage(journalFailure?.payload);
  if (journalMessage) {
    return journalMessage;
  }

  return undefined;
}

function extractFailureMessage(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return undefined;
  }

  const errorRecord = (payload as { error?: unknown }).error;
  if (errorRecord && typeof errorRecord === "object" && !Array.isArray(errorRecord)) {
    const message = (errorRecord as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) {
      return message.trim();
    }
  }

  const directMessage = (payload as { message?: unknown }).message;
  if (typeof directMessage === "string" && directMessage.trim()) {
    return directMessage.trim();
  }

  const directError = (payload as { error?: unknown }).error;
  if (typeof directError === "string" && directError.trim()) {
    return directError.trim();
  }

  return undefined;
}

function sanitizeDetail(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(([, entry]) =>
      typeof entry === "string"
      || typeof entry === "number"
      || typeof entry === "boolean"
      || (entry && typeof entry === "object" && !Array.isArray(entry)),
    ),
  );
}

function makeCheckpoint(
  kind: string,
  actorId: string | undefined,
  createdAt: string,
  detail: Record<string, unknown> | undefined,
): SchedulerEvalCheckpointPayload {
  return {
    checkpointId: `${kind}:${actorId ?? "system"}:${createdAt}`,
    kind,
    status: kind === "summary.failed" ? "failed" : kind.startsWith("context.summar") ? "observed" : "completed",
    ...(actorId ? { actorId } : {}),
    createdAt,
    ...(detail ? { detail } : {}),
  };
}

function collectCheckpoints(bundle: TurnEvidenceBundle): SchedulerEvalCheckpointPayload[] {
  const checkpoints: SchedulerEvalCheckpointPayload[] = [];
  const seen = new Set<string>();

  const addCheckpoint = (checkpoint: SchedulerEvalCheckpointPayload) => {
    const key = `${checkpoint.kind}|${checkpoint.actorId ?? ""}|${checkpoint.createdAt}`;
    if (seen.has(key)) return;
    seen.add(key);
    checkpoints.push(checkpoint);
  };

  for (const entry of bundle.journalEntries) {
    addCheckpoint(
      makeCheckpoint(
        entry.eventType,
        entry.actorId,
        entry.createdAt,
        sanitizeDetail(entry.payload),
      ),
    );
  }

  for (const event of bundle.trace.events) {
    if (!event.eventType.startsWith("context.summar")) continue;
    addCheckpoint(
      makeCheckpoint(
        event.eventType,
        event.agentId,
        event.createdAt,
        sanitizeDetail(event.payload),
      ),
    );
  }

  const hasSummaryCheckpoint = checkpoints.some((checkpoint) => checkpoint.kind.startsWith("summary."));
  const synthesizedSummaryEvent = latestSynthesizedSummaryEvent(bundle.trace, bundle.journalEntries);
  if (!hasSummaryCheckpoint && synthesizedSummaryEvent) {
    addCheckpoint(
      makeCheckpoint(
        "summary.completed",
        synthesizedSummaryEvent.agentId,
        synthesizedSummaryEvent.createdAt,
        {
          synthesized: true,
          source: "turn_completed",
        },
      ),
    );
  }

  return checkpoints.sort((lhs, rhs) => lhs.createdAt.localeCompare(rhs.createdAt));
}

function collectFinalSummary(bundle: TurnEvidenceBundle): string | undefined {
  const summaryCheckpoint = bundle.journalEntries.find((entry) => entry.eventType === "summary.completed")
    ?? bundle.trace.events.find((event) => event.eventType === "summary.completed");
  if (summaryCheckpoint) {
    const summary = (summaryCheckpoint.payload as { summary?: { finalSummaryText?: string } }).summary;
    return summary?.finalSummaryText?.trim() || undefined;
  }

  return finalMessageFromTurnCompleted(latestSynthesizedSummaryEvent(bundle.trace, bundle.journalEntries));
}

function hasSyntheticTerminalSummary(
  trace: SpaceTurnTrace,
  journalEntries: OrchestrationJournalEntry[],
): boolean {
  return latestSynthesizedSummaryEvent(trace, journalEntries) !== undefined;
}

function latestSynthesizedSummaryEvent(
  trace: SpaceTurnTrace,
  journalEntries: OrchestrationJournalEntry[],
): SpaceTurnTrace["events"][number] | undefined {
  const hasSynthesisResult = journalEntries.some((entry) => entry.eventType === "synthesis.result");
  if (!hasSynthesisResult) {
    return undefined;
  }

  for (let index = trace.events.length - 1; index >= 0; index -= 1) {
    const event = trace.events[index];
    if (event.eventType === "turn_completed") {
      return event;
    }
  }
  return undefined;
}

function finalMessageFromTurnCompleted(
  event: SpaceTurnTrace["events"][number] | undefined,
): string | undefined {
  const payload = event?.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return undefined;
  }

  const result = (payload as { result?: unknown }).result;
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return undefined;
  }

  const finalMessage = (result as { finalMessage?: unknown }).finalMessage;
  if (!finalMessage || typeof finalMessage !== "object" || Array.isArray(finalMessage)) {
    return undefined;
  }

  const content = (finalMessage as { content?: unknown }).content;
  return typeof content === "string" && content.trim() ? content.trim() : undefined;
}

function buildRecommendations(
  evalConfig: Pick<SchedulerEvalRunPayload, "summaryMode" | "flowVariantId" | "promptPackId">,
  checkpoints: SchedulerEvalCheckpointPayload[],
  runId: string,
): SchedulerEvalRecommendationPayload[] {
  const recommendations: SchedulerEvalRecommendationPayload[] = [];
  if (!evalConfig.promptPackId && checkpoints.some((checkpoint) => checkpoint.kind.startsWith("peer_review."))) {
    recommendations.push({
      recommendationId: `${runId}:prompt-pack`,
      status: "suggested",
      kind: "prompt_pack",
      title: "Pin a prompt pack for peer-review driven runs",
      summary: "Peer-review checkpoints were observed without an explicit prompt pack.",
      originatingRunId: runId,
      createdAt: new Date().toISOString(),
    });
  }
  if (evalConfig.flowVariantId !== "research" && checkpoints.some((checkpoint) => checkpoint.kind === "context.summarized")) {
    recommendations.push({
      recommendationId: `${runId}:flow-variant`,
      status: "suggested",
      kind: "flow_variant",
      title: "Switch to the research flow for context-heavy runs",
      summary: "Context summarization appeared during the turn, which is a good fit for the research flow.",
      originatingRunId: runId,
      flowVariantId: "research",
      createdAt: new Date().toISOString(),
    });
  }
  if (evalConfig.summaryMode !== "checkpoints" && checkpoints.some((checkpoint) => checkpoint.kind.startsWith("summary."))) {
    recommendations.push({
      recommendationId: `${runId}:summary-mode`,
      status: "suggested",
      kind: "summary_mode",
      title: "Use checkpoint summaries for easier auditability",
      summary: "Terminal summary checkpoints were present; checkpoint summaries are easier to inspect in the dashboard.",
      originatingRunId: runId,
      createdAt: new Date().toISOString(),
      detail: { summaryMode: "checkpoints" },
    });
  }
  return recommendations;
}

function buildScenarioResults(
  checkpoints: SchedulerEvalCheckpointPayload[],
): SchedulerEvalScenarioResultPayload[] {
  const count = (kind: string): number => checkpoints.filter((checkpoint) => checkpoint.kind === kind).length;
  const has = (kind: string): boolean => count(kind) > 0;
  const guestDispatchCount = count("guest.dispatch");
  const peerReviewCount = count("peer_review.result");
  const summaryCompleted = has("summary.completed");
  const plannerObserved = has("planner.input");
  const synthesisObserved = has("synthesis.result");

  return [
    {
      scenarioId: "planner-multi-guest-dispatch",
      status: plannerObserved && guestDispatchCount >= 3 ? "pass" : "fail",
      checkpointCount: checkpoints.length,
      ...(plannerObserved && guestDispatchCount >= 3
        ? {}
        : { failureReason: `Expected planner input plus 3 guest dispatches, saw planner=${plannerObserved} guest.dispatch=${guestDispatchCount}` }),
    },
    {
      scenarioId: "peer-review-and-synthesis",
      status: peerReviewCount >= 2 && synthesisObserved ? "pass" : "fail",
      checkpointCount: checkpoints.length,
      ...(peerReviewCount >= 2 && synthesisObserved
        ? {}
        : { failureReason: `Expected at least 2 peer-review results and synthesis, saw peer_review.result=${peerReviewCount} synthesis.result=${synthesisObserved}` }),
    },
    {
      scenarioId: "final-summary-and-checkpoints",
      status: summaryCompleted && checkpoints.length > 0 ? "pass" : "fail",
      checkpointCount: checkpoints.length,
      ...(summaryCompleted && checkpoints.length > 0
        ? {}
        : { failureReason: `Expected a final summary checkpoint and checkpoint evidence, saw summary.completed=${summaryCompleted} checkpoints=${checkpoints.length}` }),
    },
  ];
}

function buildEvalRun(
  space: { id: string; spaceUid: string; name?: string },
  turnId: string,
  bundle: TurnEvidenceBundle,
): SchedulerEvalRunPayload {
  const checkpoints = collectCheckpoints(bundle);
  const finalSummaryText = collectFinalSummary(bundle);
  const recommendations = buildRecommendations(
    {
      summaryMode: SUMMARY_MODE,
      flowVariantId: undefined,
      promptPackId: undefined,
    },
    checkpoints,
    turnId,
  );

  return {
    evalRunId: `workbench-orchestration-${turnId}`,
    evalDefinitionId: "suite:full",
    scenarioIds: [
      "planner-multi-guest-dispatch",
      "peer-review-and-synthesis",
      "final-summary-and-checkpoints",
    ],
    summaryMode: SUMMARY_MODE,
    selfImproveEnabled: false,
    spaceId: space.id,
    spaceUid: space.spaceUid,
    rootTurnId: turnId,
    finalSummaryText,
    artifactRefs: [
      {
        kind: "space",
        id: space.id,
        label: space.name,
      },
      {
        kind: "turn",
        id: turnId,
        label: "Root Turn",
      },
      {
        kind: "scheduler_run",
        id: `workbench-orchestration-${turnId}`,
        label: "Workbench Orchestration",
      },
    ],
    checkpoints,
    scenarioResults: buildScenarioResults(checkpoints),
    recommendations,
  };
}

export const orchestrationLayer: Layer = {
  name: "orchestration",
  scenarios: [
    {
      name: "multi-agent-space-creation",
      run: async (_ctx: ScenarioContext) => {
        const client = await makeClient(_ctx.wsUrl);
        try {
          const space = await createCollaborativeSpace(client, "space-creation");
          _ctx.registerSpace?.(space.spaceId);
          if (space.agentIds.length !== 4) {
            throw new Error(`Expected 4 agents, got ${space.agentIds.length}`);
          }

          const storedSpace = await client.getSpace(space.spaceId);
          const coordinatorCount = storedSpace.agents.filter((agent) => agent.role === "global_coordinator").length;
          const participantCount = storedSpace.agents.filter((agent) => agent.role === "participant").length;

          if (coordinatorCount !== 1) {
            throw new Error(`Expected 1 coordinator, got ${coordinatorCount}`);
          }
          if (participantCount < 3) {
            throw new Error(`Expected 3 guests, got ${participantCount}`);
          }

          return {
            evidence: [
              {
                label: "collaborative space created",
                status: "pass",
                detail: {
                  spaceId: space.spaceId,
                  spaceUid: space.spaceUid,
                  agentCount: storedSpace.agents.length,
                },
              },
            ],
          };
        } finally {
          await client.disconnect();
        }
      },
    },
    {
      name: "planner-multi-guest-review-synthesis",
      run: async (_ctx: ScenarioContext): Promise<ScenarioOutcome> => {
        const client = await makeClient(_ctx.wsUrl);
        try {
          const space = await createCollaborativeSpace(client, "collaboration-evidence");
          _ctx.registerSpace?.(space.spaceId);
          await client.subscribe([space.spaceId]);

          const turnResult = await client.executeTurn({
            spaceUid: space.spaceUid,
            input: [
              "Plan a collaborative research pass for a scheduler eval.",
              "Use a planner, at least three guest perspectives, peer review, synthesis, and a final summary.",
            ].join(" "),
            mode: "ask",
            accessMode: "default",
          });
          if (!turnResult.turnId) {
            throw new Error("executeTurn did not return a turnId");
          }
          _ctx.registerTurn?.(space.spaceId, turnResult.turnId);

          const evidenceBundle = await waitForTurnEvidence(client, space.spaceId, turnResult.turnId);
          const checkpoints = collectCheckpoints(evidenceBundle);
          const eventTypes = checkpoints.map((checkpoint) => checkpoint.kind);
          const guestDispatchCount = eventTypes.filter((kind) => kind === "guest.dispatch").length;
          const peerReviewCount = eventTypes.filter((kind) => kind === "peer_review.result").length;
          const summaryCompleted = eventTypes.includes("summary.completed");
          const plannerObserved = eventTypes.includes("planner.input");
          const synthesisObserved = eventTypes.includes("synthesis.result");

          if (!plannerObserved) {
            throw new Error("planner.input checkpoint was not observed");
          }
          if (guestDispatchCount < 3) {
            throw new Error(`Expected 3 guest dispatches, got ${guestDispatchCount}`);
          }
          if (peerReviewCount < 2) {
            throw new Error(`Expected at least 2 peer-review checkpoints, got ${peerReviewCount}`);
          }
          if (!synthesisObserved) {
            throw new Error("synthesis.result checkpoint was not observed");
          }
          if (!summaryCompleted) {
            throw new Error("summary.completed checkpoint was not observed");
          }

          const evalRun = buildEvalRun(
            {
              id: space.spaceId,
              spaceUid: space.spaceUid,
              name: "Collaborative Orchestration",
            },
            turnResult.turnId,
            evidenceBundle,
          );
          _ctx.recordSchedulerEvalRun?.(evalRun);

          return {
            evidence: [
              {
                label: "planner, guests, peer review, synthesis, and summary observed",
                status: "pass",
                detail: {
                  turnId: turnResult.turnId,
                  checkpointCount: checkpoints.length,
                  guestDispatchCount,
                  peerReviewCount,
                  finalSummaryText: evalRun.finalSummaryText,
                },
              },
              {
                label: "turn trace captured",
                status: "pass",
                detail: {
                  traceEvents: evidenceBundle.trace.events.length,
                  journalEntries: evidenceBundle.journalEntries.length,
                },
              },
            ],
            schedulerEvalRuns: [evalRun],
          };
        } finally {
          await client.disconnect();
        }
      },
    },
  ],
};
