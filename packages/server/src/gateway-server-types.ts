import type { EventBus } from "@spaceskit/core";
import type { Logger } from "@spaceskit/observability";
import type { A2AHandler } from "./a2a/a2a-handler.js";
import type { GatewayDeviceIdentityValidator } from "./gateway-authentication.js";
import type { NotificationHandler } from "./notification-handler.js";
import type { GatewayMessage } from "./protocol.js";
import type { SyncHttpHandler } from "./sync-http-routes.js";

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
