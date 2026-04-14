import { randomUUID } from "node:crypto";
import {
  GatewayClient,
  generateAuthKeyPair,
  type SpaceTurnTrace,
  type TurnEventPayload,
} from "../client.js";
import { ExecutionAdapterFactory } from "../../packages/bootstrap/src/execution/execution-adapter-factory.js";
import type { ProviderParityRow } from "../report.js";
import { skipScenario, type Layer, type ScenarioContext, type ScenarioOutcome } from "./index.js";

type SupportedParityProviderId = "apple" | "lmstudio" | "claude" | "codex" | "codex-app-server" | "gemini";

interface ProviderTarget {
  provider: SupportedParityProviderId;
  model: string;
  transport: ProviderParityRow["transport"];
}

export const SUPPORTED_PROVIDERS: SupportedParityProviderId[] = [
  "apple",
  "lmstudio",
  "claude",
  "codex",
  "codex-app-server",
  "gemini",
];

const CANONICAL_LIVE_MODELS: Record<Exclude<SupportedParityProviderId, "lmstudio" | "codex-app-server">, string> = {
  apple: "apple/apple-on-device",
  claude: "claude/sonnet",
  codex: "codex/gpt-5.1-codex",
  gemini: "gemini/gemini-2.5-flash",
};

const PROVIDER_TRANSPORT: Record<SupportedParityProviderId, ProviderParityRow["transport"]> = {
  apple: "native",
  lmstudio: "native",
  claude: "bridge",
  codex: "bridge",
  "codex-app-server": "mediated",
  gemini: "mediated_fallback",
};

const EXPECTED_PARITY_TOOL_NAME = "lists.echo";

export const providerToolParityLayer: Layer = {
  name: "provider-tool-parity",
  scenarios: [
    {
      name: "default-access-gateway-tools",
      run: async (ctx: ScenarioContext) => {
        const rows = await runProviderParityAudit(ctx);
        const failingRows = rows.filter((row) => row.status === "fail");
        if (failingRows.length > 0) {
          throw new Error(`Provider parity failures: ${failingRows.map((row) => `${row.provider}/${row.model}`).join(", ")}`);
        }

        const filteredProviders = ctx.providerFilters ? Array.from(ctx.providerFilters) : [];
        if (filteredProviders.length === 1) {
          const liveRows = rows.filter((row) => row.scope === "live" && row.provider === filteredProviders[0]);
          if (liveRows.length > 0 && liveRows.every((row) => row.status === "unavailable")) {
            throw new Error(`Provider ${filteredProviders[0]} is unavailable on this host.`);
          }
        }
      },
    },
    {
      name: "codex-app-server-explicit-runtime-selection",
      run: async (ctx: ScenarioContext) => await runCodexAppServerRuntimeSmoke(ctx),
    },
  ],
};

