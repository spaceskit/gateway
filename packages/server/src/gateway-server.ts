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
import { randomUUID, randomBytes } from "node:crypto";
import type { EventBus, GatewayEvent } from "@spaceskit/core";
import type { Logger } from "@spaceskit/observability";
import {
  MessageTypes,
  type GatewayMessage,
  type ErrorPayload,
  type SubscribeResponsePayload,
} from "./protocol.js";
import { buildGatewayErrorPayload } from "./error-contract.js";
import {
  GatewayEventBroadcaster,
  resolveGatewayTurnAgentId,
} from "./gateway-event-broadcaster.js";
import {
  handleGatewayAuthenticate,
  type GatewayDeviceIdentityValidator,
} from "./gateway-authentication.js";
import type { A2AHandler } from "./a2a/a2a-handler.js";
import type { NotificationHandler } from "./notification-handler.js";
import { handleSyncHttpRequest, type SyncHttpHandler } from "./sync-http-routes.js";
import { handleHealthRequest } from "./health-http-routes.js";
import { withCors as attachCorsHeaders } from "./http-response-helpers.js";
import {
  buildSubscribeResponseMessage,
  normalizeSubscribePayload,
} from "./subscription-protocol.js";
import {
  buildNotificationSubscriptionResponseMessage,
  normalizeNotificationCategories,
} from "./notification-subscription-protocol.js";

export type { SyncHttpError, SyncHttpHandler } from "./sync-http-routes.js";

// ---------------------------------------------------------------------------
// Noise Protocol types (optional — imported dynamically when enabled)
// ---------------------------------------------------------------------------

/**
 * Noise Protocol session interface.
 * When noise is enabled, each client connection is wrapped in a NoiseSession
 * that encrypts all traffic after the handshake completes.
 */
export interface NoiseTransportConfig {
  /** Enable Noise Protocol encryption for all connections. */
  enabled: boolean;
  /** Noise static key pair — public key (base64). */
  publicKey: string;
  /** Noise static key pair — private key (base64). */
  privateKey: string;
  /** Known peer public keys (base64). Connections from unknown peers require pairing. */
  knownPeers?: string[];
  /** Callback when a new peer completes the Noise handshake. */
  onNewPeer?: (peerPublicKey: string) => void;
}

export interface SubscribeAuthorizationResult {
  allowed: boolean;
  reason?: string;
}

