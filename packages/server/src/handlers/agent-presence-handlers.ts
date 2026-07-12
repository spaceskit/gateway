import type { ErrorPayload } from "../protocol.js";
import {
  MessageTypes,
  type AgentPresenceRowPayload,
  type AgentPresenceSnapshotPayload,
  type AgentProviderPayload,
  type AnswerAgentPayload,
  type AnswerAgentResponsePayload,
  type AnswerDeliveryModePayload,
  type GatewayMessage,
  type ListActiveAgentsPayload,
  type ListActiveAgentsResponsePayload,
  type SubscribeAgentPresencePayload,
  type SubscribeAgentPresenceResponsePayload,
} from "../protocol.js";
import type { ClientSession } from "../gateway-server.js";
import { mapInfraPulseAgentRow } from "../services/agent-presence-normalizers.js";

/**
 * Contract this slice depends on from the sibling-owned source module
 * (`../services/agent-presence-source.ts`). Defined structurally here so this
 * handler typechecks standalone; the sibling's concrete source satisfies it.
 *
 * The source runs the infra-pulse poller (HTTP http://localhost:9091), owns the
 * gateway-wide AGENT_PRESENCE_TOPIC ("agent-presence"), and re-broadcasts the
 * FULL snapshot to registered subscribers. TODO(sibling): once
 * `../services/agent-presence-source.ts` lands, switch this to
 * `import type { AgentPresenceSource } from "../services/agent-presence-source.js";`
 * and delete this local interface.
 */
export interface AgentPresenceSource {
  /** Topic name constant for the gateway-wide presence broadcast. */
  readonly topic: string;
  /** Current full snapshot (poll fallback + initial subscription payload). */
  getSnapshot(): Promise<AgentPresenceSnapshotPayload>;
  /** Register a connected client to receive AGENT_PRESENCE_UPDATED pushes. */
  subscribe(clientId: string): void;
  /** Stop pushing updates to a disconnected/unsubscribed client. */
  unsubscribe(clientId: string): void;
}

/**
 * Gateway-global feature flags this handler reads (both default OFF).
 * - AGENT_PRESENCE_READ_ENABLED   gates ListActiveAgents / SubscribeAgentPresence
 * - AGENT_PRESENCE_ANSWER_ENABLED gates AnswerAgent (answer-back is risky)
 */
export const AGENT_PRESENCE_READ_FLAG = "AGENT_PRESENCE_READ_ENABLED";
export const AGENT_PRESENCE_ANSWER_FLAG = "AGENT_PRESENCE_ANSWER_ENABLED";

/** infra-pulse answer endpoint (separate repo, reached over HTTP). */
const INFRA_PULSE_ANSWER_URL = "http://localhost:9091/api/agent-presence/answer";
const INFRA_PULSE_ANSWER_TIMEOUT_MS = 8_000;

export interface AgentPresenceHandlerContext {
  /** Sibling-owned snapshot/poller/topic source. Null when unconfigured. */
  agentPresenceSource: AgentPresenceSource | null;
  /** Reads gateway-global feature flags (default OFF when absent). */
  getGatewayGlobalFlags: () => Record<string, unknown> | undefined;
  /** Deliver a single message to one connected client (subscription pushes). */
  sendToClient: (clientId: string, msg: GatewayMessage) => void;
  response: (correlationId: string, type: string, payload?: unknown) => GatewayMessage;
  errorResponse: (
    correlationId: string,
    code: ErrorPayload["code"],
    message: string,
    errDetails?: unknown,
  ) => GatewayMessage;
}

function isFlagEnabled(flags: Record<string, unknown> | undefined, key: string): boolean {
  return flags?.[key] === true;
}