async function runProviderParityAudit(ctx: ScenarioContext): Promise<ProviderParityRow[]> {
  const executionFactory = new ExecutionAdapterFactory();
  const rows: ProviderParityRow[] = [];
  const pushRow = (row: ProviderParityRow): void => {
    rows.push(row);
    ctx.providerParityRows.push(row);
    ctx.recordProviderParityRow?.(row);
  };

  for (const provider of SUPPORTED_PROVIDERS) {
    if (ctx.providerFilters && !ctx.providerFilters.has(provider)) {
      continue;
    }

    if (provider === "apple") {
      const runtimeConfig = resolveExactParityRuntimeConfig(ctx, provider, CANONICAL_LIVE_MODELS.apple);
      const targetModel = runtimeConfig.model;
      const health = await checkProviderAvailability(executionFactory, runtimeConfig);
      if (!health.available) {
        pushRow(makeUnavailableRow({
          scope: "live",
          provider,
          model: targetModel,
          failureReason: health.failureReason,
        }));
        continue;
      }
      pushRow(await runLiveParityTurn(ctx, { provider, model: targetModel, transport: PROVIDER_TRANSPORT[provider] }));
      continue;
    }

    if (provider === "lmstudio") {
      const runtimeConfig = resolveExactParityRuntimeConfig(ctx, provider);
      const providerModel = runtimeConfig.model;
      const health = await checkProviderAvailability(executionFactory, runtimeConfig);
      if (!health.available) {
        pushRow(makeUnavailableRow({
          scope: "metadata",
          provider,
          model: providerModel,
          failureReason: health.failureReason,
        }));
        pushRow(makeUnavailableRow({
          scope: "live",
          provider,
          model: providerModel,
          failureReason: health.failureReason,
        }));
        continue;
      }

      const modelProvider = executionFactory.createModelProvider({
        providerId: runtimeConfig.providerId,
        model: runtimeConfig.model,
        apiKey: runtimeConfig.apiKey,
        authMode: runtimeConfig.authMode,
        baseURL: runtimeConfig.baseURL,
        isLocal: runtimeConfig.isLocal,
      });
      const models = await modelProvider.listModels();
      const liveTargets: ProviderTarget[] = [];

      for (const model of models) {
        if (model.supportsTools) {
          pushRow({
            scope: "metadata",
            provider,
            model: model.id,
            transport: PROVIDER_TRANSPORT[provider],
            status: "pass",
          });
          liveTargets.push({
            provider,
            model: model.id,
            transport: PROVIDER_TRANSPORT[provider],
          });
        } else {
          pushRow({
            scope: "metadata",
            provider,
            model: model.id,
            transport: PROVIDER_TRANSPORT[provider],
            status: "unavailable",
            failureReason: "Loaded LM Studio model is not trained for tool use.",
          });
        }
      }

      if (liveTargets.length === 0) {
        pushRow(makeUnavailableRow({
          scope: "live",
          provider,
          model: providerModel,
          failureReason: "No loaded LM Studio models advertise default-mode tool support.",
        }));
      } else {
        try {
          ctx.gateway.gatewayAdminService.setProviderConfig({
            providerId: provider,
            model: liveTargets[0].model,
            baseURL: runtimeConfig.baseURL,
            allowedModels: liveTargets.map((target) => target.model),
            allowCustomModel: true,
          });
        } catch (error) {
          const failureReason = describeUnknownError(error);
          for (const target of liveTargets) {
            pushRow(makeUnavailableRow({
              scope: "live",
              provider,
              model: target.model,
              failureReason,
            }));
          }
          continue;
        }
        for (const target of liveTargets) {
          pushRow(await runLiveParityTurn(ctx, target));
        }
      }
      continue;
    }

    const runtimeConfig = provider === "codex-app-server"
      ? resolveExactParityRuntimeConfig(ctx, provider)
      : resolveExactParityRuntimeConfig(ctx, provider, CANONICAL_LIVE_MODELS[provider]);
    const targetModel = runtimeConfig.model;
    const health = await checkProviderAvailability(executionFactory, runtimeConfig);
    const modelProvider = executionFactory.createModelProvider({
      providerId: runtimeConfig.providerId,
      model: runtimeConfig.model,
      apiKey: runtimeConfig.apiKey,
      authMode: runtimeConfig.authMode,
      baseURL: runtimeConfig.baseURL,
      isLocal: runtimeConfig.isLocal,
    });
    const models = await modelProvider.listModels();

    for (const model of models) {
      pushRow({
        scope: "metadata",
        provider,
        model: model.id,
        transport: PROVIDER_TRANSPORT[provider],
        status: !health.available
          ? "unavailable"
          : model.supportsTools
            ? "pass"
            : "fail",
        ...(!health.available
          ? { failureReason: health.failureReason }
          : !model.supportsTools
            ? { failureReason: "Model does not report default-mode gateway tool support." }
            : {}),
      });
    }

    if (!health.available) {
      pushRow(makeUnavailableRow({
        scope: "live",
        provider,
        model: targetModel,
        failureReason: health.failureReason,
      }));
      continue;
    }

    pushRow(await runLiveParityTurn(ctx, {
      provider,
      model: targetModel,
      transport: PROVIDER_TRANSPORT[provider],
    }));
  }

  return rows;
}

async function checkProviderAvailability(
  factory: ExecutionAdapterFactory,
  runtimeConfig: {
    providerId: string;
    model: string;
    apiKey?: string;
    authMode?: "api_key" | "host_login";
    baseURL?: string;
    isLocal: boolean;
  },
): Promise<{ available: boolean; failureReason?: string }> {
  try {
    const modelProvider = factory.createModelProvider({
      providerId: runtimeConfig.providerId,
      model: runtimeConfig.model,
      apiKey: runtimeConfig.apiKey,
      authMode: runtimeConfig.authMode,
      baseURL: runtimeConfig.baseURL,
      isLocal: runtimeConfig.isLocal,
    });
    const health = await modelProvider.checkHealth();
    if (health.available) {
      return { available: true };
    }
    return {
      available: false,
      failureReason: `${runtimeConfig.providerId} runtime is not reachable or authenticated on this host.`,
    };
  } catch (error) {
    return {
      available: false,
      failureReason: error instanceof Error ? error.message : String(error),
    };
  }
}

async function runLiveParityTurn(
  ctx: ScenarioContext,
  target: ProviderTarget,
): Promise<ProviderParityRow> {
  const maxAttempts = maxLiveParityAttempts(target);
  let lastResult: ProviderParityRow | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const result = await runLiveParityTurnAttempt(ctx, target);
    if (result.status !== "fail") {
      return result;
    }

    lastResult = result;
    if (!shouldRetryLiveParityFailure({
      provider: target.provider,
      transport: target.transport,
      failureReason: result.failureReason,
      attempt,
      maxAttempts,
    })) {
      return result;
    }
  }

  return lastResult ?? {
    scope: "live",
    provider: target.provider,
    model: target.model,
    transport: target.transport,
    status: "fail",
    failureReason: "Live provider parity run failed without a recorded result.",
  };
}

