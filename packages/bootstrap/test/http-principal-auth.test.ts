import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import {
  issueHttpPrincipalToken,
  resolveHttpPrincipalContext,
} from "../src/services/http-principal-auth.js";

describe("resolveHttpPrincipalContext", () => {
  test("accepts legacy principal headers in compatibility mode", () => {
    const request = new Request("http://localhost/test", {
      headers: {
        "x-spaceskit-principal-id": "principal-legacy",
        "x-spaceskit-device-id": "device-legacy",
      },
    });
    const result = resolveHttpPrincipalContext(request);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.context.principalId).toBe("principal-legacy");
    expect(result.context.deviceId).toBe("device-legacy");
    expect(result.context.authMethod).toBe("legacy_header");
  });

  test("rejects missing bearer token in strict mode", () => {
    const request = new Request("http://localhost/test", {
      headers: {
        "x-spaceskit-principal-id": "forged-principal",
      },
    });
    const result = resolveHttpPrincipalContext(request, {
      strictVerification: true,
      hs256Secret: "test-secret",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("UNAUTHENTICATED");
    expect(result.error.reason).toBe("missing_bearer_token");
  });

  test("accepts valid signed bearer token in strict mode", () => {
    const now = new Date("2026-03-02T20:00:00.000Z");
    const signedToken = signHs256Token({
      sub: "principal-signed",
      device_id: "device-signed",
      iat: Math.floor(now.getTime() / 1000),
      exp: Math.floor(now.getTime() / 1000) + 120,
    }, "test-secret");
    const request = new Request("http://localhost/test", {
      headers: {
        authorization: `Bearer ${signedToken}`,
      },
    });
    const result = resolveHttpPrincipalContext(request, {
      strictVerification: true,
      hs256Secret: "test-secret",
      now: () => now,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.context.principalId).toBe("principal-signed");
    expect(result.context.deviceId).toBe("device-signed");
    expect(result.context.authMethod).toBe("jwt_hs256");
    expect(result.context.verifiedAt).toBe(now.toISOString());
  });

  test("rejects expired signed bearer token", () => {
    const now = new Date("2026-03-02T20:00:00.000Z");
    const signedToken = signHs256Token({
      sub: "principal-expired",
      exp: Math.floor(now.getTime() / 1000) - 300,
    }, "test-secret");
    const request = new Request("http://localhost/test", {
      headers: {
        authorization: `Bearer ${signedToken}`,
      },
    });
    const result = resolveHttpPrincipalContext(request, {
      strictVerification: true,
      hs256Secret: "test-secret",
      now: () => now,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.reason).toBe("expired_token");
  });

  test("issues signed bearer token for authenticated principal propagation", () => {
    const now = new Date("2026-03-02T20:00:00.000Z");
    const issued = issueHttpPrincipalToken({
      principalId: "principal-issued",
      deviceId: "device-issued",
      hs256Secret: "test-secret",
      ttlSeconds: 180,
      now: () => now,
    });

    expect(issued.tokenType).toBe("Bearer");
    expect(issued.principalId).toBe("principal-issued");
    expect(issued.deviceId).toBe("device-issued");
    expect(issued.issuedAt).toBe("2026-03-02T20:00:00.000Z");
    expect(issued.expiresAt).toBe("2026-03-02T20:03:00.000Z");
    expect(issued.ttlSeconds).toBe(180);

    const request = new Request("http://localhost/test", {
      headers: {
        authorization: `Bearer ${issued.token}`,
      },
    });
    const verified = resolveHttpPrincipalContext(request, {
      strictVerification: true,
      hs256Secret: "test-secret",
      now: () => now,
    });
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;
    expect(verified.context.principalId).toBe("principal-issued");
    expect(verified.context.deviceId).toBe("device-issued");
    expect(verified.context.authMethod).toBe("jwt_hs256");
  });

  test("clamps issued token ttl to safe bounds", () => {
    const now = new Date("2026-03-02T20:00:00.000Z");
    const shortTtl = issueHttpPrincipalToken({
      principalId: "principal-short",
      hs256Secret: "test-secret",
      ttlSeconds: 1,
      now: () => now,
    });
    expect(shortTtl.ttlSeconds).toBe(30);
    expect(shortTtl.expiresAt).toBe("2026-03-02T20:00:30.000Z");

    const longTtl = issueHttpPrincipalToken({
      principalId: "principal-long",
      hs256Secret: "test-secret",
      ttlSeconds: 99_999,
      now: () => now,
    });
    expect(longTtl.ttlSeconds).toBe(3600);
    expect(longTtl.expiresAt).toBe("2026-03-02T21:00:00.000Z");
  });

  test("rejects token issuance without required principal or secret", () => {
    expect(() => issueHttpPrincipalToken({
      principalId: "   ",
      hs256Secret: "test-secret",
    })).toThrow("principalId is required");

    expect(() => issueHttpPrincipalToken({
      principalId: "principal-a",
      hs256Secret: "   ",
    })).toThrow("hs256Secret is required");
  });
});

function signHs256Token(payload: Record<string, unknown>, secret: string): string {
  const encodedHeader = base64UrlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = createHmac("sha256", secret).update(signingInput).digest("base64url");
  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

function base64UrlEncode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}