function filterSnapshot(
  snapshot: AgentPresenceSnapshotPayload,
  options: { providers?: AgentProviderPayload[]; includeInactive?: boolean; limit?: number },
): AgentPresenceSnapshotPayload {
  let agents: AgentPresenceRowPayload[] = snapshot.agents;
  if (options.providers && options.providers.length > 0) {
    const allowed = new Set(options.providers);
    agents = agents.filter((row) => allowed.has(row.provider));
  }
  if (!options.includeInactive) {
    agents = agents.filter((row) => row.status !== "working" && row.status !== "idle_dead");
  }
  if (typeof options.limit === "number" && options.limit > 0) {
    agents = agents.slice(0, options.limit);
  }
  return { agents, generatedAt: snapshot.generatedAt };
}

export async function handleAgentPresenceList(
  context: AgentPresenceHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!isFlagEnabled(context.getGatewayGlobalFlags(), AGENT_PRESENCE_READ_FLAG)) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Agent presence is disabled by policy");
  }
  if (!context.agentPresenceSource) {
    return context.errorResponse(msg.id, "UNAVAILABLE", "Agent presence source unavailable");
  }

  const payload = (msg.payload ?? {}) as ListActiveAgentsPayload;
  const snapshot = await context.agentPresenceSource.getSnapshot();
  const filtered = filterSnapshot(snapshot, {
    providers: payload.providers,
    includeInactive: payload.includeInactive,
    limit: payload.limit,
  });
  return context.response(msg.id, MessageTypes.AGENT_PRESENCE_LIST, {
    agents: filtered.agents,
    generatedAt: filtered.generatedAt,
  } satisfies ListActiveAgentsResponsePayload);
}

export async function handleAgentPresenceSubscribe(
  context: AgentPresenceHandlerContext,
  client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  if (!isFlagEnabled(context.getGatewayGlobalFlags(), AGENT_PRESENCE_READ_FLAG)) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Agent presence is disabled by policy");
  }
  if (!context.agentPresenceSource) {
    return context.errorResponse(msg.id, "UNAVAILABLE", "Agent presence source unavailable");
  }

  const payload = (msg.payload ?? {}) as SubscribeAgentPresencePayload;

  // Register this client against the gateway-wide topic. The sibling-owned
  // source runs the infra-pulse poller and re-broadcasts the FULL snapshot to
  // every registered subscriber (mirrors the broadcastToSpace pub/sub pattern,
  // but on the space-agnostic AGENT_PRESENCE_TOPIC).
  context.agentPresenceSource.subscribe(client.id);

  // Send the initial snapshot immediately (default on) so the board fills in
  // before the first poll tick — late subscribers stay consistent.
  if (payload.includeInitialSnapshot !== false) {
    const snapshot = await context.agentPresenceSource.getSnapshot();
    const filtered = filterSnapshot(snapshot, {
      providers: payload.providers,
      includeInactive: payload.includeInactive,
    });
    context.sendToClient(client.id, {
      type: MessageTypes.AGENT_PRESENCE_UPDATED,
      id: crypto.randomUUID(),
      ts: new Date().toISOString(),
      payload: {
        agents: filtered.agents,
        generatedAt: filtered.generatedAt,
      } satisfies AgentPresenceSnapshotPayload,
    });
  }

  return context.response(msg.id, MessageTypes.AGENT_PRESENCE_SUBSCRIBE, {
    subscribed: true,
  } satisfies SubscribeAgentPresenceResponsePayload);
}

/**
 * Raw shape returned by infra-pulse's /api/agent-presence/answer endpoint —
 * camelCase per `@agent-presence/contracts` (infra-pulse side; drift-checked
 * here via the committed fixtures in test/fixtures/agent-presence/). `error`
 * is a plain string; `agent` is a raw detector row (kebab-case statuses) that
 * must go through the normalizer before reaching the wire.
 */
interface InfraPulseAnswerResponse {
  ok?: boolean;
  mode?: string;
  deliveredAnswer?: string;
  detail?: string;
  error?: string;
  agent?: unknown;
}