async function runLiveParityTurnAttempt(
  ctx: ScenarioContext,
  target: ProviderTarget,
): Promise<ProviderParityRow> {
  const client = await makeClient(ctx.wsUrl, `bench-parity-${target.provider}`);
  const agentId = `bench-${target.provider}-${randomUUID().slice(0, 8)}`;
  const marker = `${target.provider}-${randomUUID().slice(0, 8)}`;
  const timeoutMs = liveParityTimeoutMs(target.transport);

  try {
    const definition = await client.createAgentDefinition({
      name: `Parity ${target.provider}`,
      instructions: "You are a workbench parity agent. Follow the tool instruction exactly and answer concisely.",
      providerHint: target.provider,
      modelHint: target.model,
    });

    const space = await client.createSpace({
      idempotencyKey: `workbench:provider-tool-parity:${target.provider}:${randomUUID()}`,
      name: `bench-parity-${target.provider}-${randomUUID().slice(0, 6)}`,
      resourceId: `resource:workbench:parity:${target.provider}:${randomUUID().slice(0, 6)}`,
      goal: `Gateway tool parity check for ${target.provider}`,
      capabilities: ["lists"],
      initialAgents: [{
        agentId,
        profileId: definition.agentDefinition.agentDefinitionId,
        role: "participant" as const,
        isPrimary: true,
      }],
    });
    ctx.registerSpace?.(space.id);

    const spaceUid = space.spaceUid ?? space.id;
    await client.subscribe([spaceUid]);
    const events: TurnEventPayload[] = [];
    const unsubscribe = client.onTurnEvent((event) => {
      if (event.spaceId === space.id || event.spaceUid === spaceUid) {
        events.push(event);
      }
    });

    try {
      const turnResult = await client.executeTurn({
        spaceUid,
        input: buildParityPrompt(marker),
        accessMode: "default",
      });
      ctx.registerTurn?.(space.id, turnResult.turnId);
      const terminalEvent = await waitForTerminalTurnEvent(events, turnResult.turnId, timeoutMs);
      const trace = await waitForTerminalTurnTrace(client, space.id, turnResult.turnId, timeoutMs);

      const turnEvents = events.filter((event) => event.turnId === turnResult.turnId);
      const observedToolCall = firstToolStarted(turnEvents) ?? firstToolStartedFromTrace(trace);
      const observedToolResult = firstToolCompleted(turnEvents) ?? firstToolCompletedFromTrace(trace);
      const finalAnswer = finalMessageFromEvents(turnEvents) ?? finalMessageFromTrace(trace) ?? turnResult.output ?? "";
      const observedRuntime = extractObservedRuntimeSelection({
        turnEvents,
        trace,
      });
      const sawTurnFailure = turnEvents.some((event) => asRecord(event.typedPayload)?.kind === "turn.failed")
        || traceHasFailure(trace);
      const sawTurnCompletion = turnEvents.some((event) => asRecord(event.typedPayload)?.kind === "turn.completed")
        || traceHasCompletion(trace);
      const sawRateLimitedEvent = hasRateLimitedEvidence(turnEvents, trace);

      if (sawTurnFailure) {
        const failureReason = resolveTurnFailureReason(turnEvents, trace, turnResult.error);
        return {
          scope: "live",
          provider: target.provider,
          model: target.model,
          transport: target.transport,
          status: classifyLiveParityFailureStatus({
            provider: target.provider,
            transport: target.transport,
            failureReason,
            sawRateLimitedEvent,
          }),
          observedToolCall: observedToolCall?.summary,
          observedToolResult: observedToolResult?.result,
          ...toObservedRuntimeFields(observedRuntime),
          failureReason,
        };
      }

      if (!sawTurnCompletion && !finalAnswer.trim()) {
        const failureReason = terminalEvent
          ? "Turn ended without a final answer or completion event."
          : "Timed out waiting for the turn to reach a terminal event.";
        return {
          scope: "live",
          provider: target.provider,
          model: target.model,
          transport: target.transport,
          status: classifyLiveParityFailureStatus({
            provider: target.provider,
            transport: target.transport,
            failureReason,
            sawRateLimitedEvent,
          }),
          observedToolCall: observedToolCall?.summary,
          observedToolResult: observedToolResult?.result,
          ...toObservedRuntimeFields(observedRuntime),
          failureReason,
        };
      }

      const validation = validateLiveParityObservation({
        transport: target.transport,
        observedToolCallName: observedToolCall?.name,
        observedToolResultPresent: Boolean(observedToolResult),
        finalAnswer,
        marker,
      });

      if (!validation.ok) {
        return {
          scope: "live",
          provider: target.provider,
          model: target.model,
          transport: target.transport,
          status: "fail",
          ...(observedToolCall ? { observedToolCall: observedToolCall.summary } : {}),
          ...(observedToolResult ? { observedToolResult: observedToolResult.result } : {}),
          ...toObservedRuntimeFields(observedRuntime),
          failureReason: validation.failureReason,
        };
      }

      const runtimeValidation = validateObservedRuntimeSelection({
        requestedProviderId: target.provider,
        requestedModelId: target.model,
        observedProviderId: observedRuntime.providerId,
        observedModelId: observedRuntime.modelId,
        requireObservedRuntime: target.provider === "codex-app-server",
      });
      if (!runtimeValidation.ok) {
        return {
          scope: "live",
          provider: target.provider,
          model: target.model,
          transport: target.transport,
          status: "fail",
          ...(observedToolCall ? { observedToolCall: observedToolCall.summary } : {}),
          ...(observedToolResult ? { observedToolResult: observedToolResult.result } : {}),
          ...toObservedRuntimeFields(observedRuntime),
          failureReason: runtimeValidation.failureReason,
        };
      }

      return {
        scope: "live",
        provider: target.provider,
        model: target.model,
        transport: target.transport,
        status: "pass",
        observedToolCall: observedToolCall.summary,
        ...(observedToolResult ? { observedToolResult: observedToolResult.result } : {}),
        ...toObservedRuntimeFields(observedRuntime),
      };
    } finally {
      unsubscribe();
    }
  } catch (error) {
    const failureReason = error instanceof Error ? error.message : String(error);
    return {
      scope: "live",
      provider: target.provider,
      model: target.model,
      transport: target.transport,
      status: classifyLiveParityFailureStatus({
        provider: target.provider,
        transport: target.transport,
        failureReason,
        sawRateLimitedEvent: false,
      }),
      failureReason,
    };
  } finally {
    await client.disconnect();
  }
}

