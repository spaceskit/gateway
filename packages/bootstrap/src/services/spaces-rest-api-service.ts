import { effectiveToolMatrixFromAccess } from "@spaceskit/server";
import {
  resolveHttpPrincipalContext,
  type HttpPrincipalAuthOptions,
} from "./http-principal-auth.js";
import { resolveExecutionOriginForPrincipal } from "./execution-origin-service.js";
import {
  jsonError,
  jsonOk,
  mapServiceError,
  matchPath,
  normalizeAccessMode,
  normalizeOptionalString,
  normalizeRequired,
  parseBooleanQuery,
  parseJsonBody,
  parseNonNegativeInt,
  parsePositiveInt,
} from "./spaces-rest-api-service-helpers.js";

import type { AccessAction, SpacesRestApiServiceOptions } from "./spaces-rest-api-service-types.js";
export type { AccessAction, SpacesRestApiServiceOptions } from "./spaces-rest-api-service-types.js";
export class SpacesRestApiService {
  constructor(private readonly options: SpacesRestApiServiceOptions) {}

  async handleRequest(req: Request, url: URL): Promise<Response | null> {
    const uploadMatch = matchPath(url.pathname, ["v1", "spaces", ":spaceId", "changesets", ":changeSetId", "files"]);
    const diffMatch = matchPath(url.pathname, ["v1", "spaces", ":spaceId", "changesets", ":changeSetId", "diff"]);
    const usageMatch = matchPath(url.pathname, ["v1", "spaces", ":spaceId", "usage"]);
    const resetUsageMatch = matchPath(url.pathname, ["v1", "spaces", ":spaceId", "usage", "agents", ":agentId", "reset"]);
    const activityLogMatch = matchPath(url.pathname, ["v1", "spaces", ":spaceId", "activity-log"]);
    const traceMatch = matchPath(url.pathname, ["v1", "spaces", ":spaceId", "turns", ":turnId", "trace"]);
    const listArtifactsMatch = matchPath(url.pathname, ["v1", "spaces", ":spaceId", "artifacts"]);
    const getArtifactMatch = matchPath(url.pathname, ["v1", "spaces", ":spaceId", "artifacts", ":artifactId"]);
    const effectiveToolsMatch = matchPath(url.pathname, ["v1", "spaces", ":spaceId", "tools", "effective"]);
    if (
      !uploadMatch
      && !diffMatch
      && !usageMatch
      && !resetUsageMatch
      && !activityLogMatch
      && !traceMatch
      && !listArtifactsMatch
      && !getArtifactMatch
      && !effectiveToolsMatch
    ) {
      return null;
    }

    const auth = resolveHttpPrincipalContext(req, this.options.principalAuth);
    if (!auth.ok) {
      return jsonError(401, auth.error.code, auth.error.message);
    }
    const principalId = auth.context.principalId ?? null;

    if (uploadMatch) {
      if (this.options.requireAuthenticatedPrincipal && !principalId) {
        return jsonError(401, "UNAUTHENTICATED", "Authenticated principal identity is required");
      }
      return this.handleUploadChangeSetFile(req, uploadMatch.spaceId, uploadMatch.changeSetId, principalId);
    }

    if (diffMatch) {
      if (this.options.requireAuthenticatedPrincipal && !principalId) {
        return jsonError(401, "UNAUTHENTICATED", "Authenticated principal identity is required");
      }
      return this.handleGetChangeSetDiff(req, diffMatch.spaceId, diffMatch.changeSetId, principalId);
    }

    if (usageMatch) {
      if (this.options.requireAuthenticatedPrincipal && !principalId) {
        return jsonError(401, "UNAUTHENTICATED", "Authenticated principal identity is required");
      }
      return this.handleGetUsage(req, url, usageMatch.spaceId, principalId);
    }

    if (resetUsageMatch) {
      if (this.options.requireAuthenticatedPrincipal && !principalId) {
        return jsonError(401, "UNAUTHENTICATED", "Authenticated principal identity is required");
      }
      return this.handleResetAgentUsageSession(req, resetUsageMatch.spaceId, resetUsageMatch.agentId, principalId);
    }

    if (activityLogMatch) {
      if (this.options.requireAuthenticatedPrincipal && !principalId) {
        return jsonError(401, "UNAUTHENTICATED", "Authenticated principal identity is required");
      }
      return this.handleListActivityLog(req, url, activityLogMatch.spaceId, principalId);
    }

    if (traceMatch) {
      if (this.options.requireAuthenticatedPrincipal && !principalId) {
        return jsonError(401, "UNAUTHENTICATED", "Authenticated principal identity is required");
      }
      return this.handleGetTurnTrace(req, url, traceMatch.spaceId, traceMatch.turnId, principalId);
    }

    if (listArtifactsMatch) {
      if (this.options.requireAuthenticatedPrincipal && !principalId) {
        return jsonError(401, "UNAUTHENTICATED", "Authenticated principal identity is required");
      }
      return this.handleListArtifacts(req, url, listArtifactsMatch.spaceId, principalId);
    }

    if (getArtifactMatch) {
      if (this.options.requireAuthenticatedPrincipal && !principalId) {
        return jsonError(401, "UNAUTHENTICATED", "Authenticated principal identity is required");
      }
      return this.handleGetArtifact(req, getArtifactMatch.spaceId, getArtifactMatch.artifactId, principalId);
    }

    if (effectiveToolsMatch) {
      if (this.options.requireAuthenticatedPrincipal && !principalId) {
        return jsonError(401, "UNAUTHENTICATED", "Authenticated principal identity is required");
      }
      return this.handleGetEffectiveTools(req, url, effectiveToolsMatch.spaceId, principalId);
    }

    return null;
  }

