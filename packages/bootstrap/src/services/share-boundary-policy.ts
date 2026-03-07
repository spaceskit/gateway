import { BASIC_SPACE_ARTIFACT_TYPE } from "./basic-space-export.js";

export interface BoundaryPolicyDecision {
  allowed: boolean;
  reason?: string;
}

export interface SyncBoundaryPolicyInput {
  globalFlags?: Record<string, unknown>;
  peerId: string;
  resourceType: string;
  resourceId: string;
  operation: "query" | "pull";
  artifactType?: string;
  title?: string;
  tags?: string[];
  isGeneratedBasic?: boolean;
}

export interface CrossSpaceBoundaryPolicyInput {
  globalFlags?: Record<string, unknown>;
  sourceSpaceId: string;
  targetSpaceId: string;
  artifactId: string;
  operation: "share" | "import";
  artifactType?: string;
  title?: string;
  tags?: string[];
  isGeneratedBasic?: boolean;
}

export function evaluateSyncBoundaryPolicy(input: SyncBoundaryPolicyInput): BoundaryPolicyDecision {
  const flags = input.globalFlags;
  if (flags?.syncRequiresApproval === true) {
    return { allowed: false, reason: "syncRequiresApproval is enabled" };
  }
  if (flags?.syncEnabled === false) {
    return { allowed: false, reason: "syncEnabled is false" };
  }
  if (input.operation === "query" && flags?.syncQueryEnabled === false) {
    return { allowed: false, reason: "syncQueryEnabled is false" };
  }
  if (input.operation === "pull" && flags?.syncPullEnabled === false) {
    return { allowed: false, reason: "syncPullEnabled is false" };
  }

  const deniedPeerIds = new Set(parsePolicyStringList(flags?.syncDeniedPeerIds));
  if (deniedPeerIds.has(input.peerId)) {
    return { allowed: false, reason: `Peer denied by policy: ${input.peerId}` };
  }

  const allowedPeerIds = parsePolicyStringList(flags?.syncAllowedPeerIds);
  if (allowedPeerIds.length > 0 && !allowedPeerIds.includes(input.peerId)) {
    return { allowed: false, reason: `Peer not allowlisted: ${input.peerId}` };
  }

  const deniedResourceTypes = new Set(parsePolicyStringList(flags?.syncDeniedResourceTypes));
  if (deniedResourceTypes.has(input.resourceType)) {
    return { allowed: false, reason: `Resource type denied: ${input.resourceType}` };
  }

  const allowedResourceTypes = parsePolicyStringList(flags?.syncAllowedResourceTypes);
  if (allowedResourceTypes.length > 0 && !allowedResourceTypes.includes(input.resourceType)) {
    return { allowed: false, reason: `Resource type not allowlisted: ${input.resourceType}` };
  }

  if (input.resourceType !== "artifact") {
    return { allowed: true };
  }

  return evaluateArtifactBoundary({
    artifactType: input.artifactType,
    tags: input.tags,
    isGeneratedBasic: input.isGeneratedBasic,
    allowedTypes: parsePolicyStringList(flags?.syncAllowedArtifactTypes),
    allowedTags: parsePolicyStringList(flags?.syncAllowedArtifactTags),
    reasonPrefix: "Sync artifacts are restricted to basic.md by default",
  });
}

export function evaluateCrossSpaceBoundaryPolicy(
  input: CrossSpaceBoundaryPolicyInput,
): BoundaryPolicyDecision {
  const flags = input.globalFlags;

  if (flags?.crossSpaceRequiresApproval === true) {
    return { allowed: false, reason: "crossSpaceRequiresApproval is enabled" };
  }

  return evaluateArtifactBoundary({
    artifactType: input.artifactType,
    tags: input.tags,
    isGeneratedBasic: input.isGeneratedBasic,
    allowedTypes: parsePolicyStringList(flags?.crossSpaceAllowedArtifactTypes),
    allowedTags: parsePolicyStringList(flags?.crossSpaceAllowedArtifactTags),
    reasonPrefix: "Cross-space artifacts are restricted to basic.md by default",
  });
}

function evaluateArtifactBoundary(input: {
  artifactType?: string;
  tags?: string[];
  isGeneratedBasic?: boolean;
  allowedTypes: string[];
  allowedTags: string[];
  reasonPrefix: string;
}): BoundaryPolicyDecision {
  if (input.isGeneratedBasic || input.artifactType === BASIC_SPACE_ARTIFACT_TYPE) {
    return { allowed: true };
  }

  const artifactType = typeof input.artifactType === "string" ? input.artifactType.trim() : "";
  if (artifactType.length > 0 && input.allowedTypes.includes(artifactType)) {
    return { allowed: true };
  }

  const tagSet = new Set(input.allowedTags);
  const tagAllowed = Array.isArray(input.tags)
    && input.tags.some((tag) => tagSet.has(tag));
  if (tagAllowed) {
    return { allowed: true };
  }

  const allowlistHint = "Set allowlist flags to permit additional artifact types or tags.";
  return { allowed: false, reason: `${input.reasonPrefix}. ${allowlistHint}` };
}

function parsePolicyStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  );
}