async function runCodexAppServerRuntimeSmoke(ctx: ScenarioContext): Promise<ScenarioOutcome | void> {
  if (ctx.providerFilters && !ctx.providerFilters.has("codex-app-server")) {
    return;
  }

  const executionFactory = new ExecutionAdapterFactory();
  const runtimeConfig = resolveExactParityRuntimeConfig(ctx, "codex-app-server");
  const health = await checkProviderAvailability(executionFactory, runtimeConfig);
  if (!health.available) {
    skipScenario(
      "Codex App Server is unavailable on this host.",
      health.failureReason ? [{ label: "reason", detail: health.failureReason }] : undefined,
    );
  }

  const result = await runCodexAppServerSmokeTurn(ctx, {
    provider: "codex-app-server",
    model: runtimeConfig.model,
    transport: PROVIDER_TRANSPORT["codex-app-server"],
  });
  if (result.status !== "pass") {
    throw new Error(result.failureReason ?? "Codex App Server runtime-selection smoke failed.");
  }

  return {
    evidence: [
      { label: "requested_runtime", status: "pass", detail: `${result.provider}/${result.model}` },
      ...(result.observedModelId
        ? [{ label: "observed_runtime", status: "pass" as const, detail: result.observedModelId }]
        : []),
    ],
  };
}