export interface HealthCheckContext {
  /** True when /health was requested with debug=1 style query flag. */
  debug?: boolean;
  /** Raw HTTP request for advanced health adapters. */
  request?: Request;
  /** Parsed URL for the incoming request. */
  url?: URL;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GatewayServerOptions {
  port: number;
  host?: string;
  /**
   * If true, retry startup on subsequent ports when the requested port is already in use.
   * Default: false.
   */
  allowPortFallback?: boolean;
  /**
   * Number of additional ports to try when `allowPortFallback` is enabled.
   * Default: 20.
   */
  portFallbackRange?: number;
  eventBus: EventBus;
  /** Called when a client sends a message. Return a response payload or null. */
  onMessage?: (client: ClientSession, msg: GatewayMessage) => Promise<GatewayMessage | null>;
  /** Called when a client disconnects (for cleanup of per-client state). */
  onClientClose?: (client: ClientSession) => void;
  /**
   * Optional hook to authorize per-space subscriptions before joining pub/sub topics.
   * If omitted, all authenticated subscriptions are allowed.
   */
  authorizeSubscribe?: (
    input: { client: ClientSession; spaceUid: string; spaceId?: string },
  ) =>
    | SubscribeAuthorizationResult
    | Promise<SubscribeAuthorizationResult>;
  /** Optional A2A handler for HTTP endpoints. */
  a2aHandler?: A2AHandler;
  /** Optional notification handler for push notifications. */
  notificationHandler?: NotificationHandler;
  /** Optional HTTP sync handler for peer announce/query/pull routes. */
  syncHttpHandler?: SyncHttpHandler;
  /** Optional custom HTTP handler for additional REST/MCP surfaces. */
  httpHandler?: (request: Request, url: URL) => Promise<Response | null> | Response | null;
  /** Optional hook to enforce device identity lifecycle policy during auth. */
  validateDeviceIdentity?: GatewayDeviceIdentityValidator;
  /** If true, skip authentication (for development/testing only). Default: false. */
  skipAuth?: boolean;
  /** Maximum time in ms a client has to authenticate after connecting. Default: 30000. */
  authTimeoutMs?: number;
  /** Optional health check callback returning subsystem status. */
  healthCheck?: (context?: HealthCheckContext) => Promise<HealthStatus>;
  /** Optional Noise Protocol transport configuration. */
  noise?: NoiseTransportConfig;
  /** Optional logger instance. When provided, the server logs connection lifecycle events and message traffic. */
  logger?: Logger;
  /** Resolve immutable space UID for outbound event envelopes. */
  resolveSpaceUid?: (spaceId: string) => string | undefined | Promise<string | undefined>;
  /** Resolve mutable internal space ID from immutable space UID. */
  resolveSpaceId?: (spaceUid: string) => string | undefined | Promise<string | undefined>;
  /**
   * Allowed CORS origins. Use `["*"]` for dev (allows all).
   * Empty array / omitted = reject cross-origin (no Access-Control-Allow-Origin header emitted).
   */
  allowedOrigins?: string[];
  /**
   * When true, sync endpoints require a non-empty x-spaceskit-sync-secret header.
   * If the header is missing or empty the request is rejected with 401.
   */
  syncRequireSecret?: boolean;
  /** HTTP rate limit: maximum requests per minute per IP. Default: 120. */
  httpRateLimitRpm?: number;
  /** Maximum concurrent connections per IP (WebSocket upgrades). Default: 10. */
  maxConnectionsPerIp?: number;
  /** Maximum WebSocket message payload in bytes. Default: 1MB (1048576). */
  maxPayloadLength?: number;
  /** Optional hook called when a client successfully subscribes to a space, for pre-warming. */
  onSpaceSubscribed?: (spaceId: string) => void;
  /**
   * Optional override for client IP detection on incoming WebSocket upgrades.
   * Defaults to `server.requestIP(req)?.address` with `x-forwarded-for` fallback.
   * Tests use this to simulate remote (non-loopback) origins.
   */
  resolveClientIp?: (req: Request, requestIp: string | undefined) => string;
}

export interface HealthStatus {
  status: "ok" | "degraded" | "error";
  uptime: number;
  clients: number;
  subsystems: Record<string, { status: "ok" | "degraded" | "error"; detail?: string }>;
  degradation?: {
    reasons: Array<{
      subsystem: string;
      status: "degraded" | "error";
      detail?: string;
    }>;
  };
  debug?: Record<string, unknown>;
  metadata?: {
    gatewayId?: string;
    gatewayProfile?: "embedded" | "external";
    gatewayUuid?: string;
    spacesRoot?: string;
    mainSpaceId?: string;
    mainSpaceName?: string;
    mainSpaceResourceId?: string;
    mainAgentId?: string;
    mainProfileId?: string;
    mainAgentStatus?: "healthy" | "repaired" | "fallback" | "degraded";
  };
}

export interface ClientSession {
  id: string;
  authenticated: boolean;
  clientType?: string;
  publicKey?: string;
  deviceId?: string;
  devicePublicKey?: string;
  subscribedSpaces: Set<string>;
  connectedAt: Date;
  /** Pending auth challenge (base64). Cleared after successful auth. */
  pendingChallenge?: string;
  /** Timer ID for auth timeout. */
  authTimeout?: ReturnType<typeof setTimeout>;
  /** Noise Protocol session (present when noise transport is enabled). */
  noiseSession?: {
    /** Whether the Noise handshake is complete. */
    ready: boolean;
    /** Handshake step counter. */
    step: number;
    /** Remote peer's Noise static public key (base64), set after handshake. */
    remotePublicKey?: string;
    /** Encrypt a message for this client. */
    encrypt: (plaintext: Uint8Array) => Promise<Uint8Array>;
    /** Decrypt a message from this client. */
    decrypt: (ciphertext: Uint8Array) => Promise<Uint8Array>;
  };
}

/** Data attached to each WebSocket connection via Bun's ws.data. */
export interface WSData {
  sessionId: string;
  /** Client IP address, used for per-IP connection cap tracking. */
  clientIp: string;
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// HTTP rate limiting — token bucket per IP
// ---------------------------------------------------------------------------

interface IpBucket {
  tokens: number;
  lastRefillMs: number;
  lastActivityMs: number;
}

export class GatewayServer {
  private server: ReturnType<typeof Bun.serve> | null = null;
  private clients = new Map<string, ClientSession>();
  private sockets = new Map<string, ServerWebSocket<WSData>>();
  private eventUnsubscribers: (() => void)[] = [];
  private startedAt = Date.now();
  private log: Logger | null;
  private eventBroadcaster: GatewayEventBroadcaster;
  private isDraining = false;
  private activeTurns = new Set<string>();
  private drainResolve: (() => void) | null = null;

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
    // Evict stale IP buckets every minute to prevent memory growth
    this.ipBucketEvictionTimer = setInterval(() => {
      const cutoff = Date.now() - 10 * 60 * 1000; // 10 minutes idle
      for (const [ip, bucket] of this.ipBuckets) {
        if (bucket.lastActivityMs < cutoff) {
          this.ipBuckets.delete(ip);
        }
      }
    }, 60_000);
    // Don't let this timer hold the process open
    if (this.ipBucketEvictionTimer.unref) {
      this.ipBucketEvictionTimer.unref();
    }
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
        const url = new URL(req.url);

