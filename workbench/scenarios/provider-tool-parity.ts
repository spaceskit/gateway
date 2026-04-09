import { randomUUID } from "node:crypto";
import {
  GatewayClient,
  generateAuthKeyPair,
  type SpaceTurnTrace,
  type TurnEventPayload,
} from "../client.js";
import { ExecutionAdapterFactory } from "../../packages/bootstrap/src/execution/execution-adapter-factory.js";
import type { ProviderParityRow } from "../report.js";
import type { Layer, ScenarioContext } from "./index.js";

type SupportedParityProviderId = "apple" | "lmstudio" | "claude" | "codex" | "gemini";

interface ProviderTarget {
  provider: SupportedParityProviderId;
  model: string;
  transport: ProviderParityRow["transport"];
}

const SUPPORTED_PROVIDERS: SupportedParityProviderId[] = [
  "apple",
  "lmstudio",
  "claude",
  "codex",
  "gemini",
];

const CANONICAL_LIVE_MODELS: Record<Exclude<SupportedParityProviderId, "lmstudio">, string> = {
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
  gemini: "mediated_fallback",
};

export const providerToolParityLayer: Layer = {
  name: "provider-tool-parity",
  scenarios: [
    {
      name: "default-access-gateway-tools",
      run: async (ctx: ScenarioContext) => {
        const rows = await runProviderParityAudit(ctx);
        ctx.providerParityRows.push(...rows);

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
  ],
};

async function runProviderParityAudit(ctx: ScenarioContext): Promise<ProviderParityRow[]> {
  const configMap = new Map(
    ctx.gateway.gatewayAdminService.listProviderConfigs().map((config) => [config.providerId.toLowerCase(), config]),
  );
  const executionFactory = new ExecutionAdapterFactory();
  const rows: ProviderParityRow[] = [];

  for (const provider of SUPPORTED_PROVIDERS) {
    if (ctx.providerFilters && !ctx.providerFilters.has(provider)) {
      continue;
    }

    if (provider === "apple") {
      const targetModel = CANONICAL_LIVE_MODELS.apple;
      const health = await checkProviderAvailability(executionFactory, provider, targetModel, configMap.get(provider));
      if (!health.available) {
        rows.push(makeUnavailableRow({
          scope: "live",
          provider,
          model: targetModel,
          failureReason: health.failureReason,
        }));
        continue;
      }
      rows.push(await runLiveParityTurn(ctx, { provider, model: targetModel, transport: PROVIDER_TRANSPORT[provider] }));
      continue;
    }

    if (provider === "lmstudio") {
      const config = configMap.get(provider);
      const providerModel = config?.model ?? "lmstudio/unknown";
      const health = await checkProviderAvailability(executionFactory, provider, providerModel, config);
      if (!health.available) {
        rows.push(makeUnavailableRow({
          scope: "metadata",
          provider,
          model: providerModel,
          failureReason: health.failureReason,
        }));
        rows.push(makeUnavailableRow({
          scope: "live",
          provider,
          model: providerModel,
          failureReason: health.failureReason,
        }));
        continue;
      }

      const modelProvider = executionFactory.createModelProvider({
        providerId: provider,
        model: providerModel,
        baseURL: config?.baseURL,
        isLocal: true,
      });
      const models = await modelProvider.listModels();
      const liveTargets: ProviderTarget[] = [];

      for (const model of models) {
        if (model.supportsTools) {
          rows.push({
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
          rows.push({
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
        rows.push(makeUnavailableRow({
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
            baseURL: config?.baseURL,
            allowedModels: liveTargets.map((target) => target.model),
            allowCustomModel: true,
          });
        } catch (error) {
          const failureReason = describeUnknownError(error);
          for (const target of liveTargets) {
            rows.push(makeUnavailableRow({
              scope: "live",
              provider,
              model: target.model,
              failureReason,
            }));
          }
          continue;
        }
        for (const target of liveTargets) {
          rows.push(await runLiveParityTurn(ctx, target));
        }
      }
      continue;
    }

    const targetModel = CANONICAL_LIVE_MODELS[provider];
    const health = await checkProviderAvailability(executionFactory, provider, targetModel, configMap.get(provider));
    const modelProvider = executionFactory.createModelProvider({
      providerId: provider,
      model: targetModel,
      isLocal: true,
    });
    const models = await modelProvider.listModels();

    for (const model of models) {
      rows.push({
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
      rows.push(makeUnavailableRow({
        scope: "live",
        provider,
        model: targetModel,
        failureReason: health.failureReason,
      }));
      continue;
    }

    rows.push(await runLiveParityTurn(ctx, {
      provider,
      model: targetModel,
      transport: PROVIDER_TRANSPORT[provider],
    }));
  }

  return rows;
}

async function checkProviderAvailability(
  factory: ExecutionAdapterFactory,
  provider: SupportedParityProviderId,
  model: string,
  config: { baseURL?: string } | undefined,
): Promise<{ available: boolean; failureReason?: string }> {
  try {
    const modelProvider = factory.createModelProvider({
      providerId: provider,
      model,
      ...(config?.baseURL ? { baseURL: config.baseURL } : {}),
      isLocal: true,
    });
    const health = await modelProvider.checkHealth();
    if (health.available) {
      return { available: true };
    }
    return {
      available: false,
      failureReason: `${provider} runtime is not reachable on this host.`,
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
  const client = await makeClient(ctx.wsUrl, `bench-parity-${target.provider}`);
  const agentId = `bench-${target.provider}-${randomUUID().slice(0, 8)}`;
  const marker = `${target.provider}-${randomUUID().slice(0, 8)}`;

  try {
    const definition = await client.createAgentDefinition({
      name: `Parity ${target.provider}`,
      instructions: "You are a workbench parity agent. Follow the tool instruction exactly and answer concisely.",
      providerHint: target.provider,
      modelHint: target.model,
    });

    const space = await client.createSpace({
      name: `bench-parity-${target.provider}-${randomUUID().slice(0, 6)}`,
      resourceId: `resource:workbench:parity:${target.provider}:${randomUUID().slice(0, 6)}`,
      goal: `Gateway tool parity check for ${target.provider}`,
      initialAgents: [{
        agentId,
        profileId: definition.agentDefinition.agentDefinitionId,
        role: "participant" as const,
        isPrimary: true,
      }],
    });

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
      const terminalEvent = await waitForTerminalTurnEvent(events, turnResult.turnId, 20_000);
      const trace = await waitForTerminalTurnTrace(client, space.id, turnResult.turnId, 20_000);

      const turnEvents = events.filter((event) => event.turnId === turnResult.turnId);
      const observedToolCall = firstToolStarted(turnEvents) ?? firstToolStartedFromTrace(trace);
      const observedToolResult = firstToolCompleted(turnEvents) ?? firstToolCompletedFromTrace(trace);
      const finalAnswer = finalMessageFromEvents(turnEvents) ?? finalMessageFromTrace(trace) ?? turnResult.output ?? "";
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
          observedToolCall: observedToolCall?.summary,
          observedToolResult: observedToolResult?.result,
          failureReason: turnErrorMessage(turnEvents) ?? turnErrorMessageFromTrace(trace) ?? turnResult.error ?? "Turn failed before completion.",
        };
      }

      if (!sawTurnCompletion && !finalAnswer.trim()) {
        return {
          scope: "live",
          provider: target.provider,
          model: target.model,
          transport: target.transport,
          status: "fail",
          observedToolCall: observedToolCall?.summary,
          observedToolResult: observedToolResult?.result,
          failureReason: terminalEvent
            ? "Turn ended without a final answer or completion event."
            : "Timed out waiting for the turn to reach a terminal event.",
        };
      }

      if (!observedToolCall || observedToolCall.name !== "lists.echo") {
        return {
          scope: "live",
          provider: target.provider,
          model: target.model,
          transport: target.transport,
          status: "fail",
          failureReason: "Expected a lists.echo tool call during the turn.",
        };
      }

      if (!observedToolResult) {
        return {
          scope: "live",
          provider: target.provider,
          model: target.model,
          transport: target.transport,
          status: "fail",
          observedToolCall: observedToolCall.summary,
          failureReason: "Expected a tool result event for the echoed marker.",
        };
      }

      if (!finalAnswer.includes(marker)) {
        return {
          scope: "live",
          provider: target.provider,
          model: target.model,
          transport: target.transport,
          status: "fail",
          observedToolCall: observedToolCall.summary,
          observedToolResult: observedToolResult.result,
          failureReason: `Final answer did not include marker ${marker}.`,
        };
      }

      return {
        scope: "live",
        provider: target.provider,
        model: target.model,
        transport: target.transport,
        status: "pass",
        observedToolCall: observedToolCall.summary,
        observedToolResult: observedToolResult.result,
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
      failureReason: error instanceof Error ? error.message : String(error),
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

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
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
