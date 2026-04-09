/**
 * InsightAdminApiService — admin REST endpoints for personality insight review.
 *
 * Routes:
 * - GET  /admin/profiles/:profileId/insights — list proposed insights
 * - POST /admin/insights/:insightId/accept   — accept + apply patch to profile
 * - POST /admin/insights/:insightId/reject   — reject insight
 */

import {
  resolveHttpPrincipalContext,
  type HttpPrincipalAuthOptions,
} from "./http-principal-auth.js";
import type { PersonalityInsightRepository } from "@spaceskit/persistence";
import type { ProfileRepository } from "@spaceskit/persistence";

export interface InsightAdminApiServiceOptions {
  personalityInsightRepo: PersonalityInsightRepository;
  profileRepo: ProfileRepository;
  principalAuth?: HttpPrincipalAuthOptions;
  requireAuthenticatedPrincipal?: boolean;
}

export class InsightAdminApiService {
  constructor(private readonly options: InsightAdminApiServiceOptions) {}

  async handleRequest(req: Request, url: URL): Promise<Response | null> {
    const listInsightsMatch = matchPath(url.pathname, ["admin", "profiles", ":profileId", "insights"]);
    const acceptInsightMatch = matchPath(url.pathname, ["admin", "insights", ":insightId", "accept"]);
    const rejectInsightMatch = matchPath(url.pathname, ["admin", "insights", ":insightId", "reject"]);

    if (!listInsightsMatch && !acceptInsightMatch && !rejectInsightMatch) {
      return null;
    }

    const auth = resolveHttpPrincipalContext(req, this.options.principalAuth);
    if (!auth.ok) {
      return jsonError(401, auth.error.code, auth.error.message);
    }
    const principalId = auth.context.principalId;

    if (this.options.requireAuthenticatedPrincipal && !principalId) {
      return jsonError(401, "UNAUTHENTICATED", "Authenticated principal identity is required");
    }

    if (listInsightsMatch) {
      return this.handleListProposed(req, listInsightsMatch.profileId!);
    }
    if (acceptInsightMatch) {
      return this.handleAccept(req, acceptInsightMatch.insightId!);
    }
    if (rejectInsightMatch) {
      return this.handleReject(req, rejectInsightMatch.insightId!);
    }

    return null;
  }

  private async handleListProposed(req: Request, profileId: string): Promise<Response> {
    if (req.method !== "GET") {
      return jsonError(405, "METHOD_NOT_ALLOWED", "Expected GET");
    }
    const insights = this.options.personalityInsightRepo.listProposed(profileId);
    return jsonOk({ profileId, insights });
  }

  private async handleAccept(req: Request, insightId: string): Promise<Response> {
    if (req.method !== "POST") {
      return jsonError(405, "METHOD_NOT_ALLOWED", "Expected POST");
    }

    const insight = this.options.personalityInsightRepo.getById(insightId);
    if (!insight) {
      return jsonError(404, "NOT_FOUND", `Insight not found: ${insightId}`);
    }
    if (insight.status !== "proposed") {
      return jsonError(409, "CONFLICT", `Insight is already ${insight.status}`);
    }

    // Apply the editable_patch to the profile's personality prompt
    const profileId = insight.profile_id;
    const activeRevision = this.options.profileRepo.getActiveRevision(profileId);
    if (!activeRevision) {
      return jsonError(404, "NOT_FOUND", `Active revision not found for profile: ${profileId}`);
    }

    // Parse the editable_patch to extract the proposed prompt delta
    let proposedPromptDelta = "";
    try {
      const patch = JSON.parse(insight.editable_patch);
      proposedPromptDelta = typeof patch.proposedPromptDelta === "string"
        ? patch.proposedPromptDelta
        : "";
    } catch {
      return jsonError(500, "INTERNAL", "Failed to parse editable_patch");
    }

    // Append the delta to the existing personality prompt and create a new revision
    const updatedPrompt = activeRevision.personality_prompt
      ? `${activeRevision.personality_prompt}\n\n${proposedPromptDelta}`
      : proposedPromptDelta;

    this.options.profileRepo.update({
      profileId,
      personalityPrompt: updatedPrompt,
      source: `insight:${insightId}`,
    });

    // Mark insight as accepted
    this.options.personalityInsightRepo.accept(insightId);

    const updated = this.options.personalityInsightRepo.getById(insightId);
    return jsonOk({ insightId, status: "accepted", insight: updated });
  }

  private async handleReject(req: Request, insightId: string): Promise<Response> {
    if (req.method !== "POST") {
      return jsonError(405, "METHOD_NOT_ALLOWED", "Expected POST");
    }

    const insight = this.options.personalityInsightRepo.getById(insightId);
    if (!insight) {
      return jsonError(404, "NOT_FOUND", `Insight not found: ${insightId}`);
    }
    if (insight.status !== "proposed") {
      return jsonError(409, "CONFLICT", `Insight is already ${insight.status}`);
    }

    this.options.personalityInsightRepo.reject(insightId);

    const updated = this.options.personalityInsightRepo.getById(insightId);
    return jsonOk({ insightId, status: "rejected", insight: updated });
  }
}

function matchPath(
  path: string,
  pattern: string[],
): Record<string, string> | null {
  const parts = path
    .split("/")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (parts.length !== pattern.length) return null;
  const captures: Record<string, string> = {};
  for (let index = 0; index < pattern.length; index += 1) {
    const expected = pattern[index]!;
    const actual = parts[index]!;
    if (expected.startsWith(":")) {
      captures[expected.slice(1)] = actual;
      continue;
    }
    if (expected !== actual) return null;
  }
  return captures;
}

function jsonOk(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function jsonError(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ code, message }), {
    status,
    headers: { "content-type": "application/json" },
  });
}