async function runCodexAppServerSmokeTurn(
  ctx: ScenarioContext,
  target: ProviderTarget,
): Promise<ProviderParityRow> {
  const client = await makeClient(ctx.wsUrl, "bench-codex-app-server-smoke");
  const agentId = `bench-codex-app-server-${randomUUID().slice(0, 8)}`;
  const marker = `codex-app-server-${randomUUID().slice(0, 8)}`;
  const timeoutMs = liveParityTimeoutMs(target.transport);

  try {
    const definition = await client.createAgentDefinition({
      name: "Codex App Server Smoke",
      instructions: "You are a workbench smoke-test agent. Answer concisely and do not call any tools unless asked.",
      providerHint: target.provider,
      modelHint: target.model,
    });

    const space = await client.createSpace({
      idempotencyKey: `workbench:codex-app-server-smoke:${randomUUID()}`,
      name: `bench-codex-app-server-smoke-${randomUUID().slice(0, 6)}`,
      resourceId: `resource:workbench:codex-app-server-smoke:${randomUUID().slice(0, 6)}`,
      goal: "Codex App Server runtime selection smoke",
      capabilities: ["lists"],
      initialAgents: [{
        agentId,
        profileId: definition.agentDefinition.agentDefinitionId,
        role: "participant" as const,
        isPrimary: true,
      }],
    });
    ctx.registerSpace?.(space.id);

    const spaceUid = space.spaceUid ?? space.id;
    await client.subscribe([spaceUid]);
    const events: TurnEventPayload[] = [];
    const unsubscribe = client.onTurnEvent((event) => {
      if (event.spaceId === space.id || event.spaceUid === spaceUid) {
        events.push(event);
      }
    });

    try {
      const turnResult = await client.executeTurn({
        spaceUid,
        input: `Reply with exactly: CODEX_APP_SERVER_SMOKE_OK ${marker}`,
        accessMode: "default",
      });
      ctx.registerTurn?.(space.id, turnResult.turnId);
      const terminalEvent = await waitForTerminalTurnEvent(events, turnResult.turnId, timeoutMs);
      const trace = await waitForTerminalTurnTrace(client, space.id, turnResult.turnId, timeoutMs);
      const turnEvents = events.filter((event) => event.turnId === turnResult.turnId);
      const finalAnswer = finalMessageFromEvents(turnEvents) ?? finalMessageFromTrace(trace) ?? turnResult.output ?? "";
      const observedRuntime = extractObservedRuntimeSelection({
        turnEvents,
        trace,
      });
      const sawTurnFailure = turnEvents.some((event) => asRecord(event.typedPayload)?.kind === "turn.failed")
        || traceHasFailure(trace);
      const sawTurnCompletion = turnEvents.some((event) => asRecord(event.typedPayload)?.kind === "turn.completed")
        || traceHasCompletion(trace);

      if (sawTurnFailure) {
        return {
          scope: "live",
          provider: target.provider,
          model: target.model,
          transport: target.transport,
          status: "fail",
          ...toObservedRuntimeFields(observedRuntime),
          failureReason: resolveTurnFailureReason(turnEvents, trace, turnResult.error),
        };
      }

      if (!sawTurnCompletion && !finalAnswer.trim()) {
        return {
          scope: "live",
          provider: target.provider,
          model: target.model,
          transport: target.transport,
          status: "fail",
          ...toObservedRuntimeFields(observedRuntime),
          failureReason: terminalEvent
            ? "Turn ended without a final answer or completion event."
            : "Timed out waiting for the turn to reach a terminal event.",
        };
      }

      if (!finalAnswer.includes(marker)) {
        return {
          scope: "live",
          provider: target.provider,
          model: target.model,
          transport: target.transport,
          status: "fail",
          ...toObservedRuntimeFields(observedRuntime),
          failureReason: `Final answer did not include marker ${marker}.`,
        };
      }

      const runtimeValidation = validateObservedRuntimeSelection({
        requestedProviderId: target.provider,
        requestedModelId: target.model,
        observedProviderId: observedRuntime.providerId,
        observedModelId: observedRuntime.modelId,
        requireObservedRuntime: true,
      });
      if (!runtimeValidation.ok) {
        return {
          scope: "live",
          provider: target.provider,
          model: target.model,
          transport: target.transport,
          status: "fail",
          ...toObservedRuntimeFields(observedRuntime),
          failureReason: runtimeValidation.failureReason,
        };
      }

      return {
        scope: "live",
        provider: target.provider,
        model: target.model,
        transport: target.transport,
        status: "pass",
        ...toObservedRuntimeFields(observedRuntime),
      };
    } finally {
      unsubscribe();
    }
  } catch (error) {
    return {
      scope: "live",
      provider: target.provider,
      model: target.model,
      transport: target.transport,
      status: "fail",
      failureReason: describeUnknownError(error),
    };
  } finally {
    await client.disconnect();
  }
}

function firstToolStarted(events: TurnEventPayload[]): { name: string; summary: string } | null {
  for (const event of events) {
    const payload = asRecord(event.typedPayload);
    const raw = asRecord(event.data);
    const isTypedToolStart = payload?.kind === "tool.started";
    const isRawToolStart = raw?.type === "tool_call_start";
    if (!isTypedToolStart && !isRawToolStart) continue;
    const rawToolCall = asRecord(raw?.toolCall);
    const rawToolName = typeof rawToolCall?.name === "string" ? rawToolCall.name.trim() : "";
    const typedToolName = typeof payload?.toolName === "string" ? payload.toolName.trim() : "";
    const toolName = rawToolName && rawToolName !== "unknown"
      ? rawToolName
      : typedToolName && typedToolName !== "unknown"
        ? typedToolName
        : "";
    if (!toolName) continue;
    const args = isTypedToolStart
      ? asRecord(payload?.arguments)
      : asRecord(rawToolCall?.arguments);
    return {
      name: toolName,
      summary: `${toolName}(${args ? JSON.stringify(args) : "{}"})`,
    };
  }
  return null;
}

function firstToolCompleted(events: TurnEventPayload[]): { result: unknown } | null {
  for (const event of events) {
    const payload = asRecord(event.typedPayload);
    const raw = asRecord(event.data);
    if (payload?.kind === "tool.completed") {
      return { result: payload.result };
    }
    if (raw?.type === "tool_result") {
      return { result: raw.result };
    }
  }
  return null;
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

function turnErrorMessage(events: TurnEventPayload[]): string | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    const payload = asRecord(event?.typedPayload);
    if (payload?.kind === "turn.failed" && typeof payload.errorMessage === "string") {
      return payload.errorMessage;
    }

    const raw = asRecord(event?.data);
    if (raw?.type === "error") {
      const error = asRecord(raw.error);
      if (typeof error?.message === "string") {
        return error.message;
      }
      if (typeof raw.message === "string") {
        return raw.message;
      }
    }
  }
  return null;
}

