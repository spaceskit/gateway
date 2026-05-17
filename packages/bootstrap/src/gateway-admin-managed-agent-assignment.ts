import type { SpaceAdminService } from "@spaceskit/core";
import { isSpaceAdminErrorLike } from "./gateway-admin-model-normalizers.js";

export async function ensureGatewayAdminManagedAgentAssignment(
  spaceAdminService: SpaceAdminService,
  spaceId: string,
  agentId: string,
  profileId: string,
): Promise<boolean> {
  try {
    const space = await spaceAdminService.getSpace(spaceId);
    if (!space) {
      throw new Error(`Space not found: ${spaceId}`);
    }

    const existing = space.agents.find((assignment) => assignment.agentId === agentId);
    if (!existing) {
      await spaceAdminService.addAgent({
        spaceId,
        agentId,
        profileId,
        role: "participant",
      });
      return true;
    }

    if (existing.profileId !== profileId) {
      await spaceAdminService.updateAgentAssignment({
        spaceId,
        agentId,
        profileId,
      });
      return true;
    }

    return false;
  } catch (err) {
    if (isSpaceAdminErrorLike(err) && err.code === "ALREADY_EXISTS") {
      return false;
    }
    throw err;
  }
}
