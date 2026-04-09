import { describe, expect, test } from "bun:test";
import { GatewayObservabilityApiService } from "../src/services/gateway-observability-api-service.js";
import { createHttpPrincipalTestContext } from "./http-principal-test-helpers.js";

describe("GatewayObservabilityApiService", () => {
  test("serves summary and metrics endpoints", async () => {
    const service = new GatewayObservabilityApiService({
      observabilityService: {
        getSummary: () => ({
          generatedAt: "2026-03-01T00:00:00.000Z",
          relay: {},
          sandbox: {},
        }),
        formatPrometheus: () => "metric_one 1\n",
      } as any,
    });

    const summaryRequest = new Request("http://localhost/v1/observability/summary", {
      method: "GET",
    });
    const summaryResponse = await service.handleRequest(summaryRequest, new URL(summaryRequest.url));
    expect(summaryResponse?.status).toBe(200);
    const summaryBody = await summaryResponse!.json() as { generatedAt?: string };
    expect(summaryBody.generatedAt).toBe("2026-03-01T00:00:00.000Z");

    const metricsRequest = new Request("http://localhost/metrics", {
      method: "GET",
    });
    const metricsResponse = await service.handleRequest(metricsRequest, new URL(metricsRequest.url));
    expect(metricsResponse?.status).toBe(200);
    expect(metricsResponse?.headers.get("content-type")).toContain("text/plain");
    const metricsBody = await metricsResponse!.text();
    expect(metricsBody).toBe("metric_one 1\n");
  });

  test("requires authenticated principal when configured", async () => {
    const auth = createHttpPrincipalTestContext();
    const service = new GatewayObservabilityApiService({
      requireAuthenticatedPrincipal: true,
      principalAuth: auth.principalAuth,
      observabilityService: {
        getSummary: () => ({ generatedAt: "x", relay: {}, sandbox: {} }),
        formatPrometheus: () => "x 1\n",
      } as any,
    });

    const unauthRequest = new Request("http://localhost/metrics", { method: "GET" });
    const unauthResponse = await service.handleRequest(unauthRequest, new URL(unauthRequest.url));
    expect(unauthResponse?.status).toBe(401);

    const authRequest = new Request("http://localhost/metrics", {
      method: "GET",
      headers: auth.headers("principal-1"),
    });
    const authResponse = await service.handleRequest(authRequest, new URL(authRequest.url));
    expect(authResponse?.status).toBe(200);
  });

  test("enforces signed bearer tokens in strict principal-auth mode", async () => {
    const auth = createHttpPrincipalTestContext();
    const service = new GatewayObservabilityApiService({
      requireAuthenticatedPrincipal: true,
      principalAuth: auth.strictPrincipalAuth,
      observabilityService: {
        getSummary: () => ({ generatedAt: "x", relay: {}, sandbox: {} }),
        formatPrometheus: () => "x 1\n",
      } as any,
    });

    const forgedRequest = new Request("http://localhost/metrics", {
      method: "GET",
      headers: {
        "x-spaceskit-principal-id": "forged-principal",
      },
    });
    const forgedResponse = await service.handleRequest(forgedRequest, new URL(forgedRequest.url));
    expect(forgedResponse?.status).toBe(401);
    const forgedBody = await forgedResponse!.json() as { code?: string };
    expect(forgedBody.code).toBe("UNAUTHENTICATED");

    const signedRequest = new Request("http://localhost/metrics", {
      method: "GET",
      headers: auth.headers("principal-strict"),
    });
    const signedResponse = await service.handleRequest(signedRequest, new URL(signedRequest.url));
    expect(signedResponse?.status).toBe(200);
  });
});