function resolveTurnFailureReason(
  events: TurnEventPayload[],
  trace: SpaceTurnTrace | null,
  fallback?: string,
): string {
  const eventMessage = turnErrorMessage(events);
  const traceMessage = turnErrorMessageFromTrace(trace);
  if (!isGenericTurnFailureReason(traceMessage)) {
    return traceMessage!;
  }
  if (!isGenericTurnFailureReason(eventMessage)) {
    return eventMessage!;
  }
  if (!isGenericTurnFailureReason(fallback)) {
    return fallback!;
  }
  return traceMessage ?? eventMessage ?? fallback ?? "Turn failed before completion.";
}

function isGenericTurnFailureReason(message: string | null | undefined): boolean {
  const normalized = message?.trim().toLowerCase();
  if (!normalized) {
    return true;
  }
  return normalized === "unknown error"
    || normalized === "turn failed before completion.";
}

function describeUnknownError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function buildParityPrompt(marker: string): string {
  return [
    "Use the gateway tool named `lists.echo` exactly once.",
    `Call it with {"message":"${marker}"}.`,
    `After the tool result arrives, answer with exactly: PARITY_OK ${marker}`,
  ].join(" ");
}

function resolveExactParityRuntimeConfig(
  ctx: ScenarioContext,
  providerId: SupportedParityProviderId,
  model?: string,
) {
  return ctx.gateway.gatewayAdminService.resolveExactProviderRuntimeConfig({
    providerId,
    ...(model ? { model } : {}),
  });
}

export function normalizeProviderParityToolName(name: string | null | undefined): string | null {
  const trimmed = typeof name === "string" ? name.trim() : "";
  if (!trimmed) return null;
  if (trimmed === EXPECTED_PARITY_TOOL_NAME) {
    return EXPECTED_PARITY_TOOL_NAME;
  }
  const mcpMatch = /^mcp__.+?__(.+)$/.exec(trimmed);
  if (!mcpMatch) {
    return trimmed;
  }
  return mcpMatch[1].replace(/_/g, ".");
}

export function validateLiveParityObservation(input: {
  transport: ProviderParityRow["transport"];
  observedToolCallName?: string | null;
  observedToolResultPresent: boolean;
  finalAnswer: string;
  marker: string;
}): { ok: true } | { ok: false; failureReason: string } {
  if (normalizeProviderParityToolName(input.observedToolCallName) !== EXPECTED_PARITY_TOOL_NAME) {
    return {
      ok: false,
      failureReason: `Expected a ${EXPECTED_PARITY_TOOL_NAME} tool call during the turn.`,
    };
  }

  if (input.transport !== "bridge" && !input.observedToolResultPresent) {
    return {
      ok: false,
      failureReason: "Expected a tool result event for the echoed marker.",
    };
  }

  if (!input.finalAnswer.includes(input.marker)) {
    return {
      ok: false,
      failureReason: `Final answer did not include marker ${input.marker}.`,
    };
  }

  return { ok: true };
}

export function extractObservedRuntimeSelection(input: {
  turnEvents: TurnEventPayload[];
  trace: SpaceTurnTrace | null;
}): { providerId?: string; modelId?: string } {
  const eventSelection = extractCompletedEventRuntimeSelection(input.turnEvents);
  if (eventSelection.providerId || eventSelection.modelId) {
    return eventSelection;
  }
  return extractTraceRuntimeSelection(input.trace);
}

export function validateObservedRuntimeSelection(input: {
  requestedProviderId: string;
  requestedModelId: string;
  observedProviderId?: string;
  observedModelId?: string;
  requireObservedRuntime?: boolean;
}): { ok: true } | { ok: false; failureReason: string } {
  const requestedRuntime = formatRuntimeSelection(input.requestedProviderId, input.requestedModelId);
  const observedProviderId = normalizeObservedProviderId(input.observedProviderId)
    ?? deriveProviderIdFromModelId(input.observedModelId);
  const observedModelId = normalizeObservedModelId(observedProviderId, input.observedModelId);

  if (input.requireObservedRuntime && (!observedProviderId || !observedModelId)) {
    return {
      ok: false,
      failureReason: "Turn completed without provider/model execution metadata.",
    };
  }

  if (!observedProviderId && !observedModelId) {
    return { ok: true };
  }

  const normalizedRequestedModelId = normalizeObservedModelId(input.requestedProviderId, input.requestedModelId)
    ?? input.requestedModelId.trim();
  if (observedProviderId && observedProviderId !== input.requestedProviderId) {
    return {
      ok: false,
      failureReason: `Observed runtime ${formatRuntimeSelection(observedProviderId, observedModelId)} did not match requested ${requestedRuntime}.`,
    };
  }

  if (observedModelId && observedModelId !== normalizedRequestedModelId) {
    return {
      ok: false,
      failureReason: `Observed runtime ${formatRuntimeSelection(observedProviderId ?? input.requestedProviderId, observedModelId)} did not match requested ${requestedRuntime}.`,
    };
  }

  return { ok: true };
}

