import type { Database } from "bun:sqlite";

export interface SpaceToolPolicyRow {
  space_id: string;
  allowed_tools_json: string;
  denied_tools_json: string;
  policy_version: string;
  updated_by: string;
  updated_at: string;
}

export interface UpsertSpaceToolPolicyInput {
  spaceId: string;
  allowedTools?: string[];
  deniedTools?: string[];
  policyVersion?: string;
  updatedBy?: string;
}

export class SpaceToolPolicyRepository {
  constructor(private readonly db: Database) {}

  getBySpace(spaceId: string): SpaceToolPolicyRow | undefined {
    return this.db.query(`
      SELECT * FROM space_tool_policies
      WHERE space_id = ?
    `).get(spaceId) as SpaceToolPolicyRow | undefined ?? undefined;
  }

  upsert(input: UpsertSpaceToolPolicyInput): SpaceToolPolicyRow {
    const existing = this.getBySpace(input.spaceId);
    const now = new Date().toISOString();
    this.db.query(`
      INSERT INTO space_tool_policies(
        space_id,
        allowed_tools_json,
        denied_tools_json,
        policy_version,
        updated_by,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(space_id) DO UPDATE SET
        allowed_tools_json = excluded.allowed_tools_json,
        denied_tools_json = excluded.denied_tools_json,
        policy_version = excluded.policy_version,
        updated_by = excluded.updated_by,
        updated_at = excluded.updated_at
    `).run(
      input.spaceId,
      JSON.stringify(normalizeToolList(input.allowedTools) ?? normalizeToolListFromRaw(existing?.allowed_tools_json) ?? []),
      JSON.stringify(normalizeToolList(input.deniedTools) ?? normalizeToolListFromRaw(existing?.denied_tools_json) ?? []),
      normalizeString(input.policyVersion) ?? existing?.policy_version ?? "v1",
      normalizeString(input.updatedBy) ?? existing?.updated_by ?? "system",
      now,
    );
    return this.getBySpace(input.spaceId)!;
  }
}

function normalizeToolListFromRaw(raw: string | undefined): string[] | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return normalizeToolList(parsed);
    }
  } catch {
    // Ignore parse failures.
  }
  return undefined;
}

function normalizeToolList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const normalized = value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return Array.from(new Set(normalized));
}

function normalizeString(value: string | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}
