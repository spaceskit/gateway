import type { SpaceArtifactService } from "./space-artifact-service.js";
import type { SpaceChangeSetService } from "./space-changeset-service.js";
import type { SpaceQuotaService } from "./space-quota-service.js";
import type { SpaceSharingService } from "./space-sharing-service.js";
import type { SpaceTurnTraceService } from "./space-turn-trace-service.js";
import type { ToolAccessPolicyService } from "./tool-access-policy-service.js";
import type { HttpPrincipalAuthOptions } from "./http-principal-auth.js";

export type AccessAction = "read" | "write";

export interface SpacesRestApiServiceOptions {
  spaceChangeSetService?: Pick<
    SpaceChangeSetService,
    "uploadFileInit" | "uploadFileComplete" | "getChangeSetDiff"
  >;
  spaceQuotaService?: Pick<SpaceQuotaService, "getUsage">
    & Partial<Pick<SpaceQuotaService, "resetAgentUsageSession">>;
  spaceTurnTraceService?: Pick<SpaceTurnTraceService, "getTurnTrace" | "listActivityLog">;
  spaceArtifactService?: Pick<SpaceArtifactService, "listArtifacts" | "getArtifact">;
  toolAccessPolicyService?: Pick<ToolAccessPolicyService, "getEffectiveToolAccess">;
  spaceSharingService?: Pick<SpaceSharingService, "evaluateAccess" | "getActiveParticipant">;
  principalAuth?: HttpPrincipalAuthOptions;
  /**
   * If true, all matched routes require an authenticated principal identity.
   */
  requireAuthenticatedPrincipal?: boolean;
}

