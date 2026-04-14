import { randomUUID } from "node:crypto";
import {
  ArtifactRepository,
  SpaceRepository,
} from "@spaceskit/persistence";
import { ExecutionAdapterFactory } from "../../packages/bootstrap/src/execution/execution-adapter-factory.js";
import {
  GatewayClient,
  generateAuthKeyPair,
  type SpaceTurnTrace,
  type TurnEventPayload,
} from "../client.js";
import {
  skipScenario,
  type Layer,
  type ScenarioContext,
  type ScenarioOutcome,
} from "./index.js";

export const WORKBENCH_PLAN_TEMPLATE_ID = "workbench/plan-discussion";
export const WORKBENCH_CODE_TEMPLATE_ID = "workbench/code-implementation";
export const WORKBENCH_PLAN_ARTIFACT_TAGS = ["workbench", "plan-handoff", "template-handoff"] as const;

const PLAN_AGENT_COUNT = 6;
const CODE_AGENT_COUNT = 5;
const TURN_TIMEOUT_MS = 180_000;

const MID_COMPLEX_PLAN_PROMPT = [
  "Create a decision-complete implementation plan for saved Workbench run presets.",
  "The feature should support layer/provider filters, optional schedule metadata, a verification summary, API/UI handling, and tests.",
  "Treat this as a mid-complex repository change: identify interfaces, data flow, edge cases, and acceptance criteria.",
  "Return Markdown only. Include Summary, Implementation Changes, Test Plan, and Assumptions.",
].join(" ");

interface RuntimeTarget {
  providerId: string;
  model: string;
  required: boolean;
  roleFocus: string;
}

const RUNTIME_TARGET_BY_PROFILE_ID: Record<string, RuntimeTarget> = {
  "plan-coordinator-opus": {
    providerId: "claude-agent-sdk",
    model: "claude-agent-sdk/claude-opus-4-6",
    required: true,
    roleFocus: "coordinate the planning discussion and produce the final handoff plan",
  },
  "plan-codex-architect": {
    providerId: "codex-app-server",
    model: "codex-app-server/gpt-5.4",
    required: true,
    roleFocus: "check codebase architecture, implementation order, and test seams",
  },
  "plan-opus-reviewer": {
    providerId: "claude-agent-sdk",
    model: "claude-agent-sdk/claude-opus-4-6",
    required: true,
    roleFocus: "review the plan for missing decisions and risky assumptions",
  },
  "plan-gemini-constraints": {
    providerId: "gemini",
    model: "gemini/gemini-2.5-flash",
    required: true,
    roleFocus: "check constraints, compatibility, and acceptance criteria",
  },
  "plan-lmstudio-maintainer": {
    providerId: "lmstudio",
    model: "lmstudio/qwen2.5-coder",
    required: false,
    roleFocus: "provide local-runtime maintenance checks",
  },
  "plan-apple-continuity": {
    providerId: "apple",
    model: "apple/apple-on-device",
    required: false,
    roleFocus: "provide local continuity and coordination checks",
  },
  "code-lead-codex": {
    providerId: "codex-app-server",
    model: "codex-app-server/gpt-5.4",
    required: true,
    roleFocus: "lead implementation planning from the saved handoff artifact",
  },
  "code-opus-reviewer": {
    providerId: "claude-agent-sdk",
    model: "claude-agent-sdk/claude-opus-4-6",
    required: true,
    roleFocus: "review implementation risks and missing tests",
  },
  "code-gemini-integrator": {
    providerId: "gemini",
    model: "gemini/gemini-2.5-flash",
    required: true,
    roleFocus: "check API/UI integration and compatibility",
  },
  "code-lmstudio-maintainer": {
    providerId: "lmstudio",
    model: "lmstudio/qwen2.5-coder",
    required: false,
    roleFocus: "provide maintenance and cheap local verification checks",
  },
  "code-apple-continuity": {
    providerId: "apple",
    model: "apple/apple-on-device",
    required: false,
    roleFocus: "check whether the implementation team can continue from the artifact",
  },
};

export interface WorkbenchTemplateAgent {
  agentId: string;
  agentDefinitionId?: string;
  profileId?: string;
  role?: string;
  turnOrder?: number;
  isPrimary?: boolean;
}

export interface WorkbenchLiveAgentSelection {
  agents: WorkbenchTemplateAgent[];
  requiredProvidersUsed: string[];
  optionalProvidersUsed: string[];
  optionalProvidersOmitted: string[];
  missingRequiredProviders: string[];
}

