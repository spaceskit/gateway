/**
 * WebSocket server for the Spaceskit.
 *
 * Uses Bun's built-in WebSocket server (backed by uWebSockets)
 * for zero-dependency, high-performance connections.
 *
 * Responsibilities:
 * - Accept WebSocket connections via Bun.serve()
 * - Handle Ed25519 challenge-response authentication
 * - Route incoming messages to the appropriate handler
 * - Broadcast space events to subscribed clients via pub/sub
 * - Manage client sessions and subscriptions
 */

/// <reference types="bun-types" />
import type { ServerWebSocket } from "bun";
import { randomUUID } from "node:crypto";
import type { GatewayEvent } from "@spaceskit/core";
import type { Logger } from "@spaceskit/observability";
import {
  MessageTypes,
  type GatewayMessage,
  type ErrorPayload,
} from "./protocol.js";
import { buildGatewayErrorPayload } from "./error-contract.js";
import { GatewayEventBroadcaster } from "./gateway-event-broadcaster.js";
import type {
  ClientSession,
  GatewayServerOptions,
  WSData,
} from "./gateway-server-types.js";
import {
  consumeHttpRateLimit,
  createIpBucketEvictionTimer,
  type IpBucket,
} from "./gateway-server-rate-limit.js";
import { GatewayServerDrainState } from "./gateway-server-drain.js";
import { handleGatewayServerHttpRequest } from "./gateway-server-http.js";
import { isAddressInUseError } from "./gateway-server-port.js";
import {
  closeGatewayServerWebSocket,
  handleGatewayServerWebSocketMessage,
  openGatewayServerWebSocket,
} from "./gateway-server-websocket.js";
import { handleGatewayServerMessage } from "./gateway-server-message-handler.js";
import {
  disconnectGatewaySessionsByDevice,
  sendToGatewayIdentity,
} from "./gateway-server-session-delivery.js";

export type { SyncHttpError, SyncHttpHandler } from "./sync-http-routes.js";
export type {
  ClientSession,
  GatewayServerOptions,
  HealthCheckContext,
  HealthStatus,
  NoiseTransportConfig,
  SubscribeAuthorizationResult,
  WSData,
} from "./gateway-server-types.js";

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

export class GatewayServer {
  private server: ReturnType<typeof Bun.serve> | null = null;
  private clients = new Map<string, ClientSession>();
  private sockets = new Map<string, ServerWebSocket<WSData>>();
  private eventUnsubscribers: (() => void)[] = [];
  private startedAt = Date.now();
  private log: Logger | null;
  private eventBroadcaster: GatewayEventBroadcaster;
  private drainState: GatewayServerDrainState;

  // Per-IP WebSocket connection counter for connection cap enforcement
  private connectionsPerIp = new Map<string, number>();

