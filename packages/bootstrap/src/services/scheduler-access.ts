import { SchedulerServiceError } from "./scheduler-errors.js";
import type { SpaceSharingService } from "./space-sharing-service.js";

export function canReadAllSchedulerSpaces(
  spaceSharingService: SpaceSharingService | null,
  spaceIds: string[],
  principalId?: string,
): boolean {
  if (!spaceSharingService) return true;
  for (const spaceId of spaceIds) {
    const decision = spaceSharingService.evaluateAccess({
      spaceId,
      principalId,
      action: "read",
    });
    if (!decision.allowed) {
      return false;
    }
  }
  return true;
}

export function assertSchedulerReadAccess(
  spaceSharingService: SpaceSharingService | null,
  spaceIds: string[],
  principalId?: string,
): void {
  if (!spaceSharingService) return;
  for (const spaceId of spaceIds) {
    const decision = spaceSharingService.evaluateAccess({
      spaceId,
      principalId,
      action: "read",
    });
    if (!decision.allowed) {
      throw new SchedulerServiceError(
        "PERMISSION_DENIED",
        decision.reason ?? "Access denied for scheduler job",
      );
    }
  }
}

export function assertSchedulerWriteAccess(
  spaceSharingService: SpaceSharingService | null,
  spaceIds: string[],
  principalId?: string,
): void {
  if (!spaceSharingService) return;
  for (const spaceId of spaceIds) {
    const decision = spaceSharingService.evaluateAccess({
      spaceId,
      principalId,
      action: "write",
    });
    if (!decision.allowed) {
      throw new SchedulerServiceError(
        "PERMISSION_DENIED",
        decision.reason ?? "Write access denied for scheduler job",
      );
    }
  }
}
