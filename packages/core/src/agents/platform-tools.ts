/**
 * Platform Introspection Tools — read-only tools for coordinator agents.
 *
 * Public entrypoint for platform tool definitions, executor, and role gating.
 * Implementation details live in sibling modules to keep each source file
 * focused and under the project LOC ceiling.
 */

import type { SpaceAdminService } from "../spaces/space-admin-service.js";
import { PLATFORM_TOOL_PREFIX } from "./platform-tool-helpers.js";

export { createPlatformToolDefinitions } from "./platform-tool-definitions.js";
export { createPlatformToolExecutor } from "./platform-tool-executor.js";
export type {
  PlatformToolConfig,
  PlatformToolExecutionContext,
} from "./platform-tool-types.js";

const PLATFORM_TOOL_ALLOWED_ROLES = new Set(["global_coordinator", "space_moderator"]);

/**
 * Create a filter function that checks if an agent is allowed to use platform tools.
 * Only agents with coordinator or moderator roles get access.
 */
export function createPlatformToolFilter(
  spaceAdminService: SpaceAdminService,
): (spaceId: string, agentId: string) => Promise<boolean> {
  return async (spaceId: string, agentId: string): Promise<boolean> => {
    try {
      const assignments = await spaceAdminService.listAgentAssignments(spaceId);
      const assignment = assignments.find((a) => a.agentId === agentId);
      return assignment ? PLATFORM_TOOL_ALLOWED_ROLES.has(assignment.role) : false;
    } catch {
      return false;
    }
  };
}

/**
 * Check if a tool name is a platform tool.
 */
export function isPlatformTool(toolName: string): boolean {
  return toolName.startsWith(PLATFORM_TOOL_PREFIX);
}