        // Handle CORS preflight before any routing
        if (req.method === "OPTIONS") {
          return self.withCors(req, new Response(null, { status: 204 }));
        }

        // Per-IP HTTP rate limiting — applied before routing to protect all endpoints
        const clientIp = server.requestIP(req)?.address ?? "unknown";
        if (!self.checkHttpRateLimit(clientIp)) {
          return self.withCors(req, new Response(JSON.stringify({ error: "Too many requests" }), {
            status: 429,
            headers: { "Content-Type": "application/json" },
          }));
        }

        // Health check endpoint
        if (url.pathname === "/health") {
          const healthResponse = await handleHealthRequest({
            request: req,
            url,
            healthCheck: self.options.healthCheck,
            snapshot: {
              startedAt: self.startedAt,
              clientCount: self.clients.size,
              draining: self.isDraining,
            },
          });
          return self.withCors(req, healthResponse);
        }

        // A2A protocol endpoints
        if (self.options.a2aHandler) {
          const a2aResponse = await self.options.a2aHandler.handleRequest(req);
          if (a2aResponse) return self.withCors(req, a2aResponse);
        }

        // Sync HTTP endpoints (gateway-to-gateway transport)
        if (url.pathname.startsWith("/sync/")) {
          const syncResponse = await handleSyncHttpRequest(req, url.pathname, self.options);
          return self.withCors(req, syncResponse);
        }

        if (self.options.httpHandler) {
          const handled = await self.options.httpHandler(req, url);
          if (handled) {
            return self.withCors(req, handled);
          }
        }

        // Upgrade to WebSocket
        if (self.isDraining) {
          return self.withCors(req, new Response("Server draining", { status: 503 }));
        }

        // Per-IP connection cap enforcement
        const detectedIp = server.requestIP(req)?.address ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
        const wsClientIp = self.options.resolveClientIp
          ? self.options.resolveClientIp(req, detectedIp)
          : detectedIp;
        const maxConns = self.options.maxConnectionsPerIp ?? 10;
        if ((self.connectionsPerIp.get(wsClientIp) ?? 0) >= maxConns) {
          return self.withCors(req, new Response("Too many connections from this IP", { status: 429 }));
        }

        const sessionId = randomUUID();
        const upgraded = server.upgrade(req, {
          data: { sessionId, clientIp: wsClientIp },
        });

        if (!upgraded) {
          return self.withCors(req, new Response("WebSocket upgrade failed", { status: 400 }));
        }

        return undefined;
      },