  // Per-IP token buckets for HTTP rate limiting
  private ipBuckets = new Map<string, IpBucket>();
  private ipBucketEvictionTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private options: GatewayServerOptions) {
    this.log = options.logger ?? null;
    this.eventBroadcaster = new GatewayEventBroadcaster({
      logger: this.log,
      resolveSpaceUid: options.resolveSpaceUid,
      publish: (spaceUid, msg) => this.broadcastToSpace(spaceUid, msg),
    });
    this.drainState = new GatewayServerDrainState({
      logger: this.log,
      clientCount: () => this.clients.size,
    });
    this.ipBucketEvictionTimer = createIpBucketEvictionTimer(this.ipBuckets);
  }

  /**
   * Start the WebSocket server using Bun.serve().
   * No external dependencies needed — Bun provides WebSocket natively.
   */
  start(): void {
    const self = this;
    const host = this.options.host ?? "127.0.0.1";
    const requestedPort = this.options.port;
    const allowPortFallback = this.options.allowPortFallback === true;
    const fallbackRange = Math.max(0, this.options.portFallbackRange ?? 20);
    const maxAttempts = allowPortFallback ? fallbackRange + 1 : 1;

    const createServer = (port: number) => Bun.serve<WSData>({
      port,
      hostname: host,

      // HTTP handler - upgrade to WebSocket, health check, or A2A routes
      async fetch(req, server) {
        return handleGatewayServerHttpRequest({
          req,
          server,
          options: self.options,
          startedAt: self.startedAt,
          clientCount: self.clients.size,
          isDraining: self.drainState.isDraining,
          connectionsPerIp: self.connectionsPerIp,
          consumeRateLimit: (ip) => self.checkHttpRateLimit(ip),
        });
      },

      websocket: {
        // Bun's idle timeout in seconds (heartbeat)
        idleTimeout: 120,
        // Max message size — configurable, default 1MB
        maxPayloadLength: self.options.maxPayloadLength ?? 1 * 1024 * 1024,

        open(ws) {
          openGatewayServerWebSocket(ws, self.websocketContext());
        },

        async message(ws, message) {
          await handleGatewayServerWebSocketMessage(ws, message, self.websocketContext());
        },

        close(ws) {
          closeGatewayServerWebSocket(ws, self.websocketContext());
        },
      },
    });

    let lastError: unknown;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const candidatePort = requestedPort + attempt;
      if (candidatePort > 65_535) {
        break;
      }
      try {
        this.server = createServer(candidatePort);
        if (candidatePort !== requestedPort) {
          this.log?.warn("Configured port unavailable, using fallback port", {
            host,
            requestedPort,
            selectedPort: candidatePort,
            attempts: attempt + 1,
          });
        }
        break;
      } catch (err) {
        lastError = err;
        const shouldRetry = allowPortFallback
          && isAddressInUseError(err)
          && attempt + 1 < maxAttempts
          && candidatePort + 1 <= 65_535;

        if (shouldRetry) {
          this.log?.warn("Port already in use, retrying with next port", {
            host,
            attemptedPort: candidatePort,
            nextPort: candidatePort + 1,
          });
          continue;
        }

        throw err;
      }
    }

    if (!this.server) {
      throw lastError instanceof Error
        ? lastError
        : new Error(`Unable to start server on ${host}:${requestedPort}`);
    }

    // Forward only broadcast-relevant events to subscribed clients via Bun's pub/sub
    const broadcastHandler = (event: GatewayEvent) => { void this.broadcastEvent(event); };
    this.eventUnsubscribers = [
      this.options.eventBus.on("space.turn_event", broadcastHandler),
      this.options.eventBus.on("space.turn_started", broadcastHandler),
      this.options.eventBus.on("space.orchestrator_event", broadcastHandler),
    ];
  }

  async stop(): Promise<void> {
    const clientCount = this.clients.size;
    const uptimeMs = Date.now() - this.startedAt;
    this.log?.info("Server stopping", { clients: clientCount, uptimeMs });

    for (const unsub of this.eventUnsubscribers) unsub();
    this.eventUnsubscribers = [];

    // Close all client connections
    for (const [_id, ws] of this.sockets) {
      ws.close(1001, "Server shutting down");
    }
    this.clients.clear();
    this.sockets.clear();
    this.connectionsPerIp.clear();
    this.drainState.reset();

    if (this.server) {
      this.server.stop();
      this.server = null;
    }

    if (this.ipBucketEvictionTimer !== null) {
      clearInterval(this.ipBucketEvictionTimer);
      this.ipBucketEvictionTimer = null;
    }

    this.log?.info("Server stopped", { disconnectedClients: clientCount, uptimeMs });
  }

  /** Register an active turn. Called when a turn starts processing. */
  registerActiveTurn(turnId: string): void {
    this.drainState.registerActiveTurn(turnId);
  }

  /** Mark a turn as completed. If draining and no more active turns, resolve early. */
  completeTurn(turnId: string): void {
    this.drainState.completeTurn(turnId);
  }

  /** Number of currently active turns. */
  get activeTurnCount(): number {
    return this.drainState.activeTurnCount;
  }

  /**
   * Enter drain mode: stop accepting new connections and requests, then wait
   * for in-flight activity to complete (up to timeoutMs) before the caller
   * proceeds with stop().
   */
  async drain(timeoutMs: number = 10000): Promise<void> {
    await this.drainState.drain(timeoutMs);
  }

  get clientCount(): number {
    return this.clients.size;
  }

  get port(): number {
    return this.server?.port ?? this.options.port;
  }

  /** Disconnect all authenticated sessions bound to a specific device ID (optionally scoped by principal). */
  disconnectSessionsByDevice(deviceId: string, principalId?: string): number {
    return disconnectGatewaySessionsByDevice({
      deviceId,
      principalId,
      clients: this.clients,
      sockets: this.sockets,
      logger: this.log,
    });
  }

  /** Send a message to a specific client. */
  send(clientId: string, msg: GatewayMessage): void {
    const ws = this.sockets.get(clientId);
    if (ws) {
      ws.send(JSON.stringify(msg));
    }
  }

  sendToIdentity(principalId: string, deviceId: string | undefined, msg: GatewayMessage): number {
    return sendToGatewayIdentity({
      principalId,
      deviceId,
      msg,
      clients: this.clients,
      send: (clientId, message) => this.send(clientId, message),
    });
  }

  /** Broadcast a message to all clients subscribed to a space UID via Bun's pub/sub. */
  broadcastToSpace(spaceUid: string, msg: GatewayMessage): void {
    this.server?.publish(`space:${spaceUid}`, JSON.stringify(msg));
  }

  // ---------------------------------------------------------------------------
  // HTTP rate limiting
  // ---------------------------------------------------------------------------

  /**
   * Consume one token for the given IP.
   * Returns true when the request is allowed, false when it should be rejected.
   */
  private checkHttpRateLimit(ip: string): boolean {
    return consumeHttpRateLimit({
      ipBuckets: this.ipBuckets,
      ip,
      rpm: this.options.httpRateLimitRpm ?? 120,
    });
  }

  // ---------------------------------------------------------------------------
  // Message handling
  // ---------------------------------------------------------------------------

  private async handleMessage(
    session: ClientSession,
    ws: ServerWebSocket<WSData>,
    msg: GatewayMessage,
  ): Promise<void> {
    await handleGatewayServerMessage({
      session,
      ws,
      msg,
      options: this.options,
      logger: this.log,
      clients: this.clients,
      sockets: this.sockets,
      isDraining: this.drainState.isDraining,
      send: (clientId, message) => this.send(clientId, message),
      sendError: (target, code, message, options) => this.sendError(target, code, message, options),
    });
  }

  private async broadcastEvent(event: GatewayEvent): Promise<void> {
    await this.eventBroadcaster.broadcastEvent(event);
  }

  private sendError(
    ws: ServerWebSocket<WSData>,
    code: string,
    message: string,
    options: {
      details?: unknown;
      correlationId?: string;
      replyTo?: string;
      retryable?: boolean;
    } = {},
  ): void {
    const correlationId = options.correlationId ?? randomUUID();
    const payload: ErrorPayload = buildGatewayErrorPayload(
      code,
      message,
      correlationId,
      options.details,
      options.retryable,
    );

    ws.send(JSON.stringify({
      type: MessageTypes.ERROR,
      id: randomUUID(),
      replyTo: options.replyTo,
      ts: new Date().toISOString(),
      payload,
    }));
  }

  private websocketContext() {
    return {
      options: this.options,
      logger: this.log,
      clients: this.clients,
      sockets: this.sockets,
      connectionsPerIp: this.connectionsPerIp,
      send: (clientId: string, message: GatewayMessage) => this.send(clientId, message),
      sendError: (
        target: ServerWebSocket<WSData>,
        code: string,
        message: string,
        options?: {
          details?: unknown;
          correlationId?: string;
          replyTo?: string;
          retryable?: boolean;
        },
      ) => this.sendError(target, code, message, options),
      handleMessage: (
        session: ClientSession,
        target: ServerWebSocket<WSData>,
        message: GatewayMessage,
      ) => this.handleMessage(session, target, message),
    };
  }

}