export function selectWorkbenchLiveAgents(input: {
  templateId: string;
  agents: WorkbenchTemplateAgent[];
  availableProviderIds: Set<string>;
}): WorkbenchLiveAgentSelection {
  const selectedAgents: WorkbenchTemplateAgent[] = [];
  const requiredProvidersUsed: string[] = [];
  const optionalProvidersUsed: string[] = [];
  const optionalProvidersOmitted: string[] = [];
  const missingRequiredProviders: string[] = [];

  for (const agent of input.agents) {
    const target = runtimeTargetForAgent(agent);
    if (!target) {
      selectedAgents.push(agent);
      continue;
    }

    if (input.availableProviderIds.has(target.providerId)) {
      selectedAgents.push(agent);
      pushUnique(target.required ? requiredProvidersUsed : optionalProvidersUsed, target.providerId);
      continue;
    }

    if (target.required) {
      pushUnique(missingRequiredProviders, target.providerId);
    } else {
      pushUnique(optionalProvidersOmitted, target.providerId);
    }
  }

  return {
    agents: selectedAgents,
    requiredProvidersUsed,
    optionalProvidersUsed,
    optionalProvidersOmitted,
    missingRequiredProviders,
  };
}

export function buildWorkbenchPlanArtifactPayload(input: {
  markdown: string;
  sourceTemplateId: string;
  targetTemplateId: string;
  sourceSpaceId: string;
  sourceTurnId: string;
  requiredProvidersUsed: string[];
  optionalProvidersUsed: string[];
  optionalProvidersOmitted: string[];
}): {
  type: string;
  title: string;
  mimeType: string;
  contentJson: string;
  tagsJson: string;
  visibility: "shared";
} {
  return {
    type: "workbench.plan",
    title: "Workbench template handoff plan",
    mimeType: "application/json",
    contentJson: JSON.stringify({
      schemaVersion: 1,
      kind: "workbench.plan",
      markdown: input.markdown,
      sourceTemplateId: input.sourceTemplateId,
      targetTemplateId: input.targetTemplateId,
      sourceSpaceId: input.sourceSpaceId,
      sourceTurnId: input.sourceTurnId,
      requiredProvidersUsed: input.requiredProvidersUsed,
      optionalProvidersUsed: input.optionalProvidersUsed,
      optionalProvidersOmitted: input.optionalProvidersOmitted,
    }),
    tagsJson: JSON.stringify([...WORKBENCH_PLAN_ARTIFACT_TAGS]),
    visibility: "shared",
  };
}

