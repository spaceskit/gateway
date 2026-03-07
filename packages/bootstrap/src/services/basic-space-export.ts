import {
  ArtifactRepository,
  type ArtifactRow,
  type SpaceRow,
} from "@spaceskit/persistence";

export const BASIC_SPACE_ALIAS = "basic.md";
export const BASIC_SPACE_ARTIFACT_TYPE = "space.basic_md";
export const BASIC_SPACE_TAG = "space-basic";

const BASIC_SPACE_ARTIFACT_PREFIX = "artifact-basic-";
const BASIC_SPACE_VERSION = "v1";
const MAX_MARKDOWN_BYTES = 8 * 1024;
const MAX_NAME_CHARS = 160;
const MAX_GOAL_CHARS = 2_048;

export interface BasicSpaceMetadata {
  space_id: string;
  name: string;
  goal: string;
  status: string;
  updated_at: string;
}

export interface BasicSpaceContentJson {
  kind: "space.basic_md";
  version: string;
  markdown: string;
  metadata: BasicSpaceMetadata;
}

export interface BasicSpaceExport {
  artifactId: string;
  artifactType: string;
  title: string;
  tags: string[];
  updatedAt: string;
  markdown: string;
  contentJson: string;
  metadata: BasicSpaceMetadata;
}

export function basicSpaceArtifactId(spaceId: string): string {
  return `${BASIC_SPACE_ARTIFACT_PREFIX}${spaceId.trim()}`;
}

export function isBasicSpaceAlias(value: string): boolean {
  return value.trim().toLowerCase() === BASIC_SPACE_ALIAS;
}

export function isBasicSpaceArtifactId(value: string): boolean {
  return value.startsWith(BASIC_SPACE_ARTIFACT_PREFIX) && value.length > BASIC_SPACE_ARTIFACT_PREFIX.length;
}

export function getSpaceIdFromBasicArtifactId(artifactId: string): string | undefined {
  if (!isBasicSpaceArtifactId(artifactId)) {
    return undefined;
  }
  return artifactId.slice(BASIC_SPACE_ARTIFACT_PREFIX.length);
}

export function buildBasicSpaceTags(spaceId: string): string[] {
  return [BASIC_SPACE_TAG, `space:${spaceId.trim()}`];
}

export function isGeneratedBasicArtifact(input: {
  artifactId: string;
  spaceId: string;
  artifactType: string;
}): boolean {
  if (input.artifactType !== BASIC_SPACE_ARTIFACT_TYPE) return false;
  return input.artifactId === basicSpaceArtifactId(input.spaceId);
}

export function createBasicSpaceExport(space: SpaceRow): BasicSpaceExport {
  const metadata: BasicSpaceMetadata = {
    space_id: sanitizeLine(space.space_id, 256),
    name: sanitizeLine(space.name, MAX_NAME_CHARS),
    goal: sanitizeMultiline(space.goal, MAX_GOAL_CHARS),
    status: sanitizeLine(space.status, 64),
    updated_at: sanitizeLine(space.updated_at, 64),
  };

  const markdown = buildBasicMarkdown(metadata);
  const contentPayload: BasicSpaceContentJson = {
    kind: "space.basic_md",
    version: BASIC_SPACE_VERSION,
    markdown,
    metadata,
  };

  return {
    artifactId: basicSpaceArtifactId(metadata.space_id),
    artifactType: BASIC_SPACE_ARTIFACT_TYPE,
    title: BASIC_SPACE_ALIAS,
    tags: buildBasicSpaceTags(metadata.space_id),
    updatedAt: metadata.updated_at,
    markdown,
    contentJson: JSON.stringify(contentPayload),
    metadata,
  };
}

export function buildBasicSyncRef(space: SpaceRow): {
  resourceType: "artifact";
  resourceId: string;
  title: string;
  updatedAt: string;
  tags: string[];
  artifactType: string;
  isGeneratedBasic: true;
} {
  const basic = createBasicSpaceExport(space);
  return {
    resourceType: "artifact",
    resourceId: basic.artifactId,
    title: basic.title,
    updatedAt: basic.updatedAt,
    tags: basic.tags,
    artifactType: basic.artifactType,
    isGeneratedBasic: true,
  };
}

export function buildBasicSyncContent(space: SpaceRow): Record<string, unknown> {
  const basic = createBasicSpaceExport(space);
  return {
    spaceId: space.space_id,
    resourceId: space.resource_id,
    type: basic.artifactType,
    title: basic.title,
    contentJson: basic.contentJson,
    tags: basic.tags,
    visibility: "shared",
    createdAt: space.created_at,
    updatedAt: space.updated_at,
  };
}

export function ensureBasicSpaceArtifact(
  artifacts: ArtifactRepository,
  space: SpaceRow,
): ArtifactRow {
  const basic = createBasicSpaceExport(space);
  const existing = artifacts.getById(basic.artifactId);

  if (existing) {
    if (existing.space_id !== space.space_id) {
      throw new Error(
        `basic.md artifact ${basic.artifactId} is bound to unexpected space ${existing.space_id}`,
      );
    }
    if (existing.artifact_type !== BASIC_SPACE_ARTIFACT_TYPE) {
      throw new Error(
        `basic.md artifact ${basic.artifactId} has unexpected type ${existing.artifact_type}`,
      );
    }

    artifacts.update(existing.artifact_id, {
      title: basic.title,
      contentJson: basic.contentJson,
      tagsJson: JSON.stringify(basic.tags),
      visibility: "shared",
    });
    return artifacts.getById(existing.artifact_id) ?? existing;
  }

  return artifacts.create({
    artifactId: basic.artifactId,
    spaceId: space.space_id,
    resourceId: space.resource_id,
    type: basic.artifactType,
    title: basic.title,
    contentJson: basic.contentJson,
    tagsJson: JSON.stringify(basic.tags),
    visibility: "shared",
  });
}

function sanitizeLine(value: string, maxChars: number): string {
  const cleaned = value
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.slice(0, maxChars);
}

function sanitizeMultiline(value: string, maxChars: number): string {
  const cleaned = value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim();
  return cleaned.slice(0, maxChars);
}

function buildBasicMarkdown(metadata: BasicSpaceMetadata): string {
  const goal = metadata.goal.length > 0 ? metadata.goal : "(empty)";
  const base = [
    "# basic.md",
    `space_id: ${metadata.space_id}`,
    `name: ${metadata.name}`,
    `status: ${metadata.status}`,
    `updated_at: ${metadata.updated_at}`,
    "goal:",
    goal,
  ].join("\n");

  return truncateUtf8(base, MAX_MARKDOWN_BYTES);
}

function truncateUtf8(value: string, maxBytes: number): string {
  const encoder = new TextEncoder();
  if (encoder.encode(value).length <= maxBytes) {
    return value;
  }

  let low = 0;
  let high = value.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    const candidate = value.slice(0, mid);
    if (encoder.encode(candidate).length <= maxBytes) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }

  return value.slice(0, low).trimEnd();
}
