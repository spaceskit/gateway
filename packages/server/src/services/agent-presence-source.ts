import { randomUUID } from "node:crypto";
import type { GatewayMessage } from "../protocol.js";
import { MessageTypes } from "../protocol.js";
import { GATEWAY_PRESENCE_TOPIC } from "../gateway-presence-topic.js";
import type { AgentPresenceSource } from "../handlers/agent-presence-handlers.js";
import type {
  AgentPresenceRowPayload,
  AgentPresenceSnapshotPayload,
} from "../protocol/agent-presence.js";
import {
  mapInfraPulseSnapshot,
  type InfraPulseAgentPresenceResponse,
} from "./agent-presence-normalizers.js";

/**
 * AgentPresenceSourceService — the gateway-side "departure board" data path.
 *
 * infra-pulse (a SEPARATE repo, reached only over HTTP at
 * `${infraPulseUrl}/api/agent-presence`) produces local AI-CLI agent presence.
 * It has no push channel, so the gateway polls it on a short interval, maps the
 * raw detector JSON onto the JSON-transport `AgentPresenceRowPayload`, caches the
 * latest good snapshot for the unary `ListActiveAgents` handler
 * (`getSnapshot()`), and re-broadcasts the FULL current set to every subscribed
 * client whenever it changes.
 *
 * This implements the `AgentPresenceSource` interface the sibling-owned
 * `agent-presence-handlers.ts` depends on (`topic`, `getSnapshot`, `subscribe`,
 * `unsubscribe`). It mirrors `HarnessConciergePingerService`'s `setInterval`
 * polling shape and the `GatewayEventBroadcaster` full-snapshot broadcast model.
 *
 * Push transport: rather than the `space:`-style pub/sub topic, it pushes per
 * subscribed client id via the injected `send` (the gateway's
 * `GatewayServer.send`), because subscriptions here are connection-scoped and
 * the handler tracks them by `client.id`. `send` is wired in the server-startup
 * phase (after the WebSocket server exists) via `start()`; before that the
 * source is dormant — `getSnapshot()` returns empty and `subscribe()` only
 * records the id.
 *
 * Degrades gracefully: when infra-pulse is down the snapshot becomes empty (so a
 * stale ping clears, never stale-forever), nothing throws, and the failure is
 * logged at most once per unreachable streak.
 */

const DEFAULT_INFRA_PULSE_URL = "http://localhost:9091";
const DEFAULT_POLL_INTERVAL_MS = 4_000;
const MIN_POLL_INTERVAL_MS = 1_000;
const DEFAULT_FETCH_TIMEOUT_MS = 2_500;

/**
 * Space-agnostic identifier for the gateway-wide presence broadcast. Re-exported
 * from the canonical `gateway-presence-topic` so the source, the server's
 * `broadcastToGateway`, and the app all agree on a single topic string.
 */
export const AGENT_PRESENCE_TOPIC = GATEWAY_PRESENCE_TOPIC;

export interface AgentPresenceSourceLogger {
  warn(message: string, details?: Record<string, unknown>): void;
  info?(message: string, details?: Record<string, unknown>): void;
}

export interface AgentPresenceSourceServiceOptions {
  /** Base URL of the infra-pulse dashboard API. Defaults to http://localhost:9091. */
  infraPulseUrl?: string;
  /** Poll cadence in ms (floored at 1s). Defaults to 4s. */
  pollIntervalMs?: number;
  /** Per-request fetch timeout in ms. Defaults to 2.5s. */
  fetchTimeoutMs?: number;
  /** Inject for tests: fetch the raw `/api/agent-presence` body. Defaults to HTTP GET. */
  fetchSnapshot?: () => Promise<InfraPulseAgentPresenceResponse>;
  logger?: AgentPresenceSourceLogger | null;
}

export class AgentPresenceSourceService implements AgentPresenceSource {
  readonly topic = AGENT_PRESENCE_TOPIC;

  private readonly infraPulseUrl: string;
  private readonly pollIntervalMs: number;
  private readonly fetchTimeoutMs: number;
  private readonly logger: AgentPresenceSourceLogger | null;
  private readonly subscribers = new Set<string>();

  private snapshot: AgentPresenceSnapshotPayload = { agents: [], generatedAt: 0 };
  private lastBroadcastHash = "";
  private timer: ReturnType<typeof setInterval> | null = null;
  private send: ((clientId: string, msg: GatewayMessage) => void) | null = null;
  /** Suppress duplicate failure logs across a single unreachable streak. */
  private failureLogged = false;