      websocket: {
        // Bun's idle timeout in seconds (heartbeat)
        idleTimeout: 120,
        // Max message size — configurable, default 1MB
        maxPayloadLength: self.options.maxPayloadLength ?? 1 * 1024 * 1024,

        open(ws) {
          const data = ws.data as WSData;

          // Track per-IP connection count
          const currentCount = self.connectionsPerIp.get(data.clientIp) ?? 0;
          self.connectionsPerIp.set(data.clientIp, currentCount + 1);

          const challenge = randomBytes(32).toString("base64");
          const session: ClientSession = {
            id: data.sessionId,
            authenticated: self.options.skipAuth === true,
            subscribedSpaces: new Set(),
            connectedAt: new Date(),
            pendingChallenge: self.options.skipAuth ? undefined : challenge,
          };
          self.clients.set(session.id, session);
          self.sockets.set(session.id, ws);

          self.log?.info("Client connected", {
            sessionId: session.id,
            clients: self.clients.size,
          });

          // Register with notification handler if available
          if (self.options.notificationHandler) {
            self.options.notificationHandler.registerClient(session.id, ws);
          }

          if (!self.options.skipAuth) {
            // Send auth challenge
            self.send(session.id, {
              type: MessageTypes.AUTH_CHALLENGE,
              id: randomUUID(),
              ts: new Date().toISOString(),
              payload: { challenge },
            });

            // Set auth timeout - disconnect if not authenticated in time
            const timeoutMs = self.options.authTimeoutMs ?? 30_000;
            session.authTimeout = setTimeout(() => {
              if (!session.authenticated) {
                self.log?.warn("Authentication timeout", {
                  sessionId: session.id,
                  timeoutMs,
                });
                self.sendError(ws, "UNAUTHENTICATED", "Authentication timeout - closing connection", {
                  correlationId: randomUUID(),
                });
                ws.close(4001, "Authentication timeout");
              }
            }, timeoutMs);
          }
        },

        async message(ws, message) {
          const data = ws.data as WSData;
          const session = self.clients.get(data.sessionId);
          if (!session) return;

          try {
            const raw = typeof message === "string" ? message : new TextDecoder().decode(message);
            const msg = JSON.parse(raw) as GatewayMessage;

            self.log?.debug("Message received", {
              sessionId: session.id,
              type: msg.type,
              msgId: msg.id,
              authenticated: session.authenticated,
              bytes: raw.length,
            });

            await self.handleMessage(session, ws, msg);
          } catch (err) {
            self.log?.warn("Failed to parse message", {
              sessionId: session.id,
              error: err instanceof Error ? err.message : String(err),
            });
            self.sendError(ws, "INVALID_ARGUMENT", "Invalid message format", {
              details: err,
              correlationId: randomUUID(),
            });
          }
        },

        close(ws) {
          const data = ws.data as WSData;

          // Decrement per-IP connection count
          const remaining = (self.connectionsPerIp.get(data.clientIp) ?? 1) - 1;
          if (remaining <= 0) {
            self.connectionsPerIp.delete(data.clientIp);
          } else {
            self.connectionsPerIp.set(data.clientIp, remaining);
          }

          const session = self.clients.get(data.sessionId);
          if (session) {
            const durationMs = Date.now() - session.connectedAt.getTime();
            self.log?.info("Client disconnected", {
              sessionId: session.id,
              clientType: session.clientType,
              authenticated: session.authenticated,
              subscribedSpaces: Array.from(session.subscribedSpaces),
              durationMs,
              clients: self.clients.size - 1,
            });

            self.options.onClientClose?.(session);
            // Clear auth timeout
            if (session.authTimeout) {
              clearTimeout(session.authTimeout);
            }
            // Unsubscribe from all space topics
            for (const spaceUid of session.subscribedSpaces) {
              ws.unsubscribe(`space:${spaceUid}`);
            }
          }
          // Unregister from notification handler
          if (self.options.notificationHandler) {
            self.options.notificationHandler.unregisterClient(data.sessionId);
          }

          self.clients.delete(data.sessionId);
          self.sockets.delete(data.sessionId);
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
          && this.isAddressInUseError(err)
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
    this.activeTurns.clear();
    this.drainResolve = null;

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
    this.activeTurns.add(turnId);
  }

  /** Mark a turn as completed. If draining and no more active turns, resolve early. */
  completeTurn(turnId: string): void {
    this.activeTurns.delete(turnId);
    if (this.isDraining && this.activeTurns.size === 0 && this.drainResolve) {
      this.drainResolve();
      this.drainResolve = null;
    }
  }

  /** Number of currently active turns. */
  get activeTurnCount(): number {
    return this.activeTurns.size;
  }

  /**
   * Enter drain mode: stop accepting new connections and requests, then wait
   * for in-flight activity to complete (up to timeoutMs) before the caller
   * proceeds with stop().
   */
  async drain(timeoutMs: number = 10000): Promise<void> {
    this.isDraining = true;
    this.log?.info("Server entering drain mode", {
      timeoutMs,
      clients: this.clients.size,
      activeTurns: this.activeTurns.size,
    });
    // Skip waiting when no active clients and no active turns
    if (this.clients.size === 0 && this.activeTurns.size === 0) return;
    // If no active turns, skip waiting for turn completion
    if (this.activeTurns.size === 0) return;

    await new Promise<void>((resolve) => {
      this.drainResolve = resolve;
      setTimeout(() => {
        this.drainResolve = null;
        resolve();
      }, timeoutMs);
    });

    this.log?.info("Drain complete", {
      remainingTurns: this.activeTurns.size,
      timedOut: this.activeTurns.size > 0,
    });
  }

  get clientCount(): number {
    return this.clients.size;
  }

  get port(): number {
    return this.server?.port ?? this.options.port;
  }

  /** Disconnect all authenticated sessions bound to a specific device ID (optionally scoped by principal). */
  disconnectSessionsByDevice(deviceId: string, principalId?: string): number {
    const normalizedDeviceId = deviceId.trim();
    if (!normalizedDeviceId) return 0;
    const normalizedPrincipalId = principalId?.trim() || undefined;

    let disconnected = 0;
    for (const [sessionId, session] of this.clients) {
      if (session.deviceId !== normalizedDeviceId) continue;
      if (normalizedPrincipalId && session.publicKey !== normalizedPrincipalId) continue;
      const ws = this.sockets.get(sessionId);
      if (!ws) continue;
      ws.close(4003, "Device revoked");
      disconnected += 1;
    }

    if (disconnected > 0) {
      this.log?.warn("Disconnected sessions for revoked device", {
        deviceId: normalizedDeviceId,
        principalId: normalizedPrincipalId,
        disconnected,
      });
    }

    return disconnected;
  }

  /** Send a message to a specific client. */
  send(clientId: string, msg: GatewayMessage): void {
    const ws = this.sockets.get(clientId);
    if (ws) {
      ws.send(JSON.stringify(msg));
    }
  }

  sendToIdentity(principalId: string, deviceId: string | undefined, msg: GatewayMessage): number {
    const normalizedPrincipalId = principalId.trim();
    const normalizedDeviceId = deviceId?.trim() || undefined;
    if (!normalizedPrincipalId) {
      return 0;
    }

    const exactMatches: string[] = [];
    const principalMatches: string[] = [];
    for (const [sessionId, session] of this.clients) {
      if (!session.authenticated || session.publicKey !== normalizedPrincipalId) {
        continue;
      }
      principalMatches.push(sessionId);
      if (normalizedDeviceId && session.deviceId === normalizedDeviceId) {
        exactMatches.push(sessionId);
      }
    }

    const targets = exactMatches.length > 0 ? exactMatches : principalMatches;
    for (const sessionId of targets) {
      this.send(sessionId, msg);
    }
    return targets.length;
  }

  /** Broadcast a message to all clients subscribed to a space UID via Bun's pub/sub. */
  broadcastToSpace(spaceUid: string, msg: GatewayMessage): void {
    this.server?.publish(`space:${spaceUid}`, JSON.stringify(msg));
  }

  // ---------------------------------------------------------------------------
  // CORS
  // ---------------------------------------------------------------------------

  /** Attach CORS headers from the computed map to an existing Response. */
  private withCors(req: Request, res: Response): Response {
    return attachCorsHeaders(req, res, this.options.allowedOrigins);
  }

  // ---------------------------------------------------------------------------
  // HTTP rate limiting
  // ---------------------------------------------------------------------------

  /**
   * Consume one token for the given IP.
   * Returns true when the request is allowed, false when it should be rejected.
   */
  private checkHttpRateLimit(ip: string): boolean {
    const rpm = this.options.httpRateLimitRpm ?? 120;
    const now = Date.now();
    const refillIntervalMs = 60_000 / rpm; // ms per token

    let bucket = this.ipBuckets.get(ip);
    if (!bucket) {
      bucket = { tokens: rpm, lastRefillMs: now, lastActivityMs: now };
      this.ipBuckets.set(ip, bucket);
    }

    // Refill tokens based on elapsed time
    const elapsed = now - bucket.lastRefillMs;
    if (elapsed > 0) {
      const refilled = Math.floor(elapsed / refillIntervalMs);
      if (refilled > 0) {
        bucket.tokens = Math.min(rpm, bucket.tokens + refilled);
        bucket.lastRefillMs = now;
      }
    }

    bucket.lastActivityMs = now;

    if (bucket.tokens <= 0) {
      return false;
    }

    bucket.tokens -= 1;
    return true;
  }

  // ---------------------------------------------------------------------------
  // Message handling
  // ---------------------------------------------------------------------------

  private isAddressInUseError(err: unknown): boolean {
    const code = typeof err === "object" && err !== null && "code" in err
      ? (err as { code?: unknown }).code
      : undefined;
    if (code === "EADDRINUSE") return true;

    const message = err instanceof Error ? err.message : String(err);
    const normalized = message.toLowerCase();
    return normalized.includes("eaddrinuse")
      || normalized.includes("address already in use")
      || normalized.includes("port is in use");
  }

  private async handleMessage(
    session: ClientSession,
    ws: ServerWebSocket<WSData>,
    msg: GatewayMessage,
  ): Promise<void> {
    // Handle ping/pong without authentication
    if (msg.type === MessageTypes.PING) {
      this.send(session.id, {
        type: MessageTypes.PONG,
        id: randomUUID(),
        replyTo: msg.id,
        ts: new Date().toISOString(),
        payload: {},
      });
      return;
    }

    // Handle authentication
    if (msg.type === MessageTypes.AUTHENTICATE) {
      await handleGatewayAuthenticate({
        session,
        ws,
        msg,
        clients: this.clients,
        sockets: this.sockets,
        send: (clientId, message) => this.send(clientId, message),
        eventBus: this.options.eventBus,
        validateDeviceIdentity: this.options.validateDeviceIdentity,
        logger: this.log,
      });
      return;
    }

    // Reject all other messages from unauthenticated clients
    if (!session.authenticated) {
      this.log?.warn("Unauthenticated message rejected", {
        sessionId: session.id,
        type: msg.type,
      });
      this.sendError(ws, "UNAUTHENTICATED", "Authentication required before sending messages", {
        replyTo: msg.id,
        correlationId: msg.id,
      });
      return;
    }

    // Handle subscribe — uses Bun's native pub/sub topics
    if (msg.type === MessageTypes.SUBSCRIBE) {
      const normalizedSubscribe = normalizeSubscribePayload(msg.payload);
      if (!normalizedSubscribe.ok) {
        this.sendError(ws, "INVALID_ARGUMENT", normalizedSubscribe.message, {
          replyTo: msg.id,
          correlationId: msg.id,
        });
        return;
      }

      const requestedSpaceUids = normalizedSubscribe.spaceUids;
      const subscribedSpaceUids: string[] = [];
      const denied: SubscribeResponsePayload["denied"] = [];

      for (const spaceUid of requestedSpaceUids) {
        let resolvedSpaceId: string | undefined;
        if (this.options.resolveSpaceId) {
          try {
            const candidate = await this.options.resolveSpaceId(spaceUid);
            if (typeof candidate === "string" && candidate.trim().length > 0) {
              resolvedSpaceId = candidate.trim();
            }
          } catch (error) {
            this.log?.warn("Space ID resolution hook failed", {
              sessionId: session.id,
              spaceUid,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }

        let decision: SubscribeAuthorizationResult = { allowed: true };
        if (this.options.authorizeSubscribe) {
          try {
            decision = await this.options.authorizeSubscribe({
              client: session,
              spaceUid,
              spaceId: resolvedSpaceId,
            });
          } catch (error) {
            this.log?.warn("Subscription authorization hook failed", {
              sessionId: session.id,
              spaceUid,
              spaceId: resolvedSpaceId,
              error: error instanceof Error ? error.message : String(error),
            });
            decision = { allowed: false, reason: "Subscription authorization failed" };
          }
        }

        if (!decision.allowed) {
          denied.push({
            spaceUid,
            reason: decision.reason?.trim() || "Access denied for subscription",
          });
          continue;
        }

        session.subscribedSpaces.add(spaceUid);
        ws.subscribe(`space:${spaceUid}`);
        subscribedSpaceUids.push(spaceUid);

        // Trigger pre-warming for the resolved internal space ID
        if (resolvedSpaceId && this.options.onSpaceSubscribed) {
          try {
            this.options.onSpaceSubscribed(resolvedSpaceId);
          } catch {
            // Pre-warming is best-effort
          }
        }
      }

      this.log?.info("Client subscribe request handled", {
        sessionId: session.id,
        requestedSpaceUids,
        subscribedSpaceUids,
        deniedCount: denied.length,
      });

      this.send(session.id, buildSubscribeResponseMessage({
        replyTo: msg.id,
        subscribedSpaceUids,
        denied,
      }));
      return;
    }

    if (msg.type === MessageTypes.SUBSCRIBE_NOTIFICATIONS) {
      const notificationHandler = this.options.notificationHandler;
      if (!notificationHandler || typeof notificationHandler.subscribeClient !== "function") {
        this.sendError(ws, "NOT_AVAILABLE", "Notification subscriptions are not configured", {
          replyTo: msg.id,
          correlationId: msg.id,
        });
        return;
      }
      const subscribed = await notificationHandler.subscribeClient(
        session.id,
        normalizeNotificationCategories(msg.payload),
      );
      this.send(session.id, buildNotificationSubscriptionResponseMessage({
        type: MessageTypes.SUBSCRIBE_NOTIFICATIONS,
        replyTo: msg.id,
        categories: subscribed,
      }));
      return;
    }

    if (msg.type === MessageTypes.UNSUBSCRIBE_NOTIFICATIONS) {
      const notificationHandler = this.options.notificationHandler;
      if (!notificationHandler || typeof notificationHandler.unsubscribeClient !== "function") {
        this.sendError(ws, "NOT_AVAILABLE", "Notification subscriptions are not configured", {
          replyTo: msg.id,
          correlationId: msg.id,
        });
        return;
      }
      const unsubscribed = await notificationHandler.unsubscribeClient(
        session.id,
        normalizeNotificationCategories(msg.payload),
      );
      this.send(session.id, buildNotificationSubscriptionResponseMessage({
        type: MessageTypes.UNSUBSCRIBE_NOTIFICATIONS,
        replyTo: msg.id,
        categories: unsubscribed,
      }));
      return;
    }

    // Drain mode: reject new turn requests while shutting down
    if (this.isDraining) {
      this.sendError(ws, "UNAVAILABLE", "Server shutting down", {
        replyTo: msg.id,
        correlationId: msg.id,
      });
      return;
    }

    // Delegate to application handler
    if (this.options.onMessage) {
      const response = await this.options.onMessage(session, msg);
      if (response) {
        this.log?.debug("Response sent", {
          sessionId: session.id,
          requestType: msg.type,
          responseType: response.type,
          replyTo: msg.id,
        });
        this.send(session.id, response);
      }
    }
  }

  private async broadcastEvent(event: GatewayEvent): Promise<void> {
    await this.eventBroadcaster.broadcastEvent(event);
  }

  private resolveTurnAgentId(
    eventRecord: Record<string, unknown>,
    turnEvent?: Record<string, unknown>,
  ): string {
    return resolveGatewayTurnAgentId(eventRecord, turnEvent);
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

}
