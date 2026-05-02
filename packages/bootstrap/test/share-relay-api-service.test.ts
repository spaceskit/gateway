import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import {
  AuthKeyRepository,
  DeviceIdentityRepository,
  InviteTokenRepository,
  migrations,
} from "@spaceskit/persistence";
import { decodeInviteLink } from "@spaceskit/core";
import { ShareRelayApiService, verifyInviteToken } from "../src/services/share-relay-api-service.js";
import { DeviceIdentityService } from "../src/services/device-identity-service.js";
import { createHttpPrincipalTestContext } from "./http-principal-test-helpers.js";

function inMemoryDb(): Database {
  const db = new Database(":memory:");
  for (const migration of migrations) {
    for (const stmt of migration.up) {
      db.run(stmt);
    }
  }
  return db;
}

describe("ShareRelayApiService", () => {
  test("returns null for unrelated paths", async () => {
    const service = new ShareRelayApiService({});
    const response = await service.handleRequest(
      new Request("http://localhost/unknown", { method: "GET" }),
      new URL("http://localhost/unknown"),
    );
    expect(response).toBeNull();
  });

  test("resolves relay invite via POST /v1/share/relay/resolve", async () => {
    let capturedInput: Record<string, unknown> | null = null;
    const auth = createHttpPrincipalTestContext();
    const service = new ShareRelayApiService({
      principalAuth: auth.principalAuth,
      spaceSharingService: {
        resolveRelayInvite: (input) => {
          capturedInput = input as Record<string, unknown>;
          return {
            gatewayRoute: "relay_proxy",
            relaySessionToken: "relay-session-1",
            sharingIdentityPolicy: {
              mode: "strict_apple_id",
              allowDeviceKeyFallback: false,
            },
          };
        },
        proxyJoinRelayInvite: () => {
          throw new Error("should not run");
        },
      },
    });

    const request = new Request("http://localhost/v1/share/relay/resolve", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...auth.headers("principal-a"),
      },
      body: JSON.stringify({
        relayInviteId: "relay-invite-1",
        directReachable: true,
      }),
    });

    const response = await service.handleRequest(request, new URL(request.url));
    expect(response?.status).toBe(200);
    const body = await response!.json() as {
      relaySessionToken?: string;
      sharingIdentityPolicy?: { mode?: string; allowDeviceKeyFallback?: boolean };
    };
    expect(body.relaySessionToken).toBe("relay-session-1");
    expect(body.sharingIdentityPolicy).toEqual({
      mode: "strict_apple_id",
      allowDeviceKeyFallback: false,
    });
    expect(capturedInput).toEqual({
      relayInviteId: "relay-invite-1",
      directReachable: true,
      principalId: "principal-a",
    });
  });

  test("proxy joins relay invite via POST /v1/share/relay/join", async () => {
    let capturedInput: Record<string, unknown> | null = null;
    const auth = createHttpPrincipalTestContext();
    const service = new ShareRelayApiService({
      principalAuth: auth.principalAuth,
      spaceSharingService: {
        resolveRelayInvite: () => ({
          gatewayRoute: "relay_proxy",
          relaySessionToken: "unused",
        }),
        proxyJoinRelayInvite: (input) => {
          capturedInput = input as Record<string, unknown>;
          return {
            participantId: "participant-1",
            principalId: input.principalId,
          } as any;
        },
      },
    });

    const request = new Request("http://localhost/v1/share/relay/join", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...auth.headers("principal-b"),
      },
      body: JSON.stringify({
        relaySessionToken: "relay-session-1",
        deviceId: "device-1",
        devicePublicKey: "device-key-1",
        identityModeHint: "device_key",
      }),
    });

    const response = await service.handleRequest(request, new URL(request.url));
    expect(response?.status).toBe(200);
    const body = await response!.json() as { participant?: { participantId?: string } };
    expect(body.participant?.participantId).toBe("participant-1");
    expect(capturedInput).toEqual({
      relaySessionToken: "relay-session-1",
      principalId: "principal-b",
      principalType: "public_key",
      deviceId: "device-1",
      devicePublicKey: "device-key-1",
      identityModeHint: "device_key",
      appleIdAssertion: undefined,
    });
  });

  test("rejects unsupported identityModeHint values on relay join", async () => {
    let joinCalled = false;
    const auth = createHttpPrincipalTestContext();
    const service = new ShareRelayApiService({
      principalAuth: auth.principalAuth,
      spaceSharingService: {
        resolveRelayInvite: () => ({
          gatewayRoute: "relay_proxy",
          relaySessionToken: "unused",
        }),
        proxyJoinRelayInvite: () => {
          joinCalled = true;
          return {} as any;
        },
      },
    });

    const request = new Request("http://localhost/v1/share/relay/join", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...auth.headers("principal-b"),
      },
      body: JSON.stringify({
        relaySessionToken: "relay-session-1",
        identityModeHint: "legacy_mode",
      }),
    });

    const response = await service.handleRequest(request, new URL(request.url));
    expect(response?.status).toBe(400);
    const body = await response!.json() as { code?: string; message?: string };
    expect(body.code).toBe("INVALID_ARGUMENT");
    expect(body.message).toContain("identityModeHint");
    expect(joinCalled).toBe(false);
  });

  test("requires authenticated principal for relay join", async () => {
    const service = new ShareRelayApiService({
      spaceSharingService: {
        resolveRelayInvite: () => ({
          gatewayRoute: "relay_proxy",
          relaySessionToken: "unused",
        }),
        proxyJoinRelayInvite: () => ({}) as any,
      },
    });

    const request = new Request("http://localhost/v1/share/relay/join", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ relaySessionToken: "relay-session-1" }),
    });

    const response = await service.handleRequest(request, new URL(request.url));
    expect(response?.status).toBe(401);
    const body = await response!.json() as { code?: string };
    expect(body.code).toBe("UNAUTHENTICATED");
  });

  test("enforces signed bearer tokens in strict principal-auth mode", async () => {
    let seenPrincipalId: string | undefined;
    const auth = createHttpPrincipalTestContext();
    const service = new ShareRelayApiService({
      principalAuth: auth.strictPrincipalAuth,
      spaceSharingService: {
        resolveRelayInvite: () => ({
          gatewayRoute: "relay_proxy",
          relaySessionToken: "unused",
        }),
        proxyJoinRelayInvite: (input) => {
          seenPrincipalId = input.principalId;
          return {
            participantId: "participant-strict",
            principalId: input.principalId,
          } as any;
        },
      },
    });

    const headerOnlyRequest = new Request("http://localhost/v1/share/relay/join", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-spaceskit-principal-id": "forged-principal",
      },
      body: JSON.stringify({ relaySessionToken: "relay-session-1" }),
    });
    const headerOnlyResponse = await service.handleRequest(headerOnlyRequest, new URL(headerOnlyRequest.url));
    expect(headerOnlyResponse?.status).toBe(401);
    const headerOnlyBody = await headerOnlyResponse!.json() as { code?: string };
    expect(headerOnlyBody.code).toBe("UNAUTHENTICATED");

    const signedRequest = new Request("http://localhost/v1/share/relay/join", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...auth.headers("principal-strict"),
      },
      body: JSON.stringify({ relaySessionToken: "relay-session-1" }),
    });
    const signedResponse = await service.handleRequest(signedRequest, new URL(signedRequest.url));
    expect(signedResponse?.status).toBe(200);
    expect(seenPrincipalId).toBe("principal-strict");
  });

  test("maps sharing service permission errors to 403", async () => {
    const auth = createHttpPrincipalTestContext();
    const service = new ShareRelayApiService({
      principalAuth: auth.principalAuth,
      spaceSharingService: {
        resolveRelayInvite: () => ({
          gatewayRoute: "relay_proxy",
          relaySessionToken: "unused",
        }),
        proxyJoinRelayInvite: () => {
          throw { code: "PERMISSION_DENIED", message: "invalid relay session" };
        },
      },
    });

    const request = new Request("http://localhost/v1/share/relay/join", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...auth.headers("principal-a"),
      },
      body: JSON.stringify({ relaySessionToken: "relay-session-1" }),
    });

    const response = await service.handleRequest(request, new URL(request.url));
    expect(response?.status).toBe(403);
    const body = await response!.json() as { code?: string };
    expect(body.code).toBe("PERMISSION_DENIED");
  });

  test("emits relay lifecycle events for observability", async () => {
    const emitted: Array<{ type?: string; code?: string }> = [];
    const auth = createHttpPrincipalTestContext();
    const service = new ShareRelayApiService({
      principalAuth: auth.principalAuth,
      eventBus: {
        emit: (event) => {
          emitted.push({
            type: typeof event.type === "string" ? event.type : undefined,
            code: typeof event.code === "string" ? event.code : undefined,
          });
        },
      } as any,
      spaceSharingService: {
        resolveRelayInvite: () => ({
          gatewayRoute: "direct",
          gatewayUrl: "wss://gateway.example.com",
          relaySessionToken: "relay-session-2",
        }),
        proxyJoinRelayInvite: () => {
          throw { code: "PERMISSION_DENIED", message: "deny" };
        },
      },
    });

    const resolveRequest = new Request("http://localhost/v1/share/relay/resolve", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...auth.headers("principal-z"),
      },
      body: JSON.stringify({
        relayInviteId: "relay-invite-z",
      }),
    });
    const resolveResponse = await service.handleRequest(resolveRequest, new URL(resolveRequest.url));
    expect(resolveResponse?.status).toBe(200);

    const joinRequest = new Request("http://localhost/v1/share/relay/join", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...auth.headers("principal-z"),
      },
      body: JSON.stringify({
        relaySessionToken: "relay-session-z",
      }),
    });
    const joinResponse = await service.handleRequest(joinRequest, new URL(joinRequest.url));
    expect(joinResponse?.status).toBe(403);

    expect(emitted.some((entry) => entry.type === "share.relay.resolve.attempt")).toBe(true);
    expect(emitted.some((entry) => entry.type === "share.relay.resolve.success")).toBe(true);
    expect(emitted.some((entry) => entry.type === "share.relay.join.attempt")).toBe(true);
    expect(emitted.some((entry) => entry.type === "share.relay.join.failed" && entry.code === "PERMISSION_DENIED")).toBe(true);
  });
});