  constructor(private readonly options: AgentPresenceSourceServiceOptions = {}) {
    this.infraPulseUrl = (options.infraPulseUrl ?? DEFAULT_INFRA_PULSE_URL).replace(/\/+$/, "");
    this.pollIntervalMs = Math.max(
      MIN_POLL_INTERVAL_MS,
      options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
    );
    this.fetchTimeoutMs = options.fetchTimeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
    this.logger = options.logger ?? null;
  }

  /** Latest cached snapshot for the unary handler + initial subscription payload. */
  async getSnapshot(): Promise<AgentPresenceSnapshotPayload> {
    return this.snapshot;
  }

  /** Register a connected client to receive `AGENT_PRESENCE_UPDATED` pushes. */
  subscribe(clientId: string): void {
    this.subscribers.add(clientId);
  }

  /** Stop pushing updates to a disconnected/unsubscribed client. */
  unsubscribe(clientId: string): void {
    this.subscribers.delete(clientId);
  }

  /**
   * Start the poll + broadcast loop, binding the per-client delivery function
   * (the gateway's `GatewayServer.send`). Runs one pass immediately, then every
   * `pollIntervalMs`. Returns the timer (unref'd) so the caller can stash it.
   */
  start(send: (clientId: string, msg: GatewayMessage) => void): ReturnType<typeof setInterval> {
    this.stop();
    this.send = send;
    void this.runOnce();
    this.timer = setInterval(() => {
      void this.runOnce();
    }, this.pollIntervalMs);
    this.timer.unref?.();
    return this.timer;
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.send = null;
  }

  /**
   * Poll once: fetch → map → cache → broadcast-if-changed. Failures degrade to
   * an empty snapshot and a debounced warning; this method never rejects.
   */
  async runOnce(): Promise<void> {
    let next: AgentPresenceSnapshotPayload;
    try {
      const body = await this.loadSnapshot();
      next = mapInfraPulseSnapshot(body);
      if (this.failureLogged) {
        this.logger?.info?.("Agent presence source recovered", { url: this.infraPulseUrl });
        this.failureLogged = false;
      }
    } catch (error) {
      // Graceful degradation: empty the board (so a stale ping clears) and log
      // at most once per failure streak. infra-pulse being offline is expected
      // in dev and must not crash or spam the gateway log.
      next = { agents: [], generatedAt: Date.now() };
      if (!this.failureLogged) {
        this.logger?.warn("Agent presence source unreachable; serving empty board", {
          url: this.infraPulseUrl,
          error: error instanceof Error ? error.message : String(error),
        });
        this.failureLogged = true;
      }
    }

    this.snapshot = next;
    const hash = snapshotHash(next.agents);
    if (hash !== this.lastBroadcastHash) {
      this.lastBroadcastHash = hash;
      this.broadcast(next);
    }
  }

  /** Push the full snapshot to every subscribed client. */
  private broadcast(snapshot: AgentPresenceSnapshotPayload): void {
    const send = this.send;
    if (!send || this.subscribers.size === 0) return;
    const msg: GatewayMessage = {
      type: MessageTypes.AGENT_PRESENCE_UPDATED,
      id: randomUUID(),
      ts: new Date().toISOString(),
      payload: snapshot,
    };
    for (const clientId of this.subscribers) {
      send(clientId, msg);
    }
  }

  private async loadSnapshot(): Promise<InfraPulseAgentPresenceResponse> {
    if (this.options.fetchSnapshot) return this.options.fetchSnapshot();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.fetchTimeoutMs);
    try {
      const response = await fetch(`${this.infraPulseUrl}/api/agent-presence`, {
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`agent-presence endpoint returned HTTP ${response.status}`);
      }
      return (await response.json()) as InfraPulseAgentPresenceResponse;
    } finally {
      clearTimeout(timeout);
    }
  }
}

/**
 * Order-independent change key: a re-poll that returns the same waiting states
 * (same key + hash + status + liveness) must NOT trigger a broadcast. Excludes
 * `at`, which jitters on every detector read, and `generatedAt`, which is
 * per-response.
 */
function snapshotHash(agents: AgentPresenceRowPayload[]): string {
  return agents
    .map((a) => `${a.key}#${a.hash}#${a.status}#${a.live ? 1 : 0}`)
    .sort()
    .join("|");
}