/** Map infra-pulse's delivery mode honestly; unknown -> unspecified. */
function mapDeliveryMode(raw: string | undefined): AnswerDeliveryModePayload {
  switch (raw) {
    case "in_place":
      return "in_place";
    case "fork_resume":
      return "fork_resume";
    case "read_only":
      return "read_only";
    default:
      return "unspecified";
  }
}

/** Stable machine code for an infra-pulse answer failure, derived from HTTP status. */
function answerErrorCode(httpStatus: number): string {
  switch (httpStatus) {
    case 400:
      return "invalid_argument";
    case 404:
      return "not_found";
    case 409:
      return "stale_ask";
    case 503:
      return "answer_disabled";
    default:
      return "delivery_failed";
  }
}

export async function handleAgentAnswer(
  context: AgentPresenceHandlerContext,
  _client: ClientSession,
  msg: GatewayMessage,
): Promise<GatewayMessage | null> {
  // Answer-back is the risky surface — default OFF, independently gated.
  if (!isFlagEnabled(context.getGatewayGlobalFlags(), AGENT_PRESENCE_ANSWER_FLAG)) {
    return context.errorResponse(msg.id, "FAILED_PRECONDITION", "Agent answer-back is disabled by policy");
  }

  const payload = msg.payload as AnswerAgentPayload;
  if (!payload?.key?.trim()) {
    return context.errorResponse(msg.id, "INVALID_ARGUMENT", "key is required");
  }

  // Wire body per @agent-presence/contracts AgentPresenceAnswerRequest:
  // camelCase, and unset fields are OMITTED (never optionIndex:-1 / "").
  const answerBody: Record<string, unknown> = { key: payload.key };
  if (typeof payload.optionIndex === "number" && payload.optionIndex >= 0) {
    answerBody.optionIndex = payload.optionIndex;
  }
  if (payload.optionLabel) answerBody.optionLabel = payload.optionLabel;
  if (payload.text) answerBody.text = payload.text;
  if (payload.expectedHash) answerBody.expectedHash = payload.expectedHash;
  if (payload.idempotencyKey) answerBody.idempotencyKey = payload.idempotencyKey;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), INFRA_PULSE_ANSWER_TIMEOUT_MS);
  try {
    const response = await fetch(INFRA_PULSE_ANSWER_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(answerBody),
      signal: controller.signal,
    });

    // infra-pulse returns the SAME structured shape on 200/400/404/409/502/503
    // (ok:false + error + delivery mode, fresh `agent` row on 409). Round-trip
    // it so the app can badge honestly instead of collapsing to UNAVAILABLE;
    // errorResponse is reserved for transport failures (down / non-JSON).
    let body: InfraPulseAnswerResponse;
    try {
      body = (await response.json()) as InfraPulseAnswerResponse;
    } catch {
      return context.errorResponse(
        msg.id,
        "UNAVAILABLE",
        `infra-pulse answer endpoint returned HTTP ${response.status} with a non-JSON body`,
      );
    }

    return context.response(msg.id, MessageTypes.AGENT_PRESENCE_ANSWER, {
      ok: body.ok === true,
      deliveredAnswer: body.deliveredAnswer ?? "",
      // mode round-trips honestly — Claude fork answers report fork_resume so
      // the app can badge "continued in a new run".
      deliveryMode: mapDeliveryMode(body.mode),
      error:
        body.ok === true
          ? undefined
          : {
              code: answerErrorCode(response.status),
              message: body.error ?? body.detail ?? `infra-pulse answer failed (HTTP ${response.status})`,
            },
      // Raw detector row (kebab-case statuses) -> wire payload; fresh row on 409.
      agent: body.agent !== undefined ? (mapInfraPulseAgentRow(body.agent) ?? undefined) : undefined,
    } satisfies AnswerAgentResponsePayload);
  } catch (err) {
    const message = err instanceof Error ? err.message : "infra-pulse answer request failed";
    return context.errorResponse(msg.id, "UNAVAILABLE", message);
  } finally {
    clearTimeout(timeout);
  }
}
