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
import { deterministicUuid, normalizeUuid } from "./uuid.js";
import {
  MessageTypes,
  type GatewayMessage,
  type ErrorPayload,
  type AuthenticatePayload,
  type SubscribePayload,
  type SubscribeResponsePayload,
  type SyncAnnouncePayload,
  type SyncAnnounceResponsePayload,
  type SyncQueryResourcesPayload,
  type SyncQueryResourcesResponsePayload,
  type SyncPullResourcesPayload,
  type SyncPullResourcesResponsePayload,
  type AgentActivityState,
  type TurnEventPayload,
  type TurnStreamPayload,
  type TypedTurnEventPayload,
} from "./protocol.js";
import { buildGatewayErrorPayload } from "./error-contract.js";
import type { A2AHandler } from "./a2a/a2a-handler.js";
import type { NotificationHandler } from "./notification-handler.js";

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

export interface SyncHttpError {
  code?: string;
  message?: string;
}

export interface SyncHttpHandler {
  announce: (
    payload: SyncAnnouncePayload,
    authSecret?: string,
  ) => Promise<SyncAnnounceResponsePayload> | SyncAnnounceResponsePayload;
  query: (
    payload: SyncQueryResourcesPayload,
    authSecret?: string,
  ) => Promise<SyncQueryResourcesResponsePayload> | SyncQueryResourcesResponsePayload;
  pull: (
    payload: SyncPullResourcesPayload,
    authSecret?: string,
  ) => Promise<SyncPullResourcesResponsePayload> | SyncPullResourcesResponsePayload;
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
  validateDeviceIdentity?: (input: {
    principalId: string;
    deviceId: string;
    devicePublicKey: string;
    platform?: string;
  }) => { allowed: boolean; reason?: string };
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

function parseHealthDebugQuery(url: URL): boolean {
  const value = url.searchParams.get("debug");
  if (value === null) return false;
  const normalized = value.trim().toLowerCase();
  if (normalized.length === 0) return true;
  return normalized === "1"
    || normalized === "true"
    || normalized === "yes"
    || normalized === "on";
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
  private spaceUidBySpaceId = new Map<string, string>();
  private sanitizationPassCount = 0;
  private sanitizationFailCount = 0;
  private isDraining = false;
  private activeTurns = new Set<string>();
  private drainResolve: (() => void) | null = null;

  // Fast-path streaming: monotonic counter + cached timestamp
  private streamSeqCounter = 0;
  private streamTsCache: string = "";
  private streamTsCacheMs = 0;

  // Per-IP WebSocket connection counter for connection cap enforcement
  private connectionsPerIp = new Map<string, number>();

  // Per-IP token buckets for HTTP rate limiting
  private ipBuckets = new Map<string, IpBucket>();
  private ipBucketEvictionTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private options: GatewayServerOptions) {
    this.log = options.logger ?? null;
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
          if (self.options.healthCheck) {
            try {
              const health = await self.options.healthCheck({
                debug: parseHealthDebugQuery(url),
                request: req,
                url,
              });
              const statusCode = health.status === "ok" ? 200 : health.status === "degraded" ? 200 : 503;
              return self.withCors(req, new Response(JSON.stringify({ ...health, draining: self.isDraining }), {
                status: statusCode,
                headers: { "Content-Type": "application/json" },
              }));
            } catch (healthErr) {
              return self.withCors(req, new Response(JSON.stringify({
                status: "error",
                error: healthErr instanceof Error ? healthErr.message : "Health check failed",
                uptime: Math.floor((Date.now() - self.startedAt) / 1000),
                clients: self.clients.size,
                draining: self.isDraining,
              }), {
                status: 503,
                headers: { "Content-Type": "application/json" },
              }));
            }
          }
          // Fallback minimal health response
          return self.withCors(req, new Response(JSON.stringify({
            status: "ok",
            uptime: Math.floor((Date.now() - self.startedAt) / 1000),
            clients: self.clients.size,
            draining: self.isDraining,
          }), {
            headers: { "Content-Type": "application/json" },
          }));
        }

        // A2A protocol endpoints
        if (self.options.a2aHandler) {
          const a2aResponse = await self.options.a2aHandler.handleRequest(req);
          if (a2aResponse) return self.withCors(req, a2aResponse);
        }

        // Sync HTTP endpoints (gateway-to-gateway transport)
        if (url.pathname.startsWith("/sync/")) {
          const syncResponse = await self.handleSyncHttpRequest(req, url.pathname);
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
        const wsClientIp = server.requestIP(req)?.address ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
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

  /**
   * Compute the CORS headers appropriate for the given request.
   * Returns an empty record when the request has no Origin header
   * or when no origins are configured.
   */
  private corsHeaders(req: Request): Record<string, string> {
    const allowedOrigins = this.options.allowedOrigins;
    if (!allowedOrigins || allowedOrigins.length === 0) {
      return {};
    }

    const requestOrigin = req.headers.get("Origin");
    if (!requestOrigin) {
      return {};
    }

    if (allowedOrigins.includes("*")) {
      return {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, x-spaceskit-sync-secret",
      };
    }

    if (allowedOrigins.includes(requestOrigin)) {
      return {
        "Access-Control-Allow-Origin": requestOrigin,
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, x-spaceskit-sync-secret",
        "Vary": "Origin",
      };
    }

    return {};
  }

  /** Attach CORS headers from the computed map to an existing Response. */
  private withCors(req: Request, res: Response): Response {
    const headers = this.corsHeaders(req);
    if (Object.keys(headers).length === 0) return res;
    const merged = new Headers(res.headers);
    for (const [k, v] of Object.entries(headers)) {
      merged.set(k, v);
    }
    return new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers: merged,
    });
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
      await this.handleAuthenticate(session, ws, msg);
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
      const payload = msg.payload as SubscribePayload;
      if (!Array.isArray(payload?.spaceUids)) {
        this.sendError(ws, "INVALID_ARGUMENT", "spaceUids[] is required", {
          replyTo: msg.id,
          correlationId: msg.id,
        });
        return;
      }

