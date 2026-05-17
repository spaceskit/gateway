import { randomUUID } from "node:crypto";
import type { SpaceParticipantRepository } from "@spaceskit/persistence";
import { normalizeAccessMode } from "./space-sharing-service-helpers.js";
import { SpaceSharingError } from "./space-sharing-service-types.js";

export function assertCollaboratorAccess(
  participants: SpaceParticipantRepository,
  spaceId: string,
  principalId: string,
): void {
  const activeCount = participants.countActiveBySpace(spaceId);
  if (activeCount === 0) {
    participants.upsert({
      participantId: `participant-${randomUUID()}`,
      spaceId,
      principalId,
      principalType: "public_key",
      mode: "collaborator",
    });
    return;
  }

  const participant = participants.getActiveByPrincipal(spaceId, principalId);
  if (!participant) {
    throw new SpaceSharingError(
      "PERMISSION_DENIED",
      "Only collaborators can manage sharing",
    );
  }

  if (normalizeAccessMode(participant.mode) !== "collaborator") {
    throw new SpaceSharingError(
      "PERMISSION_DENIED",
      "Read-only users cannot manage sharing",
    );
  }
}