  private async handleUploadChangeSetFile(
    req: Request,
    spaceIdRaw: string,
    changeSetIdRaw: string,
    principalId: string | null,
  ): Promise<Response> {
    if (req.method !== "POST") {
      return jsonError(405, "METHOD_NOT_ALLOWED", "Expected POST");
    }
    if (!this.options.spaceChangeSetService) {
      return jsonError(412, "FAILED_PRECONDITION", "Changeset service unavailable");
    }

    const spaceId = normalizeRequired(spaceIdRaw);
    const changeSetId = normalizeRequired(changeSetIdRaw);
    if (!principalId) {
      return jsonError(401, "UNAUTHENTICATED", "Principal identity is required");
    }

    const access = this.evaluateAccess(spaceId, principalId, "write");
    if (!access.allowed) {
      return jsonError(403, "PERMISSION_DENIED", access.reason ?? "Access denied");
    }

    const body = await parseJsonBody(req);
    if (!body.ok) {
      return body.response;
    }

    const relativePath = normalizeOptionalString(body.value.relativePath);
    if (!relativePath) {
      return jsonError(400, "INVALID_ARGUMENT", "relativePath is required");
    }

    try {
      const init = await this.options.spaceChangeSetService.uploadFileInit({
        spaceId,
        changeSetId,
        principalId,
        relativePath,
      });

      const content = normalizeOptionalString(body.value.content);
      const contentBase64 = normalizeOptionalString(body.value.contentBase64)
        ?? (content !== undefined ? Buffer.from(content, "utf8").toString("base64") : undefined);

      const result = await this.options.spaceChangeSetService.uploadFileComplete({
        spaceId,
        changeSetId,
        principalId,
        uploadId: init.uploadId,
        contentBase64,
        sourcePath: normalizeOptionalString(body.value.sourcePath),
        expectedSha256: normalizeOptionalString(body.value.expectedSha256),
      });
      return jsonOk(result);
    } catch (error) {
      return mapServiceError(error);
    }
  }

  private async handleGetChangeSetDiff(
    req: Request,
    spaceIdRaw: string,
    changeSetIdRaw: string,
    principalId: string | null,
  ): Promise<Response> {
    if (req.method !== "GET") {
      return jsonError(405, "METHOD_NOT_ALLOWED", "Expected GET");
    }
    if (!this.options.spaceChangeSetService) {
      return jsonError(412, "FAILED_PRECONDITION", "Changeset service unavailable");
    }

    const spaceId = normalizeRequired(spaceIdRaw);
    const changeSetId = normalizeRequired(changeSetIdRaw);
    const access = this.evaluateAccess(spaceId, principalId, "read");
    if (!access.allowed) {
      return jsonError(403, "PERMISSION_DENIED", access.reason ?? "Access denied");
    }

    try {
      const diff = await this.options.spaceChangeSetService.getChangeSetDiff(spaceId, changeSetId);
      return jsonOk(diff);
    } catch (error) {
      return mapServiceError(error);
    }
  }