describe("ShareRelayApiService.createInvite", () => {
  test("issues a v2 invite link with funnel URL when funnel is ready", async () => {
    const db = inMemoryDb();
    const inviteTokens = new InviteTokenRepository(db);
    const authKeys = new AuthKeyRepository(db);
    const service = new ShareRelayApiService({
      inviteTokens,
      authKeys,
      currentFunnelUrl: () => "https://gateway.tail123.ts.net",
    });

    const result = await service.createInvite({
      spaceId: "space-1",
      mode: "collaborator",
      ttlSeconds: 3600,
      issuedByPrincipalId: "principal-issuer",
    });

    expect(result.tokenId.length).toBeGreaterThan(0);
    expect(result.signedToken.length).toBeGreaterThan(0);
    expect(result.funnelUrl).toBe("https://gateway.tail123.ts.net");
    expect(result.previewUrl).toBe(
      `https://gateway.tail123.ts.net/.well-known/spaces/invite/${encodeURIComponent(result.tokenId)}`,
    );
    expect(result.link.gatewayUrl).toBe("https://gateway.tail123.ts.net");
    expect(result.link.spaceId).toBe("space-1");

    const decoded = decodeInviteLink(result.encodedLink);
    expect(decoded.version).toBe("v2");
    expect(decoded.spaceId).toBe("space-1");
    if (decoded.version === "v2") {
      expect(decoded.gatewayUrl).toBe("https://gateway.tail123.ts.net");
    }

    const persisted = inviteTokens.getByTokenId(result.tokenId);
    expect(persisted).toBeDefined();
    expect(persisted!.space_id).toBe("space-1");
    expect(persisted!.mode).toBe("collaborator");
    expect(persisted!.signed_token).toBe(result.signedToken);
    expect(persisted!.issued_by_principal_id).toBe("principal-issuer");
    expect(persisted!.consumed_at).toBeNull();

    const verification = await verifyInviteToken(result.signedToken, authKeys);
    expect(verification.ok).toBe(true);
    if (verification.ok) {
      expect(verification.payload.tid).toBe(result.tokenId);
      expect(verification.payload.sid).toBe("space-1");
      expect(verification.payload.mode).toBe("collaborator");
    }
  });

  test("falls back gracefully when funnel URL is unavailable", async () => {
    const db = inMemoryDb();
    const inviteTokens = new InviteTokenRepository(db);
    const authKeys = new AuthKeyRepository(db);
    const service = new ShareRelayApiService({
      inviteTokens,
      authKeys,
      currentFunnelUrl: () => undefined,
    });

    const result = await service.createInvite({
      spaceId: "space-2",
      mode: "read_only",
    });

    expect(result.funnelUrl).toBeUndefined();
    expect(result.previewUrl).toBeUndefined();
    expect(result.link.gatewayUrl).toBeUndefined();

    const decoded = decodeInviteLink(result.encodedLink);
    expect(decoded.version).toBe("v2");
    if (decoded.version === "v2") {
      expect(decoded.gatewayUrl).toBeUndefined();
    }
  });

  test("clamps TTL to 24h cap and uses default when unspecified", async () => {
    const db = inMemoryDb();
    const inviteTokens = new InviteTokenRepository(db);
    const authKeys = new AuthKeyRepository(db);
    const service = new ShareRelayApiService({ inviteTokens, authKeys });

    const overflow = await service.createInvite({
      spaceId: "space-3",
      mode: "read_only",
      ttlSeconds: 999_999, // > 24h
    });
    const overflowExpiresMs = Date.parse(overflow.expiresAt);
    const overflowDeltaSec = (overflowExpiresMs - Date.now()) / 1000;
    expect(overflowDeltaSec).toBeLessThanOrEqual(24 * 60 * 60 + 5);
    expect(overflowDeltaSec).toBeGreaterThan(24 * 60 * 60 - 5);

    const defaulted = await service.createInvite({
      spaceId: "space-4",
      mode: "read_only",
    });
    const defaultedExpiresMs = Date.parse(defaulted.expiresAt);
    const defaultedDeltaSec = (defaultedExpiresMs - Date.now()) / 1000;
    expect(defaultedDeltaSec).toBeLessThanOrEqual(60 * 60 + 5);
    expect(defaultedDeltaSec).toBeGreaterThan(60 * 60 - 5);
  });

  test("reuses the dedicated invite-signing key across invites", async () => {
    const db = inMemoryDb();
    const inviteTokens = new InviteTokenRepository(db);
    const authKeys = new AuthKeyRepository(db);
    const service = new ShareRelayApiService({ inviteTokens, authKeys });

    const a = await service.createInvite({ spaceId: "space-A", mode: "read_only" });
    const b = await service.createInvite({ spaceId: "space-B", mode: "collaborator" });

    expect(a.signingKid).toBe(b.signingKid);
    const key = authKeys.getByKid(a.signingKid);
    expect(key).toBeDefined();
    expect(key!.role).toBe("invite-signing");
    expect(key!.algorithm).toBe("Ed25519");
  });

  test("rejects when invite repositories are not configured", async () => {
    const service = new ShareRelayApiService({});
    await expect(
      service.createInvite({ spaceId: "space-x", mode: "read_only" }),
    ).rejects.toMatchObject({ code: "FAILED_PRECONDITION" });
  });

  test("rejects invalid mode and missing spaceId", async () => {
    const db = inMemoryDb();
    const service = new ShareRelayApiService({
      inviteTokens: new InviteTokenRepository(db),
      authKeys: new AuthKeyRepository(db),
    });
    await expect(
      service.createInvite({ spaceId: "  ", mode: "read_only" }),
    ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    await expect(
      service.createInvite({ spaceId: "space-y", mode: "owner" as any }),
    ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
  });

  test("emits share.invite.v2.created event for observability", async () => {
    const db = inMemoryDb();
    const emitted: Array<{ type?: string; spaceId?: string; hasFunnelUrl?: boolean }> = [];
    const service = new ShareRelayApiService({
      inviteTokens: new InviteTokenRepository(db),
      authKeys: new AuthKeyRepository(db),
      eventBus: {
        emit: (event) => {
          emitted.push({
            type: typeof event.type === "string" ? event.type : undefined,
            spaceId: typeof event.spaceId === "string" ? event.spaceId : undefined,
            hasFunnelUrl: typeof event.hasFunnelUrl === "boolean" ? event.hasFunnelUrl : undefined,
          });
        },
      } as any,
      currentFunnelUrl: () => "https://gateway.tailx.ts.net",
    });
    await service.createInvite({ spaceId: "space-evt", mode: "read_only" });
    expect(emitted.some((e) => e.type === "share.invite.v2.created" && e.spaceId === "space-evt" && e.hasFunnelUrl === true))
      .toBe(true);
  });

  test("verifyInviteToken rejects expired and tampered tokens", async () => {
    const db = inMemoryDb();
    const authKeys = new AuthKeyRepository(db);
    const service = new ShareRelayApiService({
      inviteTokens: new InviteTokenRepository(db),
      authKeys,
    });
    const issued = await service.createInvite({ spaceId: "space-vrf", mode: "read_only", ttlSeconds: 60 });

    // Valid in normal flow.
    const ok = await verifyInviteToken(issued.signedToken, authKeys);
    expect(ok.ok).toBe(true);

    // Expired (now is past the exp).
    const future = new Date(Date.parse(issued.expiresAt) + 60_000);
    const expired = await verifyInviteToken(issued.signedToken, authKeys, future);
    expect(expired.ok).toBe(false);
    if (!expired.ok) expect(expired.reason).toBe("expired");

    // Tampered signature.
    const [payloadPart, sigPart] = issued.signedToken.split(".");
    const tampered = `${payloadPart}.${flipFirstChar(sigPart)}`;
    const bad = await verifyInviteToken(tampered, authKeys);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.reason === "bad_signature" || bad.reason === "malformed").toBe(true);

    // Malformed (no dot).
    const mal = await verifyInviteToken("not-a-token", authKeys);
    expect(mal.ok).toBe(false);
    if (!mal.ok) expect(mal.reason).toBe("malformed");
  });
});

function flipFirstChar(s: string): string {
  if (!s.length) return s;
  const first = s[0];
  const replacement = first === "A" ? "B" : "A";
  return replacement + s.slice(1);
}

describe("ShareRelayApiService.register_device_via_invite", () => {
  type Harness = {
    db: Database;
    authKeys: AuthKeyRepository;
    inviteTokens: InviteTokenRepository;
    deviceRepo: DeviceIdentityRepository;
    deviceService: DeviceIdentityService;
    service: ShareRelayApiService;
    emitted: Array<Record<string, unknown>>;
    issueInvite: (overrides?: {
      ttlSeconds?: number;
      principalId?: string;
      spaceId?: string;
      mode?: "read_only" | "collaborator";
    }) => Promise<{ tokenId: string; signedToken: string; spaceId: string; principalId: string }>;
  };

  function buildHarness(opts?: {
    requirePreRegistered?: boolean;
    rateLimit?: { maxAttempts: number; windowMs: number };
    clientIp?: string;
  }): Harness {
    const db = inMemoryDb();
    const authKeys = new AuthKeyRepository(db);
    const inviteTokens = new InviteTokenRepository(db);
    const deviceRepo = new DeviceIdentityRepository(db);
    const deviceService = new DeviceIdentityService({
      repository: deviceRepo,
      requirePreRegistered: opts?.requirePreRegistered ?? true,
    });

    const emitted: Array<Record<string, unknown>> = [];
    const service = new ShareRelayApiService({
      inviteTokens,
      authKeys,
      deviceIdentityService: deviceService,
      eventBus: {
        emit: (event) => {
          emitted.push({ ...event } as Record<string, unknown>);
        },
      } as any,
      registerViaInviteRateLimit: opts?.rateLimit,
      resolveClientIp: () => opts?.clientIp ?? "10.0.0.1",
    });

    const issueInvite: Harness["issueInvite"] = async (overrides) => {
      const result = await service.createInvite({
        spaceId: overrides?.spaceId ?? "space-invite-1",
        mode: overrides?.mode ?? "collaborator",
        ttlSeconds: overrides?.ttlSeconds ?? 3600,
        issuedByPrincipalId: overrides?.principalId ?? "principal-issuer",
      });
      return {
        tokenId: result.tokenId,
        signedToken: result.signedToken,
        spaceId: overrides?.spaceId ?? "space-invite-1",
        principalId: overrides?.principalId ?? "principal-issuer",
      };
    };

    return { db, authKeys, inviteTokens, deviceRepo, deviceService, service, emitted, issueInvite };
  }

  function makeRequest(body: Record<string, unknown>, init?: { method?: string; headers?: Record<string, string> }): Request {
    return new Request(`http://localhost${"/v1/share/relay/register_device_via_invite"}`, {
      method: init?.method ?? "POST",
      headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
      body: JSON.stringify(body),
    });
  }

  test("registers a fresh device for a valid invite and consumes the token", async () => {
    const h = buildHarness();
    const invite = await h.issueInvite();

    const response = await h.service.handleRequest(
      makeRequest({
        invite_token: invite.signedToken,
        device_public_key: "device-pubkey-A",
        device_id: "device-iphone-1",
        platform: "ios",
      }),
      new URL("http://localhost/v1/share/relay/register_device_via_invite"),
    );

    expect(response?.status).toBe(200);
    const body = await response!.json() as {
      device?: { deviceId?: string; principalId?: string; publicKey?: string };
      space_id?: string;
      principal_id?: string;
    };
    expect(body.device?.deviceId).toBe("device-iphone-1");
    expect(body.device?.principalId).toBe(invite.principalId);
    expect(body.device?.publicKey).toBe("device-pubkey-A");
    expect(body.space_id).toBe(invite.spaceId);
    expect(body.principal_id).toBe(invite.principalId);

    const persistedToken = h.inviteTokens.getByTokenId(invite.tokenId);
    expect(persistedToken?.consumed_at).not.toBeNull();

    const devices = h.deviceService.listDevices(invite.principalId);
    expect(devices).toHaveLength(1);
    expect(devices[0].deviceId).toBe("device-iphone-1");

    expect(h.emitted.some((e) => e.type === "share.invite.register_device.success" && e.deviceId === "device-iphone-1"))
      .toBe(true);
  });

  test("rejects a replay of a previously consumed token with 410 GONE", async () => {
    const h = buildHarness();
    const invite = await h.issueInvite();

    const ok = await h.service.handleRequest(
      makeRequest({
        invite_token: invite.signedToken,
        device_public_key: "device-pubkey-A",
        device_id: "device-iphone-1",
      }),
      new URL("http://localhost/v1/share/relay/register_device_via_invite"),
    );
    expect(ok?.status).toBe(200);

    const replay = await h.service.handleRequest(
      makeRequest({
        invite_token: invite.signedToken,
        device_public_key: "device-pubkey-B",
        device_id: "device-iphone-2",
      }),
      new URL("http://localhost/v1/share/relay/register_device_via_invite"),
    );
    expect(replay?.status).toBe(410);
    const replayBody = await replay!.json() as { code?: string };
    expect(replayBody.code).toBe("GONE");

    const devices = h.deviceService.listDevices(invite.principalId);
    expect(devices).toHaveLength(1);
    expect(devices[0].deviceId).toBe("device-iphone-1");
  });

  test("rejects expired invite tokens with 410 GONE and does not register", async () => {
    const h = buildHarness();
    const invite = await h.issueInvite({ ttlSeconds: 60 });
    const tokenRow = h.inviteTokens.getByTokenId(invite.tokenId)!;
    const future = new Date(Date.parse(tokenRow.expires_at) + 60_000);

    const expiredService = new ShareRelayApiService({
      authKeys: h.authKeys,
      inviteTokens: h.inviteTokens,
      deviceIdentityService: h.deviceService,
      now: () => future,
      resolveClientIp: () => "10.0.0.1",
    });

    const response = await expiredService.handleRequest(
      makeRequest({
        invite_token: invite.signedToken,
        device_public_key: "device-pubkey-A",
        device_id: "device-iphone-1",
      }),
      new URL("http://localhost/v1/share/relay/register_device_via_invite"),
    );
    expect(response?.status).toBe(410);
    const body = await response!.json() as { code?: string };
    expect(body.code).toBe("GONE");

    const persisted = h.inviteTokens.getByTokenId(invite.tokenId);
    expect(persisted?.consumed_at).toBeNull();
    const devices = h.deviceService.listDevices(invite.principalId);
    expect(devices).toHaveLength(0);
  });

  test("rejects tampered signatures with 400 INVALID_ARGUMENT", async () => {
    const h = buildHarness();
    const invite = await h.issueInvite();
    const [payloadPart, sigPart] = invite.signedToken.split(".");
    const tampered = `${payloadPart}.${flipFirstChar(sigPart)}`;

    const response = await h.service.handleRequest(
      makeRequest({
        invite_token: tampered,
        device_public_key: "device-pubkey-A",
        device_id: "device-iphone-1",
      }),
      new URL("http://localhost/v1/share/relay/register_device_via_invite"),
    );
    expect(response?.status).toBe(400);
    const body = await response!.json() as { code?: string };
    expect(body.code).toBe("INVALID_ARGUMENT");

    const persisted = h.inviteTokens.getByTokenId(invite.tokenId);
    expect(persisted?.consumed_at).toBeNull();
    const devices = h.deviceService.listDevices(invite.principalId);
    expect(devices).toHaveLength(0);
  });

  test("rejects missing fields with 400 INVALID_ARGUMENT", async () => {
    const h = buildHarness();
    const invite = await h.issueInvite();

    const noToken = await h.service.handleRequest(
      makeRequest({ device_public_key: "k", device_id: "d" }),
      new URL("http://localhost/v1/share/relay/register_device_via_invite"),
    );
    expect(noToken?.status).toBe(400);

    const noKey = await h.service.handleRequest(
      makeRequest({ invite_token: invite.signedToken, device_id: "d" }),
      new URL("http://localhost/v1/share/relay/register_device_via_invite"),
    );
    expect(noKey?.status).toBe(400);

    const noDevice = await h.service.handleRequest(
      makeRequest({ invite_token: invite.signedToken, device_public_key: "k" }),
      new URL("http://localhost/v1/share/relay/register_device_via_invite"),
    );
    expect(noDevice?.status).toBe(400);

    const persisted = h.inviteTokens.getByTokenId(invite.tokenId);
    expect(persisted?.consumed_at).toBeNull();
  });

  test("rejects non-POST methods with 405", async () => {
    const h = buildHarness();
    const response = await h.service.handleRequest(
      new Request("http://localhost/v1/share/relay/register_device_via_invite", { method: "GET" }),
      new URL("http://localhost/v1/share/relay/register_device_via_invite"),
    );
    expect(response?.status).toBe(405);
  });

  test("returns 412 FAILED_PRECONDITION when device service is unavailable", async () => {
    const db = inMemoryDb();
    const authKeys = new AuthKeyRepository(db);
    const inviteTokens = new InviteTokenRepository(db);
    const service = new ShareRelayApiService({
      authKeys,
      inviteTokens,
      // deviceIdentityService intentionally omitted
    });
    const issued = await service.createInvite({
      spaceId: "space-x",
      mode: "read_only",
      issuedByPrincipalId: "principal-issuer",
    });
    const response = await service.handleRequest(
      makeRequest({
        invite_token: issued.signedToken,
        device_public_key: "k",
        device_id: "d",
      }),
      new URL("http://localhost/v1/share/relay/register_device_via_invite"),
    );
    expect(response?.status).toBe(412);
  });

  test("rejects when invite has no issuing principal recorded", async () => {
    const h = buildHarness();
    const invite = await h.issueInvite({ principalId: "" });
    const response = await h.service.handleRequest(
      makeRequest({
        invite_token: invite.signedToken,
        device_public_key: "k",
        device_id: "d",
      }),
      new URL("http://localhost/v1/share/relay/register_device_via_invite"),
    );
    expect(response?.status).toBe(412);
    const body = await response!.json() as { code?: string };
    expect(body.code).toBe("FAILED_PRECONDITION");
    // The invite was consumed (atomic), but no device was created.
    const devices = h.deviceService.listDevices("any-principal");
    expect(devices).toHaveLength(0);
  });

  test("rate limits per-IP at 429 once cap is reached", async () => {
    const h = buildHarness({
      rateLimit: { maxAttempts: 3, windowMs: 60_000 },
    });
    // Use distinct invites — we want to hit the IP limit, not the consume limit.
    const invites = await Promise.all([
      h.issueInvite({ spaceId: "space-A" }),
      h.issueInvite({ spaceId: "space-B" }),
      h.issueInvite({ spaceId: "space-C" }),
      h.issueInvite({ spaceId: "space-D" }),
    ]);

    const r1 = await h.service.handleRequest(
      makeRequest({ invite_token: invites[0].signedToken, device_public_key: "k1", device_id: "d1" }),
      new URL("http://localhost/v1/share/relay/register_device_via_invite"),
    );
    expect(r1?.status).toBe(200);
    const r2 = await h.service.handleRequest(
      makeRequest({ invite_token: invites[1].signedToken, device_public_key: "k2", device_id: "d2" }),
      new URL("http://localhost/v1/share/relay/register_device_via_invite"),
    );
    expect(r2?.status).toBe(200);
    const r3 = await h.service.handleRequest(
      makeRequest({ invite_token: invites[2].signedToken, device_public_key: "k3", device_id: "d3" }),
      new URL("http://localhost/v1/share/relay/register_device_via_invite"),
    );
    expect(r3?.status).toBe(200);
    const r4 = await h.service.handleRequest(
      makeRequest({ invite_token: invites[3].signedToken, device_public_key: "k4", device_id: "d4" }),
      new URL("http://localhost/v1/share/relay/register_device_via_invite"),
    );
    expect(r4?.status).toBe(429);
    const r4Body = await r4!.json() as { code?: string };
    expect(r4Body.code).toBe("RESOURCE_EXHAUSTED");

    expect(h.emitted.some((e) => e.type === "share.invite.register_device.rate_limited"))
      .toBe(true);
  });

  test("registered device is visible via DeviceIdentityService.listDevices", async () => {
    const h = buildHarness();
    const invite = await h.issueInvite({ principalId: "principal-list-check" });

    const response = await h.service.handleRequest(
      makeRequest({
        invite_token: invite.signedToken,
        device_public_key: "list-check-key",
        device_id: "list-check-device",
        platform: "macos",
      }),
      new URL("http://localhost/v1/share/relay/register_device_via_invite"),
    );
    expect(response?.status).toBe(200);

    const devices = h.deviceService.listDevices("principal-list-check");
    expect(devices).toHaveLength(1);
    expect(devices[0]).toMatchObject({
      deviceId: "list-check-device",
      principalId: "principal-list-check",
      publicKey: "list-check-key",
      platform: "macos",
      status: "active",
    });
  });

  test("requirePreRegistered does not block invite-bound registration", async () => {
    // Pre-registered policy is ON — the invite path must still register a fresh device.
    const h = buildHarness({ requirePreRegistered: true });
    const invite = await h.issueInvite();

    const response = await h.service.handleRequest(
      makeRequest({
        invite_token: invite.signedToken,
        device_public_key: "fresh-device-key",
        device_id: "fresh-device-id",
      }),
      new URL("http://localhost/v1/share/relay/register_device_via_invite"),
    );
    expect(response?.status).toBe(200);
    const devices = h.deviceService.listDevices(invite.principalId);
    expect(devices.map((d) => d.deviceId)).toContain("fresh-device-id");
  });
});