export function liveParityTimeoutMs(transport: ProviderParityRow["transport"]): number {
  return transport === "bridge" || transport === "mediated" || transport === "mediated_fallback" ? 45_000 : 20_000;
}

export function shouldRetryLiveParityFailure(input: {
  provider: SupportedParityProviderId;
  transport: ProviderParityRow["transport"];
  failureReason?: string;
  attempt: number;
  maxAttempts: number;
}): boolean {
  if (input.attempt >= input.maxAttempts) {
    return false;
  }

  const isTransientParityFailure = input.failureReason === "Timed out waiting for the turn to reach a terminal event."
    || input.failureReason === `Expected a ${EXPECTED_PARITY_TOOL_NAME} tool call during the turn.`;
  if (!isTransientParityFailure) {
    return false;
  }

  return input.transport === "bridge"
    || (input.provider === "apple" && input.transport === "native");
}

export function classifyLiveParityFailureStatus(input: {
  provider: SupportedParityProviderId;
  transport: ProviderParityRow["transport"];
  failureReason?: string;
  sawRateLimitedEvent: boolean;
}): ProviderParityRow["status"] {
  if (input.provider !== "gemini" || input.transport !== "mediated_fallback") {
    return "fail";
  }

  if (input.sawRateLimitedEvent || isGeminiTransientHostLimitMessage(input.failureReason)) {
    return "unavailable";
  }

  return "fail";
}

function makeUnavailableRow(input: {
  scope: ProviderParityRow["scope"];
  provider: SupportedParityProviderId;
  model: string;
  failureReason?: string;
}): ProviderParityRow {
  return {
    scope: input.scope,
    provider: input.provider,
    model: input.model,
    transport: PROVIDER_TRANSPORT[input.provider],
    status: "unavailable",
    ...(input.failureReason ? { failureReason: input.failureReason } : {}),
  };
}

function maxLiveParityAttempts(target: ProviderTarget): number {
  if (target.transport === "bridge") {
    return 2;
  }
  if (target.provider === "apple" && target.transport === "native") {
    return 2;
  }
  return 1;
}

function toObservedRuntimeFields(input: {
  providerId?: string;
  modelId?: string;
}): Partial<Pick<ProviderParityRow, "observedProviderId" | "observedModelId">> {
  return {
    ...(input.providerId ? { observedProviderId: input.providerId } : {}),
    ...(input.modelId ? { observedModelId: input.modelId } : {}),
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function extractCompletedEventRuntimeSelection(
  events: TurnEventPayload[],
): { providerId?: string; modelId?: string } {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    const typedPayload = asRecord(event?.typedPayload);
    if (typedPayload?.kind === "turn.completed") {
      const metadata = asRecord(typedPayload.metadata);
      const providerId = normalizeObservedProviderId(metadata?.providerId);
      const modelId = normalizeObservedModelId(providerId, metadata?.modelId);
      if (providerId || modelId) {
        return { providerId, modelId };
      }
    }

    const raw = asRecord(event?.data);
    if (raw?.type !== "turn_completed") continue;
    const result = asRecord(raw.result);
    const metadata = asRecord(result?.metadata) ?? asRecord(raw.metadata);
    const providerId = normalizeObservedProviderId(metadata?.providerId);
    const modelId = normalizeObservedModelId(providerId, metadata?.modelId);
    if (providerId || modelId) {
      return { providerId, modelId };
    }
  }

  return {};
}

function extractTraceRuntimeSelection(trace: SpaceTurnTrace | null): { providerId?: string; modelId?: string } {
  const run = [...(trace?.executionRuns ?? [])]
    .reverse()
    .find((entry) => normalizeObservedProviderId(entry.providerId) || normalizeObservedModelId(entry.providerId, entry.modelId));
  if (!run) {
    return {};
  }
  const providerId = normalizeObservedProviderId(run.providerId)
    ?? deriveProviderIdFromModelId(run.modelId);
  const modelId = normalizeObservedModelId(providerId, run.modelId);
  return {
    ...(providerId ? { providerId } : {}),
    ...(modelId ? { modelId } : {}),
  };
}

function normalizeObservedProviderId(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim().toLowerCase() : undefined;
}

function normalizeObservedModelId(providerId: string | undefined, value: unknown): string | undefined {
  if (typeof value !== "string" || value.trim().length === 0) {
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed.includes("/")) {
    return trimmed;
  }
  return providerId ? `${providerId}/${trimmed}` : trimmed;
}

function deriveProviderIdFromModelId(value: unknown): string | undefined {
  if (typeof value !== "string" || value.trim().length === 0) {
    return undefined;
  }
  const trimmed = value.trim();
  const delimiterIndex = trimmed.indexOf("/");
  if (delimiterIndex <= 0) {
    return undefined;
  }
  return trimmed.slice(0, delimiterIndex).toLowerCase();
}

function formatRuntimeSelection(providerId: string | undefined, modelId: string | undefined): string {
  const normalizedProviderId = providerId?.trim().toLowerCase() || deriveProviderIdFromModelId(modelId) || "unknown";
  const normalizedModelId = normalizeObservedModelId(normalizedProviderId, modelId);
  if (!normalizedModelId) {
    return normalizedProviderId;
  }
  return normalizedModelId.startsWith(`${normalizedProviderId}/`)
    ? normalizedModelId
    : `${normalizedProviderId}/${normalizedModelId}`;
}

function hasRateLimitedEvidence(
  events: TurnEventPayload[],
  trace: SpaceTurnTrace | null,
): boolean {
  return events.some((event) => {
    const payload = asRecord(event.typedPayload);
    const raw = asRecord(event.data);
    return payload?.kind === "rate_limited" || raw?.type === "rate_limited";
  }) || (trace?.events.some((event) => event.eventType === "rate_limited") ?? false);
}

function isGeminiTransientHostLimitMessage(message: string | undefined): boolean {
  const normalized = message?.toLowerCase() ?? "";
  if (!normalized) return false;
  return normalized.includes("exhausted your capacity")
    || normalized.includes("quota will reset")
    || normalized.includes("rate limit")
    || normalized.includes("rate-limit")
    || normalized.includes("too many requests")
    || normalized.includes("retrying after");
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

  throw new Error("Workbench parity client auth timeout");
}

async function waitForTerminalTurnEvent(
  events: TurnEventPayload[],
  turnId: string,
  timeoutMs: number,
): Promise<TurnEventPayload | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const terminal = events.find((event) =>
      event.turnId === turnId
      && isTerminalTurnEvent(event),
    );
    if (terminal) {
      return terminal;
    }
    await Bun.sleep(100);
  }
  return events.find((event) => event.turnId === turnId && isTerminalTurnEvent(event)) ?? null;
}