  private async handleGetUsage(
    req: Request,
    url: URL,
    spaceIdRaw: string,
    principalId: string | null,
  ): Promise<Response> {
    if (req.method !== "GET") {
      return jsonError(405, "METHOD_NOT_ALLOWED", "Expected GET");
    }
    if (!this.options.spaceQuotaService) {
      return jsonError(412, "FAILED_PRECONDITION", "Space quota service unavailable");
    }

    const spaceId = normalizeRequired(spaceIdRaw);
    const access = this.evaluateAccess(spaceId, principalId, "read");
    if (!access.allowed) {
      return jsonError(403, "PERMISSION_DENIED", access.reason ?? "Access denied");
    }

    try {
      const usage = this.options.spaceQuotaService.getUsage(
        spaceId,
        principalId ?? undefined,
        {
          includeAgentSessions: parseBooleanQuery(url.searchParams.get("includeAgentSessions")),
          includeGlobalLifetime: parseBooleanQuery(url.searchParams.get("includeGlobalLifetime")),
        },
      );
      return jsonOk(usage);
    } catch (error) {
      return mapServiceError(error);
    }
  }

  private async handleResetAgentUsageSession(
    req: Request,
    spaceIdRaw: string,
    agentIdRaw: string,
    principalId: string | null,
  ): Promise<Response> {
    if (req.method !== "POST") {
      return jsonError(405, "METHOD_NOT_ALLOWED", "Expected POST");
    }
    if (!this.options.spaceQuotaService?.resetAgentUsageSession) {
      return jsonError(412, "FAILED_PRECONDITION", "Space quota service unavailable");
    }

    const spaceId = normalizeRequired(spaceIdRaw);
    const agentId = normalizeRequired(agentIdRaw);
    if (!principalId) {
      return jsonError(401, "UNAUTHENTICATED", "Principal identity is required");
    }
    const access = this.evaluateAccess(spaceId, principalId, "write");
    if (!access.allowed) {
      return jsonError(403, "PERMISSION_DENIED", access.reason ?? "Access denied");
    }

    try {
      const result = this.options.spaceQuotaService.resetAgentUsageSession(spaceId, agentId, principalId);
      return jsonOk(result);
    } catch (error) {
      return mapServiceError(error);
    }
  }

  private async handleGetTurnTrace(
    req: Request,
    url: URL,
    spaceIdRaw: string,
    turnIdRaw: string,
    principalId: string | null,
  ): Promise<Response> {
    if (req.method !== "GET") {
      return jsonError(405, "METHOD_NOT_ALLOWED", "Expected GET");
    }
    if (!this.options.spaceTurnTraceService) {
      return jsonError(412, "FAILED_PRECONDITION", "Space turn trace service unavailable");
    }

    const spaceId = normalizeRequired(spaceIdRaw);
    const turnId = normalizeRequired(turnIdRaw);
    const access = this.evaluateAccess(spaceId, principalId, "read");
    if (!access.allowed) {
      return jsonError(403, "PERMISSION_DENIED", access.reason ?? "Access denied");
    }

    try {
      const trace = await this.options.spaceTurnTraceService.getTurnTrace({
        spaceId,
        turnId,
        limit: parsePositiveInt(url.searchParams.get("limit")),
        offset: parseNonNegativeInt(url.searchParams.get("offset")),
      });
      return jsonOk({ trace });
    } catch (error) {
      return mapServiceError(error);
    }
  }

  private async handleListActivityLog(
    req: Request,
    url: URL,
    spaceIdRaw: string,
    principalId: string | null,
  ): Promise<Response> {
    if (req.method !== "GET") {
      return jsonError(405, "METHOD_NOT_ALLOWED", "Expected GET");
    }
    if (!this.options.spaceTurnTraceService?.listActivityLog) {
      return jsonError(412, "FAILED_PRECONDITION", "Space activity log service unavailable");
    }

    const spaceId = normalizeRequired(spaceIdRaw);
    const access = this.evaluateAccess(spaceId, principalId, "read");
    if (!access.allowed) {
      return jsonError(403, "PERMISSION_DENIED", access.reason ?? "Access denied");
    }

    try {
      const result = await this.options.spaceTurnTraceService.listActivityLog({
        spaceId,
        turnId: normalizeOptionalString(url.searchParams.get("turnId")),
        limit: parsePositiveInt(url.searchParams.get("limit")),
        offset: parseNonNegativeInt(url.searchParams.get("offset")),
        includeSystem: parseBooleanQuery(url.searchParams.get("includeSystem")) ?? true,
      });
      return jsonOk(result);
    } catch (error) {
      return mapServiceError(error);
    }
  }