export const templateHandoffLayer: Layer = {
  name: "template-handoff",
  scenarios: [
    {
      name: "catalog-plan-and-code-templates",
      run: async (ctx: ScenarioContext): Promise<ScenarioOutcome> => {
        const client = await makeClient(ctx.wsUrl, "bench-template-catalog");
        try {
          const planPreview = await client.previewTemplate({
            templateId: WORKBENCH_PLAN_TEMPLATE_ID,
            resourceId: `resource:workbench:template-preview:${randomUUID()}`,
          });
          const codePreview = await client.previewTemplate({
            templateId: WORKBENCH_CODE_TEMPLATE_ID,
            resourceId: `resource:workbench:template-preview:${randomUUID()}`,
          });

          assertTemplatePreview(planPreview, {
            templateId: WORKBENCH_PLAN_TEMPLATE_ID,
            expectedAgentCount: PLAN_AGENT_COUNT,
            expectedPrimaryProfileId: "plan-coordinator-opus",
          });
          assertTemplatePreview(codePreview, {
            templateId: WORKBENCH_CODE_TEMPLATE_ID,
            expectedAgentCount: CODE_AGENT_COUNT,
            expectedPrimaryProfileId: "code-lead-codex",
          });

          const planSpace = await client.createSpaceFromTemplate({
            idempotencyKey: `workbench:template-handoff:catalog:plan:${randomUUID()}`,
            templateId: WORKBENCH_PLAN_TEMPLATE_ID,
            resourceId: `resource:workbench:template-catalog:plan:${randomUUID()}`,
            name: "bench-template-plan-discussion",
          });
          const codeSpace = await client.createSpaceFromTemplate({
            idempotencyKey: `workbench:template-handoff:catalog:code:${randomUUID()}`,
            templateId: WORKBENCH_CODE_TEMPLATE_ID,
            resourceId: `resource:workbench:template-catalog:code:${randomUUID()}`,
            name: "bench-template-code-implementation",
          });
          ctx.registerSpace?.(planSpace.space.id);
          ctx.registerSpace?.(codeSpace.space.id);

          if (planSpace.space.agents.length !== PLAN_AGENT_COUNT) {
            throw new Error(`Expected ${PLAN_AGENT_COUNT} plan agents, got ${planSpace.space.agents.length}`);
          }
          if (codeSpace.space.agents.length !== CODE_AGENT_COUNT) {
            throw new Error(`Expected ${CODE_AGENT_COUNT} code agents, got ${codeSpace.space.agents.length}`);
          }

          return {
            evidence: [
              {
                label: "plan discussion template previewed and created",
                status: "pass",
                detail: {
                  templateId: WORKBENCH_PLAN_TEMPLATE_ID,
                  spaceId: planSpace.space.id,
                  agentCount: planSpace.space.agents.length,
                },
              },
              {
                label: "code implementation template previewed and created",
                status: "pass",
                detail: {
                  templateId: WORKBENCH_CODE_TEMPLATE_ID,
                  spaceId: codeSpace.space.id,
                  agentCount: codeSpace.space.agents.length,
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
      name: "staged-plan-artifact-to-code",
      run: async (ctx: ScenarioContext): Promise<ScenarioOutcome> => {
        if (!ctx.gateway.db) {
          skipScenario("Gateway database is unavailable; cannot persist handoff artifacts.");
        }

        const availability = await resolveWorkbenchProviderAvailability(ctx);
        const availableProviderIds = new Set(
          availability.filter((entry) => entry.available).map((entry) => entry.providerId),
        );
        const missingRequiredProviders = uniqueProviderIds(
          availability.filter((entry) => entry.required && !entry.available).map((entry) => entry.providerId),
        );
        if (missingRequiredProviders.length > 0) {
          skipScenario(
            `Required providers unavailable for template handoff: ${missingRequiredProviders.join(", ")}`,
            providerAvailabilityEvidence(availability),
          );
        }

        const client = await makeClient(ctx.wsUrl, "bench-template-handoff");
        try {
          const planPreview = await client.previewTemplate({
            templateId: WORKBENCH_PLAN_TEMPLATE_ID,
            resourceId: `resource:workbench:handoff-preview:plan:${randomUUID()}`,
          });
          const codePreview = await client.previewTemplate({
            templateId: WORKBENCH_CODE_TEMPLATE_ID,
            resourceId: `resource:workbench:handoff-preview:code:${randomUUID()}`,
          });

          const planSelection = selectWorkbenchLiveAgents({
            templateId: WORKBENCH_PLAN_TEMPLATE_ID,
            agents: planPreview.resolved.initialAgents,
            availableProviderIds,
          });
          const codeSelection = selectWorkbenchLiveAgents({
            templateId: WORKBENCH_CODE_TEMPLATE_ID,
            agents: codePreview.resolved.initialAgents,
            availableProviderIds,
          });
          const missingFromSelections = uniqueProviderIds([
            ...planSelection.missingRequiredProviders,
            ...codeSelection.missingRequiredProviders,
          ]);
          if (missingFromSelections.length > 0) {
            skipScenario(
              `Required providers unavailable for selected template agents: ${missingFromSelections.join(", ")}`,
              providerAvailabilityEvidence(availability),
            );
          }

          const runtimeTargets = new Map(
            availability
              .filter((entry) => entry.available)
              .map((entry) => [entry.providerId, entry]),
          );
          const planSpace = await createRuntimeSpaceFromSelection({
            client,
            ctx,
            templateId: WORKBENCH_PLAN_TEMPLATE_ID,
            preview: planPreview,
            selection: planSelection,
            runtimeTargets,
            name: "bench-template-handoff-plan",
            goal: "Create a saved Workbench plan handoff artifact.",
          });
          const codeSpace = await createRuntimeSpaceFromSelection({
            client,
            ctx,
            templateId: WORKBENCH_CODE_TEMPLATE_ID,
            preview: codePreview,
            selection: codeSelection,
            runtimeTargets,
            name: "bench-template-handoff-code",
            goal: "Consume a saved Workbench plan artifact and produce an implementation breakdown.",
          });

          const planTurn = await executeAndCaptureFinalMessage({
            client,
            ctx,
            space: planSpace,
            input: MID_COMPLEX_PLAN_PROMPT,
            mode: "plan",
          });
          const planMarkdown = planTurn.finalMessage.trim() || "No final plan text was returned.";
          const planArtifactPayload = buildWorkbenchPlanArtifactPayload({
            markdown: planMarkdown,
            sourceTemplateId: WORKBENCH_PLAN_TEMPLATE_ID,
            targetTemplateId: WORKBENCH_CODE_TEMPLATE_ID,
            sourceSpaceId: planSpace.id,
            sourceTurnId: planTurn.turnId,
            requiredProvidersUsed: uniqueProviderIds([
              ...planSelection.requiredProvidersUsed,
              ...codeSelection.requiredProvidersUsed,
            ]),
            optionalProvidersUsed: uniqueProviderIds([
              ...planSelection.optionalProvidersUsed,
              ...codeSelection.optionalProvidersUsed,
            ]),
            optionalProvidersOmitted: uniqueProviderIds([
              ...planSelection.optionalProvidersOmitted,
              ...codeSelection.optionalProvidersOmitted,
            ]),
          });
          const planArtifactId = persistWorkbenchPlanArtifact(ctx, {
            spaceId: planSpace.id,
            turnId: planTurn.turnId,
            payload: planArtifactPayload,
          });
          const handoffArtifactId = persistWorkbenchPlanArtifact(ctx, {
            spaceId: codeSpace.id,
            payload: planArtifactPayload,
          });

          const codeTurn = await executeAndCaptureFinalMessage({
            client,
            ctx,
            space: codeSpace,
            input: buildCodeImplementationPrompt(handoffArtifactId, planMarkdown),
            mode: "plan",
          });

          return {
            evidence: [
              ...providerAvailabilityEvidence(availability),
              {
                label: "plan artifact persisted",
                status: "pass",
                detail: {
                  spaceId: planSpace.id,
                  turnId: planTurn.turnId,
                  artifactId: planArtifactId,
                },
              },
              {
                label: "handoff artifact mirrored into code space",
                status: "pass",
                detail: {
                  sourceArtifactId: planArtifactId,
                  handoffArtifactId,
                  codeSpaceId: codeSpace.id,
                },
              },
              {
                label: "code implementation turn consumed saved plan",
                status: "pass",
                detail: {
                  turnId: codeTurn.turnId,
                  finalMessageBytes: codeTurn.finalMessage.length,
                },
              },
            ],
          };
        } finally {
          await client.disconnect();
        }
      },
    },
  ],
};

function assertTemplatePreview(
  preview: { resolved: { templateId: string; initialAgents: WorkbenchTemplateAgent[] } },
  expected: { templateId: string; expectedAgentCount: number; expectedPrimaryProfileId: string },
): void {
  if (preview.resolved.templateId !== expected.templateId) {
    throw new Error(`Expected template ${expected.templateId}, got ${preview.resolved.templateId}`);
  }
  if (preview.resolved.initialAgents.length !== expected.expectedAgentCount) {
    throw new Error(
      `Expected ${expected.expectedAgentCount} agents for ${expected.templateId}, got ${preview.resolved.initialAgents.length}`,
    );
  }
  const primary = preview.resolved.initialAgents.find((agent) => agent.isPrimary);
  const primaryProfileId = profileIdForAgent(primary);
  if (primaryProfileId !== expected.expectedPrimaryProfileId) {
    throw new Error(`Expected primary profile ${expected.expectedPrimaryProfileId}, got ${primaryProfileId ?? "missing"}`);
  }
}

async function makeClient(wsUrl: string, devicePrefix: string): Promise<GatewayClient> {
  const keyPair = await generateAuthKeyPair();
  const client = new GatewayClient({
    url: wsUrl,
    reconnect: false,
    requestTimeoutMs: 20_000,
    deviceId: `${devicePrefix}-${randomUUID().slice(0, 8)}`,
    devicePublicKey: keyPair.publicKeyBase64,
  });
  client.setAuthKeyPair(keyPair);
  await client.connect();

  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    await Bun.sleep(100);
    try {
      await client.ping();
      return client;
    } catch {
      // Wait for authentication to settle.
    }
  }

  throw new Error("Workbench template handoff client auth timeout");
}

interface ProviderAvailability {
  providerId: string;
  model: string;
  required: boolean;
  available: boolean;
  failureReason?: string;
}

async function resolveWorkbenchProviderAvailability(
  ctx: ScenarioContext,
): Promise<ProviderAvailability[]> {
  const factory = new ExecutionAdapterFactory();
  const targets = uniqueProviderTargets();
  const results: ProviderAvailability[] = [];

  for (const target of targets) {
    if (ctx.providerFilters && !ctx.providerFilters.has(target.providerId)) {
      results.push({
        providerId: target.providerId,
        model: target.model,
        required: target.required,
        available: false,
        failureReason: "Provider excluded by workbench provider filter.",
      });
      continue;
    }

    try {
      const runtimeConfig = ctx.gateway.gatewayAdminService.resolveExactProviderRuntimeConfig({
        providerId: target.providerId,
        model: target.model,
      });
      const provider = factory.createModelProvider(runtimeConfig);
      const health = await provider.checkHealth();
      if (!health.available) {
        results.push({
          providerId: target.providerId,
          model: runtimeConfig.model,
          required: target.required,
          available: false,
          failureReason: `${target.providerId} runtime is not reachable or authenticated on this host.`,
        });
        continue;
      }

      if (target.providerId === "lmstudio") {
        const models = await provider.listModels();
        const toolCapableModel = models.find((model) => model.supportsTools);
        if (!toolCapableModel) {
          results.push({
            providerId: target.providerId,
            model: runtimeConfig.model,
            required: target.required,
            available: false,
            failureReason: "No loaded LM Studio models advertise default-mode tool support.",
          });
          continue;
        }
        results.push({
          providerId: target.providerId,
          model: toolCapableModel.id,
          required: target.required,
          available: true,
        });
        continue;
      }

      results.push({
        providerId: target.providerId,
        model: runtimeConfig.model,
        required: target.required,
        available: true,
      });
    } catch (error) {
      results.push({
        providerId: target.providerId,
        model: target.model,
        required: target.required,
        available: false,
        failureReason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return results;
}

function uniqueProviderTargets(): RuntimeTarget[] {
  const seen = new Set<string>();
  const targets: RuntimeTarget[] = [];
  for (const target of Object.values(RUNTIME_TARGET_BY_PROFILE_ID)) {
    if (seen.has(target.providerId)) continue;
    seen.add(target.providerId);
    targets.push(target);
  }
  return targets;
}

async function createRuntimeSpaceFromSelection(input: {
  client: GatewayClient;
  ctx: ScenarioContext;
  templateId: string;
  preview: {
    resolved: {
      templateRevision: number;
      communicationMode: string;
      conversationTopology?: string;
      promptPackId?: string;
      turnModel: string;
      initialAgents: WorkbenchTemplateAgent[];
    };
  };
  selection: WorkbenchLiveAgentSelection;
  runtimeTargets: Map<string, ProviderAvailability>;
  name: string;
  goal: string;
}): Promise<{ id: string; spaceUid: string; name: string }> {
  const initialAgents = [];
  for (const agent of input.selection.agents) {
    const target = runtimeTargetForAgent(agent);
    if (!target) {
      initialAgents.push(agent);
      continue;
    }
    const resolvedTarget = input.runtimeTargets.get(target.providerId);
    const definition = await input.client.createAgentDefinition({
      name: `Workbench ${profileIdForAgent(agent) ?? agent.agentId}`,
      instructions: runtimeInstructionsForAgent(agent, target),
      providerHint: target.providerId,
      modelHint: resolvedTarget?.model ?? target.model,
    });
    initialAgents.push({
      agentId: agent.agentId,
      profileId: definition.agentDefinition.agentDefinitionId,
      role: agent.role as any,
      turnOrder: agent.turnOrder,
      isPrimary: agent.isPrimary,
    });
  }

  const resolved = input.preview.resolved as {
    conversationTopology?: "direct" | "shared_team_chat" | "broadcast_team";
    promptPackId?: string;
    turnModel: string;
  };
  const space = await input.client.createSpace({
    idempotencyKey: `workbench:template-handoff:runtime:${input.templateId}:${randomUUID()}`,
    name: input.name,
    resourceId: `resource:workbench:template-handoff:${input.templateId}:${randomUUID()}`,
    goal: input.goal,
    templateId: input.templateId,
    templateRevision: input.preview.resolved.templateRevision,
    conversationTopology: resolved.conversationTopology,
    promptPackId: resolved.promptPackId,
    turnModel: input.preview.resolved.turnModel,
    capabilities: ["lists"],
    initialAgents,
  });
  input.ctx.registerSpace?.(space.id);

  return {
    id: space.id,
    spaceUid: space.spaceUid ?? space.id,
    name: space.name,
  };
}

async function executeAndCaptureFinalMessage(input: {
  client: GatewayClient;
  ctx: ScenarioContext;
  space: { id: string; spaceUid: string };
  input: string;
  mode: "ask" | "plan" | "execute";
}): Promise<{ turnId: string; finalMessage: string }> {
  await input.client.subscribe([input.space.spaceUid]);
  const events: TurnEventPayload[] = [];
  const unsubscribe = input.client.onTurnEvent((event) => {
    if (event.spaceId === input.space.id || event.spaceUid === input.space.spaceUid) {
      events.push(event);
    }
  });
  try {
    const result = await input.client.executeTurn({
      spaceUid: input.space.spaceUid,
      input: input.input,
      mode: input.mode,
      accessMode: "default",
    });
    if (!result.turnId) {
      throw new Error("executeTurn did not return a turnId");
    }
    input.ctx.registerTurn?.(input.space.id, result.turnId);

    const trace = await waitForTerminalTurnTrace(input.client, input.space.id, result.turnId, events);
    const finalMessage = finalMessageFromEvents(events.filter((event) => event.turnId === result.turnId))
      ?? finalMessageFromTrace(trace)
      ?? result.output
      ?? "";
    if (result.status === "failed" || turnFailed(events, trace, result.turnId)) {
      throw new Error(`Template handoff turn failed: ${turnError(events, trace, result.turnId) ?? result.error ?? "unknown error"}`);
    }
    if (!finalMessage.trim()) {
      throw new Error("Template handoff turn completed without final text.");
    }
    return {
      turnId: result.turnId,
      finalMessage,
    };
  } finally {
    unsubscribe();
  }
}

async function waitForTerminalTurnTrace(
  client: GatewayClient,
  spaceId: string,
  turnId: string,
  events: TurnEventPayload[],
): Promise<SpaceTurnTrace | null> {
  const deadline = Date.now() + TURN_TIMEOUT_MS;
  let trace: SpaceTurnTrace | null = null;
  while (Date.now() < deadline) {
    const turnEvents = events.filter((event) => event.turnId === turnId);
    if (turnEvents.some((event) => {
      const payload = asRecord(event.typedPayload);
      const raw = asRecord(event.data);
      return payload?.kind === "turn.completed"
        || payload?.kind === "turn.failed"
        || raw?.type === "turn_completed"
        || raw?.type === "error";
    })) {
      return trace;
    }

    try {
      trace = await client.getTurnTrace({ spaceId, turnId });
      if (trace.events.some((event) => event.eventType === "turn_completed" || event.eventType === "error" || event.eventType === "turn_failed")) {
        return trace;
      }
    } catch {
      // Trace may not be available until the turn has started.
    }

    await Bun.sleep(250);
  }

  throw new Error("Timed out waiting for template handoff turn completion.");
}

function persistWorkbenchPlanArtifact(
  ctx: ScenarioContext,
  input: {
    spaceId: string;
    turnId?: string;
    payload: ReturnType<typeof buildWorkbenchPlanArtifactPayload>;
  },
): string {
  if (!ctx.gateway.db) {
    throw new Error("Gateway database unavailable");
  }
  const spaces = new SpaceRepository(ctx.gateway.db.db);
  const artifacts = new ArtifactRepository(ctx.gateway.db.db);
  const space = spaces.getById(input.spaceId);
  if (!space) {
    throw new Error(`Space not found for artifact persistence: ${input.spaceId}`);
  }

  const artifactId = `artifact-${randomUUID()}`;
  artifacts.create({
    artifactId,
    spaceId: input.spaceId,
    resourceId: space.resource_id,
    turnId: input.turnId,
    type: input.payload.type,
    title: input.payload.title,
    mimeType: input.payload.mimeType,
    contentJson: input.payload.contentJson,
    tagsJson: input.payload.tagsJson,
    visibility: input.payload.visibility,
  });
  return artifactId;
}

function buildCodeImplementationPrompt(handoffArtifactId: string, planMarkdown: string): string {
  return [
    `Use saved plan artifact ${handoffArtifactId} as the source of truth.`,
    "Produce a code implementation breakdown for the plan. Do not modify files or request shell access.",
    "Include file areas, implementation steps, test coverage, verification commands, and residual risks.",
    "",
    "Saved plan:",
    planMarkdown,
  ].join("\n");
}

function runtimeInstructionsForAgent(agent: WorkbenchTemplateAgent, target: RuntimeTarget): string {
  return [
    "You are a Workbench template-handoff evaluation agent.",
    `Template agent: ${agent.agentId}.`,
    `Role focus: ${target.roleFocus}.`,
    "Do not use shell, filesystem, web, or MCP tools unless explicitly instructed.",
    "Work only from the prompt and produce concise textual analysis.",
  ].join("\n");
}

function providerAvailabilityEvidence(availability: ProviderAvailability[]) {
  return availability.map((entry) => ({
    label: `${entry.required ? "required" : "optional"} provider ${entry.providerId}`,
    status: entry.available ? "pass" as const : entry.required ? "fail" as const : "skip" as const,
    detail: {
      model: entry.model,
      ...(entry.failureReason ? { failureReason: entry.failureReason } : {}),
    },
  }));
}

function runtimeTargetForAgent(agent: WorkbenchTemplateAgent | undefined): RuntimeTarget | undefined {
  const profileId = profileIdForAgent(agent);
  return profileId ? RUNTIME_TARGET_BY_PROFILE_ID[profileId] : undefined;
}

function profileIdForAgent(agent: WorkbenchTemplateAgent | undefined): string | undefined {
  return agent?.profileId ?? agent?.agentDefinitionId;
}

function pushUnique(target: string[], value: string): void {
  if (!target.includes(value)) {
    target.push(value);
  }
}

function uniqueProviderIds(values: string[]): string[] {
  const result: string[] = [];
  for (const value of values) {
    pushUnique(result, value);
  }
  return result;
}

function finalMessageFromEvents(events: TurnEventPayload[]): string | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    const payload = asRecord(event?.typedPayload);
    if (payload?.kind === "turn.completed" && typeof payload.finalMessage === "string") {
      return payload.finalMessage;
    }

    const raw = asRecord(event?.data);
    if (raw?.type !== "turn_completed") continue;
    const result = asRecord(raw.result);
    const finalMessage = asRecord(result?.finalMessage);
    if (typeof finalMessage?.content === "string") {
      return finalMessage.content;
    }
    if (typeof raw.finalMessage === "string") {
      return raw.finalMessage;
    }
  }
  return null;
}

function finalMessageFromTrace(trace: SpaceTurnTrace | null): string | null {
  if (!trace) return null;
  for (let index = trace.events.length - 1; index >= 0; index -= 1) {
    const event = trace.events[index];
    if (event?.eventType !== "turn_completed") continue;
    const payload = asRecord(event.payload);
    const result = asRecord(payload?.result);
    const finalMessage = asRecord(result?.finalMessage);
    if (typeof finalMessage?.content === "string") {
      return finalMessage.content;
    }
    if (typeof payload?.finalMessage === "string") {
      return payload.finalMessage;
    }
  }
  return null;
}

function turnFailed(events: TurnEventPayload[], trace: SpaceTurnTrace | null, turnId: string): boolean {
  return events.some((event) => {
    if (event.turnId !== turnId) return false;
    const payload = asRecord(event.typedPayload);
    const raw = asRecord(event.data);
    return payload?.kind === "turn.failed" || raw?.type === "error";
  }) || (trace?.events.some((event) => event.eventType === "error" || event.eventType === "turn_failed") ?? false);
}

function turnError(events: TurnEventPayload[], trace: SpaceTurnTrace | null, turnId: string): string | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.turnId !== turnId) continue;
    const payload = asRecord(event.typedPayload);
    if (typeof payload?.errorMessage === "string") {
      return payload.errorMessage;
    }
    const raw = asRecord(event.data);
    const error = asRecord(raw?.error);
    if (typeof error?.message === "string") {
      return error.message;
    }
    if (typeof raw?.message === "string") {
      return raw.message;
    }
  }
  for (let index = (trace?.events.length ?? 0) - 1; index >= 0; index -= 1) {
    const payload = asRecord(trace?.events[index]?.payload);
    const error = asRecord(payload?.error);
    if (typeof error?.message === "string") {
      return error.message;
    }
    if (typeof payload?.message === "string") {
      return payload.message;
    }
  }
  return undefined;
}

function asRecord(value: unknown): Record<string, any> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, any>
    : null;
}
