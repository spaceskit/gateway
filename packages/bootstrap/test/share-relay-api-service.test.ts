import { describe, expect, test } from "bun:test";
import { ShareRelayApiService } from "../src/services/share-relay-api-service.js";
import { createHttpPrincipalTestContext } from "./http-principal-test-helpers.js";

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
