import { describe, expect, test } from "bun:test";
import { SpacesRestApiService } from "../src/services/spaces-rest-api-service.js";
import { createHttpPrincipalTestContext } from "./http-principal-test-helpers.js";

describe("SpacesRestApiService", () => {
  test("returns null for unrelated paths", async () => {
    const service = new SpacesRestApiService({});
    const response = await service.handleRequest(
      new Request("http://localhost/unknown", { method: "GET" }),
      new URL("http://localhost/unknown"),
    );
    expect(response).toBeNull();
  });

  test("uploads a changeset file via POST /v1/spaces/:spaceId/changesets/:changeSetId/files", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const auth = createHttpPrincipalTestContext();
    const service = new SpacesRestApiService({
      principalAuth: auth.principalAuth,
      spaceChangeSetService: {
        uploadFileInit: async (input) => {
          calls.push({ step: "init", ...input });
          return {
            uploadId: "upload-1",
            changeSet: {} as any,
            relativePath: input.relativePath,
          };
        },
        uploadFileComplete: async (input) => {
          calls.push({ step: "complete", ...input });
          return {
            changeSet: { changeSetId: input.changeSetId } as any,
            file: { relativePath: "docs/readme.md" } as any,
          };
        },
        getChangeSetDiff: async () => ({ changeSetId: "unused", unifiedDiff: "", files: [], generatedAt: "" }),
      },
    });

    const request = new Request("http://localhost/v1/spaces/space-a/changesets/cs-1/files", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...auth.headers("principal-a"),
      },
      body: JSON.stringify({
        relativePath: "docs/readme.md",
        content: "# Hello",
      }),
    });

    const response = await service.handleRequest(request, new URL(request.url));
    expect(response?.status).toBe(200);
    const body = await response!.json() as { file?: { relativePath?: string } };
    expect(body.file?.relativePath).toBe("docs/readme.md");
    expect(calls.length).toBe(2);
    expect(calls[0].step).toBe("init");
    expect(calls[1].step).toBe("complete");
  });

  test("requires principal identity for file upload", async () => {
    const service = new SpacesRestApiService({
      spaceChangeSetService: {
        uploadFileInit: async () => {
          throw new Error("should not run");
        },
        uploadFileComplete: async () => {
          throw new Error("should not run");
        },
        getChangeSetDiff: async () => ({ changeSetId: "unused", unifiedDiff: "", files: [], generatedAt: "" }),
      },
    });

    const request = new Request("http://localhost/v1/spaces/space-a/changesets/cs-1/files", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ relativePath: "docs/readme.md", content: "x" }),
    });

    const response = await service.handleRequest(request, new URL(request.url));
    expect(response?.status).toBe(401);
    const body = await response!.json() as { code?: string };
    expect(body.code).toBe("UNAUTHENTICATED");
  });

  test("returns usage and effective tools endpoints", async () => {
    const auth = createHttpPrincipalTestContext();
    let effectiveToolAccessInput: Record<string, unknown> | undefined;
    const service = new SpacesRestApiService({
      principalAuth: auth.principalAuth,
      spaceQuotaService: {
        getUsage: (spaceId, principalId) => ({
          spaceId,
          principalId,
          spaceUsage: { openChangeSets: 1 },
        }) as any,
      },
      toolAccessPolicyService: {
        getEffectiveToolAccess: async (input) => ({
          ...(effectiveToolAccessInput = input as Record<string, unknown>),
          spaceId: input.spaceId,
          agentId: input.agentId,
          policyVersion: "tool_access_policy_v1",
          dangerousCapabilities: [],
          operations: [],
          generatedAt: new Date().toISOString(),
        }) as any,
      },
      spaceSharingService: {
        evaluateAccess: () => ({ allowed: true, enforced: false, mode: "collaborator" }),
        getActiveParticipant: () => null,
      },
    });

    const usageRequest = new Request("http://localhost/v1/spaces/space-a/usage", {
      method: "GET",
      headers: auth.headers("principal-a"),
    });
    const usageResponse = await service.handleRequest(usageRequest, new URL(usageRequest.url));
    expect(usageResponse?.status).toBe(200);
    const usageBody = await usageResponse!.json() as { spaceId?: string };
    expect(usageBody.spaceId).toBe("space-a");

    const toolsRequest = new Request(
      "http://localhost/v1/spaces/space-a/tools/effective?agentId=agent-1&accessMode=full_access",
      {
      method: "GET",
      headers: {
        ...auth.headers("principal-a"),
        "x-spaceskit-device-id": "device-a",
      },
    },
    );
    const toolsResponse = await service.handleRequest(toolsRequest, new URL(toolsRequest.url));
    expect(toolsResponse?.status).toBe(200);
    const toolsBody = await toolsResponse!.json() as { matrix?: { agentId?: string } };
    expect(toolsBody.matrix?.agentId).toBe("agent-1");
    expect(effectiveToolAccessInput).toMatchObject({
      spaceId: "space-a",
      principalId: "principal-a",
      deviceId: "device-a",
      executionOrigin: "owner",
      agentId: "agent-1",
      accessMode: "full_access",
    });
  });

  test("supports trace, artifacts, and agent usage reset endpoints", async () => {
    const auth = createHttpPrincipalTestContext();
    const service = new SpacesRestApiService({
      principalAuth: auth.principalAuth,
      spaceQuotaService: {
        getUsage: () => ({ spaceUsage: {} }) as any,
        resetAgentUsageSession: (spaceId, agentId, principalId) => ({
          closedSessionId: "aus-old",
          activeSession: {
            sessionId: "aus-new",
            spaceId,
            agentId,
            agentRole: "agent",
            status: "active",
            startedAt: new Date().toISOString(),
            lastActivityAt: new Date().toISOString(),
            turnCount: 0,
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
            spentUsd: 0,
            resetBy: principalId,
          },
        }) as any,
      },
      spaceTurnTraceService: {
        getTurnTrace: () => ({
          spaceId: "space-a",
          turnId: "turn-1",
          total: 1,
          events: [],
          toolCalls: [],
          artifactIds: [],
        }),
      },
      spaceArtifactService: {
        listArtifacts: () => ({
          artifacts: [
            {
              artifactId: "artifact-1",
              spaceId: "space-a",
              type: "summary",
              title: "Summary",
              sizeBytes: 12,
              tags: [],
              visibility: "shared",
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          ],
          total: 1,
        }),
        getArtifact: () => ({
          artifactId: "artifact-1",
          spaceId: "space-a",
          type: "summary",
          title: "Summary",
          sizeBytes: 12,
          tags: [],
          visibility: "shared",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          content: "hello",
        }),
      },
    });

    const traceRequest = new Request("http://localhost/v1/spaces/space-a/turns/turn-1/trace", {
      method: "GET",
      headers: auth.headers("principal-a"),
    });
    const traceResponse = await service.handleRequest(traceRequest, new URL(traceRequest.url));
    expect(traceResponse?.status).toBe(200);
    const traceBody = await traceResponse!.json() as { trace?: { turnId?: string } };
    expect(traceBody.trace?.turnId).toBe("turn-1");

    const listRequest = new Request("http://localhost/v1/spaces/space-a/artifacts", {
      method: "GET",
      headers: auth.headers("principal-a"),
    });
    const listResponse = await service.handleRequest(listRequest, new URL(listRequest.url));
    expect(listResponse?.status).toBe(200);
    const listBody = await listResponse!.json() as { total?: number };
    expect(listBody.total).toBe(1);

    const getRequest = new Request("http://localhost/v1/spaces/space-a/artifacts/artifact-1", {
      method: "GET",
      headers: auth.headers("principal-a"),
    });
    const getResponse = await service.handleRequest(getRequest, new URL(getRequest.url));
    expect(getResponse?.status).toBe(200);
    const getBody = await getResponse!.json() as { artifact?: { artifactId?: string } };
    expect(getBody.artifact?.artifactId).toBe("artifact-1");

    const resetRequest = new Request("http://localhost/v1/spaces/space-a/usage/agents/agent-1/reset", {
      method: "POST",
      headers: auth.headers("principal-a"),
    });
    const resetResponse = await service.handleRequest(resetRequest, new URL(resetRequest.url));
    expect(resetResponse?.status).toBe(200);
    const resetBody = await resetResponse!.json() as { activeSession?: { agentId?: string } };
    expect(resetBody.activeSession?.agentId).toBe("agent-1");
  });

  test("requires authenticated principal for matched routes when configured", async () => {
    const service = new SpacesRestApiService({
      requireAuthenticatedPrincipal: true,
      spaceQuotaService: {
        getUsage: () => ({}) as any,
      },
    });

    const request = new Request("http://localhost/v1/spaces/space-a/usage", {
      method: "GET",
    });

    const response = await service.handleRequest(request, new URL(request.url));
    expect(response?.status).toBe(401);
    const body = await response!.json() as { code?: string };
    expect(body.code).toBe("UNAUTHENTICATED");
  });

  test("enforces signed bearer tokens in strict principal-auth mode", async () => {
    let seenPrincipalId: string | undefined;
    const auth = createHttpPrincipalTestContext();
    const service = new SpacesRestApiService({
      principalAuth: auth.strictPrincipalAuth,
      spaceQuotaService: {
        getUsage: (_spaceId, principalId) => {
          seenPrincipalId = principalId;
          return {
            spaceUsage: { openChangeSets: 0 },
          } as any;
        },
      },
    });

    const headerOnlyRequest = new Request("http://localhost/v1/spaces/space-a/usage", {
      method: "GET",
      headers: {
        "x-spaceskit-principal-id": "forged-principal",
      },
    });
    const headerOnlyResponse = await service.handleRequest(headerOnlyRequest, new URL(headerOnlyRequest.url));
    expect(headerOnlyResponse?.status).toBe(401);
    const headerOnlyBody = await headerOnlyResponse!.json() as { code?: string };
    expect(headerOnlyBody.code).toBe("UNAUTHENTICATED");

    const signedRequest = new Request("http://localhost/v1/spaces/space-a/usage", {
      method: "GET",
      headers: auth.headers("principal-strict"),
    });
    const signedResponse = await service.handleRequest(signedRequest, new URL(signedRequest.url));
    expect(signedResponse?.status).toBe(200);
    expect(seenPrincipalId).toBe("principal-strict");
  });
});