  private async handleListArtifacts(
    req: Request,
    url: URL,
    spaceIdRaw: string,
    principalId: string | null,
  ): Promise<Response> {
    if (req.method !== "GET") {
      return jsonError(405, "METHOD_NOT_ALLOWED", "Expected GET");
    }
    if (!this.options.spaceArtifactService) {
      return jsonError(412, "FAILED_PRECONDITION", "Space artifact service unavailable");
    }

    const spaceId = normalizeRequired(spaceIdRaw);
    const access = this.evaluateAccess(spaceId, principalId, "read");
    if (!access.allowed) {
      return jsonError(403, "PERMISSION_DENIED", access.reason ?? "Access denied");
    }

    try {
      const result = await this.options.spaceArtifactService.listArtifacts({
        spaceId,
        turnId: normalizeOptionalString(url.searchParams.get("turnId")),
        limit: parsePositiveInt(url.searchParams.get("limit")),
        offset: parseNonNegativeInt(url.searchParams.get("offset")),
      });
      return jsonOk(result);
    } catch (error) {
      return mapServiceError(error);
    }
  }

  private async handleGetArtifact(
    req: Request,
    spaceIdRaw: string,
    artifactIdRaw: string,
    principalId: string | null,
  ): Promise<Response> {
    if (req.method !== "GET") {
      return jsonError(405, "METHOD_NOT_ALLOWED", "Expected GET");
    }
    if (!this.options.spaceArtifactService) {
      return jsonError(412, "FAILED_PRECONDITION", "Space artifact service unavailable");
    }

    const spaceId = normalizeRequired(spaceIdRaw);
    const artifactId = normalizeRequired(artifactIdRaw);
    const access = this.evaluateAccess(spaceId, principalId, "read");
    if (!access.allowed) {
      return jsonError(403, "PERMISSION_DENIED", access.reason ?? "Access denied");
    }

    try {
      const artifact = await this.options.spaceArtifactService.getArtifact({
        spaceId,
        artifactId,
      });
      return jsonOk({ artifact });
    } catch (error) {
      return mapServiceError(error);
    }
  }

  private async handleGetEffectiveTools(
    req: Request,
    url: URL,
    spaceIdRaw: string,
    principalId: string | null,
  ): Promise<Response> {
    if (req.method !== "GET") {
      return jsonError(405, "METHOD_NOT_ALLOWED", "Expected GET");
    }
    if (!this.options.toolAccessPolicyService) {
      return jsonError(412, "FAILED_PRECONDITION", "Tool access policy service unavailable");
    }

    const spaceId = normalizeRequired(spaceIdRaw);
    const deviceId = normalizeOptionalString(req.headers.get("x-spaceskit-device-id"));
    const accessMode = normalizeAccessMode(url.searchParams.get("accessMode"));
    const access = this.evaluateAccess(spaceId, principalId, "read");
    if (!access.allowed) {
      return jsonError(403, "PERMISSION_DENIED", access.reason ?? "Access denied");
    }

    try {
      const access = await this.options.toolAccessPolicyService.getEffectiveToolAccess({
        spaceId,
        principalId: principalId ?? undefined,
        deviceId: deviceId ?? undefined,
        executionOrigin: resolveExecutionOriginForPrincipal({
          spaceId,
          principalId,
          evaluateAccess: this.options.spaceSharingService
            ? (candidateSpaceId, candidatePrincipalId) => this.options.spaceSharingService!.evaluateAccess({
              spaceId: candidateSpaceId,
              principalId: candidatePrincipalId,
              action: "read",
            })
            : null,
          getActiveParticipant: this.options.spaceSharingService
            ? (candidateSpaceId, candidatePrincipalId) => this.options.spaceSharingService!.getActiveParticipant(
              candidateSpaceId,
              candidatePrincipalId,
            )
            : null,
        }),
        agentId: normalizeOptionalString(url.searchParams.get("agentId")),
        accessMode,
      });
      return jsonOk({ matrix: effectiveToolMatrixFromAccess(access) });
    } catch (error) {
      return mapServiceError(error);
    }
  }

  private evaluateAccess(
    spaceId: string,
    principalId: string | null,
    action: AccessAction,
  ): {
    allowed: boolean;
    reason?: string;
  } {
    if (!this.options.spaceSharingService) {
      return { allowed: true };
    }
    const decision = this.options.spaceSharingService.evaluateAccess({
      spaceId,
      principalId: principalId ?? undefined,
      action,
    });
    return {
      allowed: decision.allowed,
      reason: decision.reason,
    };
  }

}
