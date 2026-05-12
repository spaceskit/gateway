export type ManagedSpaceAssignment = {
  agentId: string;
  role: string;
  isPrimary: boolean;
};

export function hasAssignmentPolicyConflicts(
  assignments: ManagedSpaceAssignment[],
  canonicalAgentId: string,
): boolean {
  return assignments.some((assignment) => {
    if (assignment.agentId === canonicalAgentId) {
      return false;
    }
    const role = assignment.role.trim().toLowerCase();
    return assignment.isPrimary || role === "global_coordinator";
  });
}

export function buildCanonicalConciergeSpaceConfigJson(
  existingJson: string | null | undefined,
  conciergeProfileId: string,
): string {
  const parsed = parseSpaceConfigRecord(existingJson);
  parsed.visibility = "private";
  parsed.orchestratorProfileId = conciergeProfileId;
  return JSON.stringify(parsed);
}

export function parseSpaceConfigRecord(
  existingJson: string | null | undefined,
): Record<string, unknown> {
  if (!existingJson?.trim()) {
    return {};
  }
  try {
    const parsed = JSON.parse(existingJson) as Record<string, unknown> | null;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? { ...parsed }
      : {};
  } catch {
    return {};
  }
}