async function waitForTerminalTurnTrace(
  client: GatewayClient,
  spaceId: string,
  turnId: string,
  timeoutMs: number,
): Promise<SpaceTurnTrace | null> {
  const deadline = Date.now() + timeoutMs;
  let latestTrace: SpaceTurnTrace | null = null;
  while (Date.now() < deadline) {
    try {
      latestTrace = await client.getTurnTrace({
        spaceId,
        turnId,
        limit: 200,
      });
      if (traceHasCompletion(latestTrace) || traceHasFailure(latestTrace)) {
        return latestTrace;
      }
    } catch {
      // Turn trace can lag slightly behind turn start.
    }
    await Bun.sleep(200);
  }
  return latestTrace;
}

function isTerminalTurnEvent(event: TurnEventPayload): boolean {
  const payload = asRecord(event.typedPayload);
  if (payload?.kind === "turn.completed" || payload?.kind === "turn.failed") {
    return true;
  }
  const raw = asRecord(event.data);
  if (raw?.type === "turn_completed" || raw?.type === "error") {
    return true;
  }
  return event.eventType === "completed" || event.eventType === "failed" || event.eventType === "cancelled";
}

function firstToolStartedFromTrace(
  trace: SpaceTurnTrace | null,
): { name: string; summary: string } | null {
  const toolCall = trace?.toolCalls.find((entry) => typeof entry.toolName === "string" && entry.toolName.trim().length > 0);
  if (!toolCall?.toolName) {
    return null;
  }
  return {
    name: toolCall.toolName,
    summary: toolCall.toolName,
  };
}

function firstToolCompletedFromTrace(
  trace: SpaceTurnTrace | null,
): { result: unknown } | null {
  const event = trace?.events.find((entry) => entry.eventType === "tool_result");
  if (!event) {
    return null;
  }
  const payload = asRecord(event.payload);
  return {
    result: payload?.result ?? payload?.error,
  };
}

function finalMessageFromTrace(trace: SpaceTurnTrace | null): string | null {
  if (!trace) {
    return null;
  }
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

function turnErrorMessageFromTrace(trace: SpaceTurnTrace | null): string | null {
  if (!trace) {
    return null;
  }
  for (let index = trace.events.length - 1; index >= 0; index -= 1) {
    const event = trace.events[index];
    if (!event || (event.eventType !== "error" && event.eventType !== "turn_failed")) continue;
    const payload = asRecord(event.payload);
    const error = asRecord(payload?.error);
    if (typeof error?.message === "string") {
      return error.message;
    }
    if (typeof payload?.message === "string") {
      return payload.message;
    }
  }
  return null;
}

function traceHasCompletion(trace: SpaceTurnTrace | null): boolean {
  return trace?.events.some((event) => event.eventType === "turn_completed") ?? false;
}

function traceHasFailure(trace: SpaceTurnTrace | null): boolean {
  return trace?.events.some((event) => event.eventType === "error" || event.eventType === "turn_failed") ?? false;
}
