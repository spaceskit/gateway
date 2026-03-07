import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { SpacesAdminMcpFacadeService } from "../src/services/spaces-admin-mcp-facade-service.js";

describe("SpacesAdminMcpFacadeService", () => {
  test("returns null for unrelated paths", async () => {
    const service = new SpacesAdminMcpFacadeService({
      orchestratorCommandService: {
        submitCommand: async () => ({}) as any,
      },
      defaultTargetSpaceId: "main-space",
    });

    const request = new Request("http://localhost/not-mcp", { method: "POST", body: "{}" });
    const response = await service.handleRequest(request, new URL(request.url));
    expect(response).toBeNull();
  });

  test("serves tools/list and tools/call", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const service = new SpacesAdminMcpFacadeService({
      orchestratorCommandService: {
        submitCommand: async (input) => {
          calls.push(input as Record<string, unknown>);
          return {
            commandId: "orch-1",
            commandType: input.commandType,
            targetSpaceId: input.targetSpaceId,
            status: "completed",
          } as any;
        },
      },
      defaultTargetSpaceId: "main-space",
    });

    const listRequest = new Request("http://localhost/mcp/spaces-admin", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
      }),
    });
    const listResponse = await service.handleRequest(listRequest, new URL(listRequest.url));
    expect(listResponse?.status).toBe(200);
    const listBody = await listResponse!.json() as { result?: { tools?: Array<{ name?: string }> } };
    expect(Array.isArray(listBody.result?.tools)).toBe(true);
    expect(listBody.result?.tools?.some((tool) => tool.name === "spaces.admin.handoff_room")).toBe(true);

    const callRequest = new Request("http://localhost/mcp/spaces-admin", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-spaceskit-principal-id": "principal-a",
        "x-spaceskit-device-id": "device-a",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "spaces.admin.create_room",
          arguments: {
            targetSpaceId: "space-main",
            resourceId: "resource:main",
            name: "Design Room",
            goal: "Design handoff",
          },
        },
      }),
    });
    const callResponse = await service.handleRequest(callRequest, new URL(callRequest.url));
    expect(callResponse?.status).toBe(200);
    const callBody = await callResponse!.json() as { result?: { isError?: boolean } };
    expect(callBody.result?.isError).toBe(false);
    expect(calls.length).toBe(1);
    expect(calls[0].commandType).toBe("create_room");
    expect(calls[0].targetSpaceId).toBe("space-main");
    expect(calls[0].principalId).toBe("principal-a");
    expect(calls[0].deviceId).toBe("device-a");
    const payload = calls[0].payload as Record<string, unknown>;
    expect(payload.targetSpaceId).toBeUndefined();
    expect(payload.name).toBe("Design Room");
  });

  test("requires authenticated principal when configured", async () => {
    const service = new SpacesAdminMcpFacadeService({
      orchestratorCommandService: {
        submitCommand: async () => ({}) as any,
      },
      defaultTargetSpaceId: "main-space",
      requireAuthenticatedPrincipal: true,
    });

    const request = new Request("http://localhost/mcp/spaces-admin", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
      }),
    });

    const response = await service.handleRequest(request, new URL(request.url));
    expect(response?.status).toBe(401);
    const body = await response!.json() as { error?: { data?: { code?: string } } };
    expect(body.error?.data?.code).toBe("UNAUTHENTICATED");
  });

  test("returns method-not-found for unsupported tools", async () => {
    const service = new SpacesAdminMcpFacadeService({
      orchestratorCommandService: {
        submitCommand: async () => ({}) as any,
      },
      defaultTargetSpaceId: "main-space",
    });

    const request = new Request("http://localhost/mcp/spaces-admin", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "spaces.admin.unknown",
          arguments: {},
        },
      }),
    });
    const response = await service.handleRequest(request, new URL(request.url));
    expect(response?.status).toBe(500);
    const body = await response!.json() as { error?: { data?: { code?: string } } };
    expect(body.error?.data?.code).toBe("INTERNAL");
  });

  test("enforces signed bearer tokens in strict principal-auth mode", async () => {
    let capturedPrincipalId: string | undefined;
    const now = new Date("2026-03-02T20:00:00.000Z");
    const service = new SpacesAdminMcpFacadeService({
      orchestratorCommandService: {
        submitCommand: async (input) => {
          capturedPrincipalId = input.principalId;
          return {
            commandId: "orch-2",
            commandType: input.commandType,
            status: "completed",
          } as any;
        },
      },
      defaultTargetSpaceId: "main-space",
      requireAuthenticatedPrincipal: true,
      principalAuth: {
        strictVerification: true,
        hs256Secret: "test-secret",
        now: () => now,
      },
    });

    const forgedRequest = new Request("http://localhost/mcp/spaces-admin", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-spaceskit-principal-id": "forged-principal",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "spaces.admin.list_rooms",
          arguments: {},
        },
      }),
    });
    const forgedResponse = await service.handleRequest(forgedRequest, new URL(forgedRequest.url));
    expect(forgedResponse?.status).toBe(401);
    const forgedBody = await forgedResponse!.json() as { error?: { data?: { code?: string } } };
    expect(forgedBody.error?.data?.code).toBe("UNAUTHENTICATED");

    const signedToken = signHs256Token({
      sub: "principal-strict",
      exp: Math.floor(now.getTime() / 1000) + 60,
    }, "test-secret");
    const signedRequest = new Request("http://localhost/mcp/spaces-admin", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${signedToken}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "spaces.admin.list_rooms",
          arguments: {},
        },
      }),
    });
    const signedResponse = await service.handleRequest(signedRequest, new URL(signedRequest.url));
    expect(signedResponse?.status).toBe(200);
    expect(capturedPrincipalId).toBe("principal-strict");
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