      const requestedSpaceUids = Array.from(
        new Set(
          payload.spaceUids
            .filter((spaceUid): spaceUid is string => typeof spaceUid === "string")
            .map((spaceUid) => spaceUid.trim())
            .filter((spaceUid) => spaceUid.length > 0),
        ),
      );

      if (requestedSpaceUids.length === 0) {
        this.sendError(ws, "INVALID_ARGUMENT", "spaceUids[] must include at least one valid spaceUid", {
          replyTo: msg.id,
          correlationId: msg.id,
        });
        return;
      }

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

      this.send(session.id, {
        type: MessageTypes.SUBSCRIBE,
        id: randomUUID(),
        replyTo: msg.id,
        ts: new Date().toISOString(),
        payload: {
          subscribedSpaceUids,
          denied,
        } satisfies SubscribeResponsePayload,
      });
      return;
    }

    if (msg.type === MessageTypes.SUBSCRIBE_NOTIFICATIONS) {
      if (!this.options.notificationHandler || typeof (this.options.notificationHandler as any).subscribeClient !== "function") {
        this.sendError(ws, "NOT_AVAILABLE", "Notification subscriptions are not configured", {
          replyTo: msg.id,
          correlationId: msg.id,
        });
        return;
      }
      const payload = msg.payload as { categories?: unknown };
      const categories = Array.isArray(payload?.categories)
        ? payload.categories.filter((entry): entry is string => typeof entry === "string")
        : [];
      const subscribed = await (this.options.notificationHandler as any).subscribeClient(session.id, categories);
      this.send(session.id, {
        type: MessageTypes.SUBSCRIBE_NOTIFICATIONS,
        id: randomUUID(),
        replyTo: msg.id,
        ts: new Date().toISOString(),
        payload: {
          categories: subscribed,
        },
      });
      return;
    }

    if (msg.type === MessageTypes.UNSUBSCRIBE_NOTIFICATIONS) {
      if (!this.options.notificationHandler || typeof (this.options.notificationHandler as any).unsubscribeClient !== "function") {
        this.sendError(ws, "NOT_AVAILABLE", "Notification subscriptions are not configured", {
          replyTo: msg.id,
          correlationId: msg.id,
        });
        return;
      }
      const payload = msg.payload as { categories?: unknown };
      const categories = Array.isArray(payload?.categories)
        ? payload.categories.filter((entry): entry is string => typeof entry === "string")
        : [];
      const unsubscribed = await (this.options.notificationHandler as any).unsubscribeClient(session.id, categories);
      this.send(session.id, {
        type: MessageTypes.UNSUBSCRIBE_NOTIFICATIONS,
        id: randomUUID(),
        replyTo: msg.id,
        ts: new Date().toISOString(),
        payload: {
          categories: unsubscribed,
        },
      });
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

  /**
   * Verify Ed25519 challenge-response authentication.
   *
   * Flow:
   * 1. Server sends AUTH_CHALLENGE with random 32-byte challenge (base64) on connect
   * 2. Client signs challenge with Ed25519 private key
   * 3. Client sends AUTHENTICATE with { publicKey, signature, clientType, clientVersion }
   * 4. Server verifies signature against challenge using the provided public key
   * 5. Server sends AUTH_RESULT with success/failure
   */
  private async handleAuthenticate(
    session: ClientSession,
    ws: ServerWebSocket<WSData>,
    msg: GatewayMessage,
  ): Promise<void> {
    if (session.authenticated) {
      this.send(session.id, {
        type: MessageTypes.AUTH_RESULT,
        id: randomUUID(),
        replyTo: msg.id,
        ts: new Date().toISOString(),
        payload: { success: true, reason: "Already authenticated" },
      });
      return;
    }

    const payload = msg.payload as AuthenticatePayload;

    if (!payload.publicKey || !payload.signature || !session.pendingChallenge) {
      this.send(session.id, {
        type: MessageTypes.AUTH_RESULT,
        id: randomUUID(),
        replyTo: msg.id,
        ts: new Date().toISOString(),
        payload: { success: false, reason: "Missing publicKey, signature, or no pending challenge" },
      });
      return;
    }

    try {
      // Verify Ed25519 signature using Bun's native crypto
      const challengeBytes = Buffer.from(session.pendingChallenge, "base64");
      const signatureBytes = Buffer.from(payload.signature, "base64");
      const publicKeyBytes = Buffer.from(payload.publicKey, "base64");
      const deviceId = payload.deviceId?.trim() || undefined;
      const devicePublicKey = payload.devicePublicKey?.trim() || undefined;
      const deviceProofSignature = payload.deviceProofSignature?.trim() || undefined;
      const hasAnyDeviceAuth = Boolean(deviceId || devicePublicKey || deviceProofSignature);
      const requiresDeviceValidation = typeof this.options.validateDeviceIdentity === "function";
      let effectiveDeviceId = deviceId;
      let effectiveDevicePublicKey = devicePublicKey;
      let effectiveDeviceProofSignature = deviceProofSignature;

      // Use Ed25519 verify — Bun supports this natively via crypto
      const isValid = await this.verifyEd25519(challengeBytes, signatureBytes, publicKeyBytes);

      if (isValid) {
        if (hasAnyDeviceAuth && (!deviceId || !devicePublicKey || !deviceProofSignature)) {
          this.send(session.id, {
            type: MessageTypes.AUTH_RESULT,
            id: randomUUID(),
            replyTo: msg.id,
            ts: new Date().toISOString(),
            payload: {
              success: false,
              reason: "deviceId, devicePublicKey, and deviceProofSignature are required together",
            },
          });
          return;
        }

        // Explicit device auth fields are required when a device validator is
        // configured. No compatibility fallback — clients must supply all fields.
        if (requiresDeviceValidation && !hasAnyDeviceAuth) {
          this.send(session.id, {
            type: MessageTypes.AUTH_RESULT,
            id: randomUUID(),
            replyTo: msg.id,
            ts: new Date().toISOString(),
            payload: {
              success: false,
              reason: "Explicit device auth fields required",
            },
          });
          return;
        }

        if (effectiveDeviceId && effectiveDevicePublicKey && effectiveDeviceProofSignature) {
          const deviceProofBytes = Buffer.from(effectiveDeviceProofSignature, "base64");
          const devicePublicKeyBytes = Buffer.from(effectiveDevicePublicKey, "base64");
          const deviceProofValid = await this.verifyEd25519(
            challengeBytes,
            deviceProofBytes,
            devicePublicKeyBytes,
          );

          if (!deviceProofValid) {
            this.log?.warn("Authentication failed: invalid device proof signature", {
              sessionId: session.id,
              clientType: payload.clientType,
              deviceId: effectiveDeviceId,
            });

            this.send(session.id, {
              type: MessageTypes.AUTH_RESULT,
              id: randomUUID(),
              replyTo: msg.id,
              ts: new Date().toISOString(),
              payload: { success: false, reason: "Invalid device proof signature" },
            });
            return;
          }

          if (this.options.validateDeviceIdentity) {
            const validation = this.options.validateDeviceIdentity({
              principalId: payload.publicKey,
              deviceId: effectiveDeviceId,
              devicePublicKey: effectiveDevicePublicKey,
              platform: payload.clientType,
            });
            if (!validation.allowed) {
              this.log?.warn("Authentication failed: device validation denied", {
                sessionId: session.id,
                clientType: payload.clientType,
                deviceId: effectiveDeviceId,
                reason: validation.reason,
              });
              this.send(session.id, {
                type: MessageTypes.AUTH_RESULT,
                id: randomUUID(),
                replyTo: msg.id,
                ts: new Date().toISOString(),
                payload: { success: false, reason: validation.reason ?? "Device validation failed" },
              });
              return;
            }
          }
        } else if (requiresDeviceValidation) {
          this.send(session.id, {
            type: MessageTypes.AUTH_RESULT,
            id: randomUUID(),
            replyTo: msg.id,
            ts: new Date().toISOString(),
            payload: {
              success: false,
              reason: "Device identity is required for authentication",
            },
          });
          return;
        }

        const identityKey = this.buildClientIdentityKey(payload.publicKey, effectiveDeviceId);
        const superseded = this.supersedeDuplicateSessions(identityKey, session.id);
        if (superseded > 0) {
          this.log?.warn("Superseded duplicate authenticated sessions", {
            sessionId: session.id,
            clientType: payload.clientType,
            publicKey: payload.publicKey.slice(0, 12) + "...",
            deviceId: effectiveDeviceId,
            superseded,
          });
        }

        session.authenticated = true;
        session.publicKey = payload.publicKey;
        session.clientType = payload.clientType;
        session.deviceId = effectiveDeviceId;
        session.devicePublicKey = effectiveDevicePublicKey;
        session.pendingChallenge = undefined;

        // Clear auth timeout
        if (session.authTimeout) {
          clearTimeout(session.authTimeout);
          session.authTimeout = undefined;
        }

        const authDurationMs = Date.now() - session.connectedAt.getTime();
        this.log?.info("Client authenticated", {
          sessionId: session.id,
          clientType: payload.clientType,
          publicKey: payload.publicKey.slice(0, 12) + "...",
          deviceId: session.deviceId,
          authDurationMs,
        });

        this.options.eventBus.emit({
          type: "client.authenticated",
          sessionId: session.id,
          clientType: payload.clientType,
          publicKey: payload.publicKey,
          timestamp: new Date(),
        });

        this.send(session.id, {
          type: MessageTypes.AUTH_RESULT,
          id: randomUUID(),
          replyTo: msg.id,
          ts: new Date().toISOString(),
          payload: { success: true },
        });
      } else {
        this.log?.warn("Authentication failed: invalid signature", {
          sessionId: session.id,
          clientType: payload.clientType,
        });

        this.send(session.id, {
          type: MessageTypes.AUTH_RESULT,
          id: randomUUID(),
          replyTo: msg.id,
          ts: new Date().toISOString(),
          payload: { success: false, reason: "Invalid signature" },
        });
      }
    } catch (err) {
      this.send(session.id, {
        type: MessageTypes.AUTH_RESULT,
        id: randomUUID(),
        replyTo: msg.id,
        ts: new Date().toISOString(),
        payload: {
          success: false,
          reason: `Authentication error: ${err instanceof Error ? err.message : String(err)}`,
        },
      });
    }
  }

  /**
   * Verify an Ed25519 signature using the Web Crypto API.
   * Works in both Bun and Node.js 20+ environments.
   */
  private async verifyEd25519(
    message: Uint8Array,
    signature: Uint8Array,
    publicKey: Uint8Array,
  ): Promise<boolean> {
    try {
      // Copy into fresh ArrayBuffer to satisfy strict TypeScript BufferSource checks
      const keyBuf = new Uint8Array(publicKey).buffer as ArrayBuffer;
      const sigBuf = new Uint8Array(signature).buffer as ArrayBuffer;
      const msgBuf = new Uint8Array(message).buffer as ArrayBuffer;

      // Import the raw Ed25519 public key
      const cryptoKey = await crypto.subtle.importKey(
        "raw",
        keyBuf,
        { name: "Ed25519" },
        false,
        ["verify"],
      );

      // Verify the signature
      return await crypto.subtle.verify(
        "Ed25519",
        cryptoKey,
        sigBuf,
        msgBuf,
      );
    } catch {
      return false;
    }
  }

  private buildClientIdentityKey(publicKeyRaw: string, deviceIdRaw?: string): string | null {
    const principalId = publicKeyRaw.trim();
    if (!principalId) return null;
    const deviceId = deviceIdRaw?.trim();
    if (deviceId) {
      return `principal:${principalId}|device:${deviceId}`;
    }
    return `principal:${principalId}`;
  }

  private sessionIdentityKey(session: ClientSession): string | null {
    if (!session.authenticated || !session.publicKey) {
      return null;
    }
    return this.buildClientIdentityKey(session.publicKey, session.deviceId);
  }

  private supersedeDuplicateSessions(identityKey: string | null, keepSessionId: string): number {
    if (!identityKey) return 0;

    let superseded = 0;
    for (const [sessionId, existingSession] of this.clients) {
      if (sessionId === keepSessionId) continue;
      if (this.sessionIdentityKey(existingSession) !== identityKey) continue;

      const ws = this.sockets.get(sessionId);
      if (!ws) continue;

      const correlationId = randomUUID();
      const payload: ErrorPayload = buildGatewayErrorPayload(
        "SESSION_SUPERSEDED",
        "Session superseded by newer connection",
        correlationId,
        undefined,
        false,
      );
      this.send(sessionId, {
        type: MessageTypes.ERROR,
        id: randomUUID(),
        ts: new Date().toISOString(),
        payload,
      });

      setTimeout(() => {
        ws.close(4004, "Session superseded by newer connection");
      }, 0);
      superseded += 1;
    }

    return superseded;
  }

  /**
   * Synchronous fast-path for resolveSpaceUid — returns the cached value
   * directly from the spaceUidBySpaceId Map without any async work.
   * Returns undefined on cache miss (caller should fall back to async).
   */
  private resolveSpaceUidSync(spaceId: string): string | undefined {
    return this.spaceUidBySpaceId.get(spaceId);
  }

  private nextStreamId(): string {
    return `s-${++this.streamSeqCounter}`;
  }

  private getStreamTimestamp(): string {
    const now = Date.now();
    if (now - this.streamTsCacheMs > 1000) {
      this.streamTsCache = new Date(now).toISOString();
      this.streamTsCacheMs = now;
    }
    return this.streamTsCache;
  }

  private async resolveSpaceUid(spaceIdRaw: string): Promise<string> {
    const spaceId = spaceIdRaw.trim();
    if (!spaceId) return deterministicUuid("unknown-space", "spaceskit.space.uuid");
    const cached = this.spaceUidBySpaceId.get(spaceId);
    if (cached) return cached;
    const fallback = deterministicUuid(spaceId, "spaceskit.space.uuid");

    if (!this.options.resolveSpaceUid) {
      this.spaceUidBySpaceId.set(spaceId, fallback);
      return fallback;
    }
    try {
      const resolved = await this.options.resolveSpaceUid(spaceId);
      const normalized = normalizeUuid(resolved);
      if (normalized) {
        this.spaceUidBySpaceId.set(spaceId, normalized);
        return normalized;
      }
    } catch {
      // UID enrichment is best-effort; emit deterministic UUID if resolution fails.
      return fallback;
    }
    this.spaceUidBySpaceId.set(spaceId, fallback);
    return fallback;
  }

  private normalizeEventPayload(value: unknown): unknown {
    if (value instanceof Date) {
      return value.toISOString();
    }

    if (value instanceof Error) {
      const code = (value as { code?: unknown }).code;
      return {
        name: value.name,
        message: value.message,
        ...(value.stack ? { stack: value.stack } : {}),
        ...(typeof code === "string" || typeof code === "number" ? { code } : {}),
      };
    }

    if (Array.isArray(value)) {
      return value.map((entry) => this.normalizeEventPayload(entry));
    }

    if (value && typeof value === "object") {
      const normalized: Record<string, unknown> = {};
      for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
        normalized[key] = this.normalizeEventPayload(entry);
      }
      return normalized;
    }

    return value;
  }

  private async broadcastEvent(event: GatewayEvent): Promise<void> {
    // Fast path: text_delta events skip normalizeEventPayload entirely
    const rawEvent = event as Record<string, unknown>;
    const innerEvent = rawEvent.event as Record<string, unknown> | undefined;
    if (
      innerEvent &&
      typeof innerEvent.type === "string" &&
      innerEvent.type === "text_delta"
    ) {
      const spaceId =
        typeof rawEvent.spaceId === "string"
          ? (rawEvent.spaceId as string).trim()
          : "";
      if (!spaceId) return;

      // Try sync resolution first, fall back to async only on miss
      let spaceUid = this.resolveSpaceUidSync(spaceId);
      if (!spaceUid) {
        spaceUid = await this.resolveSpaceUid(spaceId);
      }

      const turnId =
        typeof rawEvent.turnId === "string"
          ? (rawEvent.turnId as string)
          : "";
      const payload: TurnStreamPayload = {
        spaceId,
        spaceUid,
        turnId,
        agentId: this.resolveTurnAgentId(rawEvent, innerEvent),
        delta:
          typeof innerEvent.text === "string"
            ? (innerEvent.text as string)
            : "",
        seq: this.coerceInteger(innerEvent.seq ?? rawEvent.seq, 0),
        done: this.coerceBoolean(innerEvent.done, false),
      };

      this.broadcastToSpace(spaceUid, {
        type: MessageTypes.TURN_STREAM,
        id: this.nextStreamId(),
        ts: this.getStreamTimestamp(),
        payload,
      });
      return;
    }

    // Normal path: normalize payload (handles Date/Error objects)
    const eventRecord = this.normalizeEventPayload(event) as Record<string, unknown>;
    const spaceId = typeof eventRecord.spaceId === "string" ? eventRecord.spaceId.trim() : "";
    if (!spaceId) return;
    const spaceUid = await this.resolveSpaceUid(spaceId);
    const normalizedType = typeof eventRecord.type === "string" ? eventRecord.type : "";

    if (normalizedType === "space.orchestrator_event") {
      const createdAt = typeof eventRecord.createdAt === "string"
        ? eventRecord.createdAt
        : new Date().toISOString();
      const turnId = typeof eventRecord.turnId === "string" ? eventRecord.turnId : "";
      const commandId = typeof eventRecord.commandId === "string"
        ? eventRecord.commandId
        : turnId
          ? `summary-${turnId}`
          : `summary-${randomUUID()}`;
      const correlationId = typeof eventRecord.correlationId === "string"
        ? eventRecord.correlationId
        : turnId || commandId;
      const status = typeof eventRecord.status === "string"
        ? eventRecord.status
        : "completed";
      const eventType = typeof eventRecord.eventType === "string"
        ? eventRecord.eventType
        : "summary.completed";
      const eventPayload = (eventRecord.event && typeof eventRecord.event === "object")
        ? eventRecord.event as Record<string, unknown>
        : { type: eventType };

      this.broadcastToSpace(spaceUid, {
        type: MessageTypes.ORCHESTRATOR_EVENT,
        id: randomUUID(),
        ts: new Date().toISOString(),
        payload: {
          commandId,
          correlationId,
          status,
          event: eventPayload,
          createdAt,
          eventType,
          spaceId,
          spaceUid,
          turnId,
        },
      });
      return;
    }

    const turnId = typeof eventRecord.turnId === "string" ? eventRecord.turnId : "";
    const turnEvent = eventRecord.event as Record<string, unknown> | undefined;
    const eventSubtype = typeof turnEvent?.type === "string" ? turnEvent.type : "";
    const isStreamingChunk = eventSubtype === "text_delta";

    if (isStreamingChunk) {
      const payload: TurnStreamPayload = {
        spaceId,
        spaceUid,
        turnId,
        agentId: this.resolveTurnAgentId(eventRecord, turnEvent),
        delta: typeof turnEvent?.text === "string" ? turnEvent.text : "",
        seq: this.coerceInteger(turnEvent?.seq ?? eventRecord.seq, 0),
        done: this.coerceBoolean(turnEvent?.done, false),
      };

      this.broadcastToSpace(spaceUid, {
        type: MessageTypes.TURN_STREAM,
        id: this.nextStreamId(),
        ts: this.getStreamTimestamp(),
        payload,
      });
      return;
    }

    const mappedEventType = this.mapTurnLifecycleEventType(eventSubtype, normalizedType);
    const sanitizedData = this.sanitizeTurnLifecycleData(turnEvent ?? eventRecord.data ?? null);
    const agentId = this.resolveTurnAgentId(eventRecord, turnEvent);
    const rootTurnId = typeof eventRecord.rootTurnId === "string" ? eventRecord.rootTurnId : undefined;
    const conversationTopology = typeof eventRecord.conversationTopology === "string" ? eventRecord.conversationTopology : undefined;
    const transcriptVisibility = typeof eventRecord.transcriptVisibility === "string" ? eventRecord.transcriptVisibility : undefined;
    const nowIso = new Date().toISOString();
    const typedPayload = this.buildTypedPayload(eventSubtype, normalizedType, turnEvent ?? eventRecord, agentId, turnId, rootTurnId, conversationTopology, transcriptVisibility);
    const payload: TurnEventPayload = {
      spaceId,
      spaceUid,
      turnId,
      rootTurnId,
      agentId,
      conversationTopology,
      transcriptVisibility,
      eventType: mappedEventType,
      data: sanitizedData as unknown,
      typedPayload,
      ts: nowIso,
    };

    this.broadcastToSpace(spaceUid, {
      type: MessageTypes.TURN_EVENT,
      id: randomUUID(),
      ts: nowIso,
      payload,
    });
  }

  private mapTurnLifecycleEventType(
    eventSubtypeRaw: string,
    normalizedType: string,
  ): TurnEventPayload["eventType"] {
    const eventSubtype = eventSubtypeRaw.trim().toLowerCase();
    switch (eventSubtype) {
      case "text_delta":
        return "streaming";
      case "tool_call":
      case "tool_call_start":
      case "tool_result":
        return "tool_call";
      case "feedback_requested":
        return "feedback_requested";
      case "feedback_resolved":
        return "state_changed";
      case "rate_limited":
        return "rate_limited";
      case "state_changed":
        return "state_changed";
      case "turn_completed":
        return "completed";
      case "turn_cancelled":
        return "cancelled";
      case "error":
        return "failed";
      default:
        if (normalizedType === "space.turn_started") {
          return "started";
        }
        return "streaming";
    }
  }

  private buildTypedPayload(
    eventSubtype: string,
    normalizedType: string,
    eventRecord: Record<string, unknown>,
    agentId: string,
    turnId: string,
    rootTurnId?: string,
    conversationTopology?: string,
    transcriptVisibility?: string,
  ): TypedTurnEventPayload | undefined {
    const subtype = eventSubtype.trim().toLowerCase();

    switch (subtype) {
      case "reasoning_delta": {
        const text = typeof eventRecord.text === "string" ? eventRecord.text : "";
        return { kind: "reasoning.delta", text };
      }

      case "tool_call_start": {
        const toolCallId = typeof eventRecord.toolCallId === "string"
          ? eventRecord.toolCallId
          : typeof eventRecord.id === "string" ? eventRecord.id : "";
        const toolName = typeof eventRecord.toolName === "string"
          ? eventRecord.toolName
          : typeof eventRecord.name === "string" ? eventRecord.name : "unknown";
        const args = eventRecord.arguments && typeof eventRecord.arguments === "object"
          ? eventRecord.arguments as Record<string, unknown>
          : undefined;
        return { kind: "tool.started", toolCallId, toolName, arguments: args, agentId };
      }

      case "tool_result": {
        const toolCallId = typeof eventRecord.toolCallId === "string"
          ? eventRecord.toolCallId
          : typeof eventRecord.id === "string" ? eventRecord.id : "";
        const toolName = typeof eventRecord.toolName === "string"
          ? eventRecord.toolName
          : typeof eventRecord.name === "string" ? eventRecord.name : undefined;
        const isError = this.coerceBoolean(eventRecord.isError ?? eventRecord.is_error, false);
        return { kind: "tool.completed", toolCallId, toolName, result: eventRecord.result ?? null, isError, agentId };
      }

      case "state_changed": {
        const state = typeof eventRecord.state === "string" ? eventRecord.state : "idle";
        const validStates = new Set<AgentActivityState>(["idle", "thinking", "acting", "needs_feedback", "errored"]);
        return { kind: "state.changed", state: validStates.has(state as AgentActivityState) ? state as AgentActivityState : "idle" };
      }

      case "feedback_requested": {
        const requestId = typeof eventRecord.requestId === "string" ? eventRecord.requestId : "";
        const description = typeof eventRecord.description === "string" ? eventRecord.description : "";
        const options = Array.isArray(eventRecord.options) ? eventRecord.options.filter((o: unknown) => typeof o === "string") as string[] : ["approve", "reject"];
        const context = eventRecord.context && typeof eventRecord.context === "object"
          ? eventRecord.context as Record<string, unknown>
          : undefined;
        return { kind: "approval.requested", requestId, agentId, description, options, context };
      }

      case "feedback_resolved": {
        const requestId = typeof eventRecord.requestId === "string"
          ? eventRecord.requestId
          : turnId;
        const response = typeof eventRecord.response === "string"
          ? eventRecord.response
          : "approved";
        return { kind: "approval.resolved", requestId, response, agentId };
      }

      case "rate_limited": {
        const retryAfterMs = this.coerceInteger(eventRecord.retryAfterMs, 0);
        const attempt = this.coerceInteger(eventRecord.attempt, 0);
        const maxAttempts = this.coerceInteger(eventRecord.maxAttempts, 0);
        const providerId = typeof eventRecord.providerId === "string" ? eventRecord.providerId : "";
        const retryAt = typeof eventRecord.retryAt === "string" ? eventRecord.retryAt : new Date(Date.now() + retryAfterMs).toISOString();
        return { kind: "rate_limited", retryAfterMs, attempt, maxAttempts, providerId, retryAt };
      }

      case "turn_completed": {
        const result = eventRecord.result && typeof eventRecord.result === "object"
          ? eventRecord.result as Record<string, unknown>
          : eventRecord;
        const usage = result.usage && typeof result.usage === "object"
          ? result.usage as Record<string, unknown>
          : undefined;
        const turnUsage = usage ? {
          promptTokens: this.coerceInteger(usage.promptTokens ?? usage.prompt_tokens, 0),
          completionTokens: this.coerceInteger(usage.completionTokens ?? usage.completion_tokens, 0),
          totalTokens: this.coerceInteger(usage.totalTokens ?? usage.total_tokens, 0),
        } : undefined;
        const metadata: Record<string, unknown> = {};
        for (const key of ["modelId", "providerId", "durationMs", "finishReason", "startedAt", "completedAt", "tokensPerSecond"]) {
          if (result[key] !== undefined) metadata[key] = result[key];
        }
        const finalMessage = typeof result.output === "string" ? result.output : typeof result.finalMessage === "string" ? result.finalMessage : undefined;
        const effectiveSafetyProfileId = typeof result.effectiveSafetyProfileId === "string" ? result.effectiveSafetyProfileId : undefined;
        return {
          kind: "turn.completed",
          agentId,
          usage: turnUsage,
          metadata: Object.keys(metadata).length > 0 ? metadata as any : undefined,
          finalMessage,
          effectiveSafetyProfileId,
        };
      }

      case "error": {
        const errorMessage = typeof eventRecord.message === "string"
          ? eventRecord.message
          : typeof eventRecord.error === "string" ? eventRecord.error : "Unknown error";
        const errorCode = typeof eventRecord.code === "string" ? eventRecord.code : undefined;
        return { kind: "turn.failed", errorMessage, errorCode };
      }

      case "turn_cancelled":
        return { kind: "turn.cancelled", agentId };

      default: {
        if (normalizedType === "space.turn_started") {
          const launchSnapshots = this.normalizeLaunchSnapshots(
            (eventRecord as Record<string, unknown>).launchSnapshots
            ?? (typeof (eventRecord as Record<string, unknown>).data === "object"
              && (eventRecord as Record<string, unknown>).data !== null
              && !Array.isArray((eventRecord as Record<string, unknown>).data)
              ? ((eventRecord as Record<string, unknown>).data as Record<string, unknown>).launchSnapshots
              : undefined),
          );
          return {
            kind: "turn.started",
            agentId,
            turnId,
            rootTurnId,
            conversationTopology,
            transcriptVisibility,
            ...(launchSnapshots.length > 0 ? { launchSnapshots } : {}),
          };
        }
        return undefined;
      }
    }
  }

  private resolveTurnAgentId(
    eventRecord: Record<string, unknown>,
    turnEvent?: Record<string, unknown>,
  ): string {
    const fromEvent = typeof turnEvent?.agentId === "string" ? turnEvent.agentId.trim() : "";
    if (fromEvent) return fromEvent;
    const fromLaunchSnapshot = this.normalizeLaunchSnapshots(
      turnEvent && typeof turnEvent.data === "object" && turnEvent.data !== null && !Array.isArray(turnEvent.data)
        ? (turnEvent.data as Record<string, unknown>).launchSnapshots
        : undefined,
    )[0]?.agentId;
    if (fromLaunchSnapshot) return fromLaunchSnapshot;
    const fromAgents = Array.isArray(eventRecord.agents)
      ? eventRecord.agents.find((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)?.trim()
      : undefined;
    if (fromAgents) return fromAgents;
    const resultRecord = turnEvent?.result;
    if (resultRecord && typeof resultRecord === "object" && !Array.isArray(resultRecord)) {
      const nested = (resultRecord as Record<string, unknown>).agentId;
      if (typeof nested === "string" && nested.trim().length > 0) {
        return nested.trim();
      }
    }
    const fromRecord = typeof eventRecord.agentId === "string" ? eventRecord.agentId.trim() : "";
    if (fromRecord) return fromRecord;
    return "unknown-agent";
  }

  private normalizeLaunchSnapshots(
    value: unknown,
  ): Array<{
    agentId: string;
    providerId: string;
    modelId: string;
    contextWindowTokens: number;
    estimatedPromptTokens: number;
    estimatedRemainingTokens: number;
    source: "preflight" | "registry" | "reported";
  }> {
    if (!Array.isArray(value)) {
      return [];
    }

    return value.flatMap((entry) => {
      if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
        return [];
      }
      const record = entry as Record<string, unknown>;
      const agentId = typeof record.agentId === "string" ? record.agentId.trim() : "";
      const providerId = typeof record.providerId === "string" ? record.providerId.trim() : "";
      const modelId = typeof record.modelId === "string" ? record.modelId.trim() : "";
      const contextWindowTokens = this.coerceInteger(record.contextWindowTokens, 0);
      const estimatedPromptTokens = this.coerceInteger(record.estimatedPromptTokens, 0);
      const estimatedRemainingTokens = this.coerceInteger(record.estimatedRemainingTokens, 0);
      const source = record.source === "preflight" || record.source === "reported"
        ? record.source
        : "registry";
      if (!agentId || !providerId || !modelId || contextWindowTokens <= 0) {
        return [];
      }
      return [{
        agentId,
        providerId,
        modelId,
        contextWindowTokens,
        estimatedPromptTokens,
        estimatedRemainingTokens,
        source,
      }];
    });
  }

  private coerceInteger(value: unknown, fallback: number): number {
    if (typeof value === "number" && Number.isFinite(value)) {
      return Math.trunc(value);
    }
    if (typeof value === "string") {
      const parsed = Number.parseInt(value, 10);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
    return fallback;
  }

  private coerceBoolean(value: unknown, fallback: boolean): boolean {
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (normalized === "true" || normalized === "1" || normalized === "yes") {
        return true;
      }
      if (normalized === "false" || normalized === "0" || normalized === "no") {
        return false;
      }
    }
    return fallback;
  }

  private sanitizeTurnLifecycleData(value: unknown): unknown {
    try {
      const sanitized = this.sanitizeTurnLifecycleValue(value);
      this.sanitizationPassCount += 1;
      if (this.sanitizationPassCount % 100 === 0) {
        this.log?.debug("Turn payload sanitization counters", {
          pass: this.sanitizationPassCount,
          fail: this.sanitizationFailCount,
        });
      }
      return sanitized;
    } catch {
      this.sanitizationFailCount += 1;
      this.log?.warn("Turn payload sanitization failed", {
        pass: this.sanitizationPassCount,
        fail: this.sanitizationFailCount,
      });
      return { redactionError: "Unable to sanitize turn payload." };
    }
  }

  private sanitizeTurnLifecycleValue(value: unknown, keyPath: string[] = []): unknown {
    if (Array.isArray(value)) {
      return value.map((entry) => this.sanitizeTurnLifecycleValue(entry, keyPath));
    }

    if (value && typeof value === "object") {
      const record = value as Record<string, unknown>;
      const sanitized: Record<string, unknown> = {};
      for (const [key, nested] of Object.entries(record)) {
        if (this.shouldRedactTurnLifecycleKey(key, keyPath)) {
          const normalized = this.normalizeTurnLifecycleKey(key);
          sanitized[key] = normalized === "messages"
            ? "[REDACTED_MESSAGES]"
            : "[REDACTED]";
        } else {
          sanitized[key] = this.sanitizeTurnLifecycleValue(nested, [...keyPath, key]);
        }
      }
      return sanitized;
    }

    return value;
  }

  private shouldRedactTurnLifecycleKey(key: string, _keyPath: string[]): boolean {
    const normalized = this.normalizeTurnLifecycleKey(key);
    return normalized === "messages"
      || normalized.includes("instruction")
      || normalized.includes("prompt")
      || normalized.includes("planner")
      || normalized.includes("guest")
      || normalized.includes("peerreview")
      || normalized.includes("synthesis")
      || normalized.includes("tooltrace")
      || normalized.includes("rawtrace");
  }

  private normalizeTurnLifecycleKey(key: string): string {
    return key.toLowerCase().replace(/[_-]/g, "");
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

  private async handleSyncHttpRequest(req: Request, pathname: string): Promise<Response> {
    if (req.method !== "POST") {
      return this.syncErrorResponse(405, "INVALID_ARGUMENT", "Sync endpoints require POST");
    }

    if (!this.options.syncHttpHandler) {
      return this.syncErrorResponse(503, "FAILED_PRECONDITION", "Sync HTTP handler unavailable");
    }

    const payload = await this.parseJsonBody(req);
    if (payload instanceof Response) {
      return payload;
    }

    const authSecret = req.headers.get("x-spaceskit-sync-secret")?.trim() || undefined;

    // Enforce sync secret when syncRequireSecret is enabled
    if (this.options.syncRequireSecret && !authSecret) {
      return this.syncErrorResponse(401, "UNAUTHENTICATED", "Sync secret required");
    }

    try {
      switch (pathname) {
        case "/sync/announce": {
          const result = await this.options.syncHttpHandler.announce(
            payload as SyncAnnouncePayload,
            authSecret,
          );
          return this.syncSuccessResponse(result);
        }
        case "/sync/query": {
          const result = await this.options.syncHttpHandler.query(
            payload as SyncQueryResourcesPayload,
            authSecret,
          );
          return this.syncSuccessResponse(result);
        }
        case "/sync/pull": {
          const result = await this.options.syncHttpHandler.pull(
            payload as SyncPullResourcesPayload,
            authSecret,
          );
          return this.syncSuccessResponse(result);
        }
        default:
          return this.syncErrorResponse(404, "NOT_FOUND", `Unknown sync endpoint: ${pathname}`);
      }
    } catch (error) {
      const syncError = extractSyncHttpError(error);
      const status = mapSyncErrorCodeToStatus(syncError.code);
      return this.syncErrorResponse(status, syncError.code, syncError.message);
    }
  }

  private async parseJsonBody(req: Request): Promise<unknown | Response> {
    try {
      return await req.json();
    } catch {
      return this.syncErrorResponse(400, "INVALID_ARGUMENT", "Invalid JSON body");
    }
  }

  private syncSuccessResponse(payload: unknown): Response {
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  private syncErrorResponse(status: number, code = "FAILED_PRECONDITION", message = "Sync request failed"): Response {
    return new Response(JSON.stringify({ code, message }), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }
}

function extractSyncHttpError(error: unknown): Required<SyncHttpError> {
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    const code = typeof record.code === "string" ? record.code : "FAILED_PRECONDITION";
    const message = typeof record.message === "string"
      ? record.message
      : (error instanceof Error ? error.message : "Sync request failed");
    return { code, message };
  }

  return {
    code: "FAILED_PRECONDITION",
    message: error instanceof Error ? error.message : String(error),
  };
}

function mapSyncErrorCodeToStatus(code: string | undefined): number {
  switch (code) {
    case "INVALID_ARGUMENT":
      return 400;
    case "PERMISSION_DENIED":
      return 403;
    case "NOT_FOUND":
      return 404;
    case "FAILED_PRECONDITION":
      return 412;
    default:
      return 500;
  }
}
