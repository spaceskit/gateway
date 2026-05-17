/**
 * Agent profile repository — manages agent personality profiles and revisions.
 */

import type { Database } from "bun:sqlite";

export interface ProfileRow {
  profile_id: string;
  persona_id: string;
  name: string;
  description: string;
  can_moderate: number;
  visibility: number;
  is_default: number;
  active_revision: number;
  archived: number;
  created_at: string;
  updated_at: string;
}

export interface ProfileModelConfig {
  preferredModels: string[];
  fallbackModels?: string[];
  constraints?: Record<string, unknown>;
}

export interface ProfileRevisionRow {
  id: number;
  profile_id: string;
  revision: number;
  personality_prompt: string;
  default_skill_set_ids_json: string;
  provider_hint: string;
  model_config_json: string;
  source: string;
  created_at: string;
}

export interface CreateProfileInput {
  profileId: string;
  personaId?: string;
  name: string;
  description?: string;
  canModerate?: boolean;
  isDefault?: boolean;
  personalityPrompt?: string;
  defaultSkillIds?: string[];
  providerHint?: string;
  modelConfig?: ProfileModelConfig;
  source?: string;
}

export interface UpdateProfileInput {
  profileId: string;
  personaId?: string;
  name?: string;
  description?: string;
  personalityPrompt?: string;
  defaultSkillIds?: string[];
  providerHint?: string;
  modelConfig?: ProfileModelConfig;
  canModerate?: boolean;
  isDefault?: boolean;
  source?: string;
}

export class ProfileRepository {
  constructor(private db: Database) {
    this.ensureCanonicalColumns();
  }

  create(input: CreateProfileInput): ProfileRow {
    const now = new Date().toISOString();
    const modelConfig = normalizeModelConfig(input.modelConfig);

    this.db.transaction(() => {
      this.db.query(`
        INSERT INTO agent_profiles(
          profile_id, persona_id, name, description, can_moderate, visibility,
          is_default, active_revision, archived, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 1, ?, 1, 0, ?, ?)
      `).run(
        input.profileId,
        input.personaId ?? "",
        input.name,
        input.description ?? "",
        input.canModerate ? 1 : 0,
        input.isDefault ? 1 : 0,
        now,
        now,
      );

      this.db.query(`
        INSERT INTO agent_profile_revisions(
          profile_id, revision, personality_prompt, default_skill_set_ids_json,
          provider_hint, model_config_json, source, created_at
        ) VALUES (?, 1, ?, ?, ?, ?, ?, ?)
      `).run(
        input.profileId,
        input.personalityPrompt ?? "",
        JSON.stringify(normalizeStringList(input.defaultSkillIds)),
        input.providerHint ?? "",
        JSON.stringify(modelConfig),
        input.source ?? "manual",
        now,
      );
    })();

    return this.getById(input.profileId)!;
  }

  getById(profileId: string): ProfileRow | undefined {
    return this.db
      .query("SELECT * FROM agent_profiles WHERE profile_id = ?")
      .get(profileId) as ProfileRow | undefined ?? undefined;
  }

  getActiveById(profileId: string): ProfileRow | undefined {
    return this.db
      .query("SELECT * FROM agent_profiles WHERE profile_id = ? AND archived = 0")
      .get(profileId) as ProfileRow | undefined ?? undefined;
  }

  list(options: { includeArchived?: boolean } = {}): ProfileRow[] {
    if (options.includeArchived) {
      return this.db
        .query("SELECT * FROM agent_profiles ORDER BY name")
        .all() as ProfileRow[];
    }

    return this.listActive();
  }

  listActive(): ProfileRow[] {
    return this.db
      .query("SELECT * FROM agent_profiles WHERE archived = 0 ORDER BY name")
      .all() as ProfileRow[];
  }

  getActiveRevision(profileId: string): ProfileRevisionRow | undefined {
    return this.db.query(`
      SELECT r.* FROM agent_profile_revisions r
      JOIN agent_profiles p ON r.profile_id = p.profile_id AND r.revision = p.active_revision
      WHERE r.profile_id = ?
    `).get(profileId) as ProfileRevisionRow | undefined ?? undefined;
  }

  update(input: UpdateProfileInput): {
    profile: ProfileRow;
    revision: ProfileRevisionRow;
  } {
    const profile = this.getById(input.profileId);
    if (!profile) {
      throw new Error(`Profile not found: ${input.profileId}`);
    }

    const active = this.getActiveRevision(input.profileId);
    if (!active) {
      throw new Error(`Active profile revision not found: ${input.profileId}`);
    }

    const nextRevision = profile.active_revision + 1;
    const now = new Date().toISOString();
    const existingModelConfig = parseModelConfig(active.model_config_json);
    const nextModelConfig = input.modelConfig === undefined
      ? existingModelConfig
      : normalizeModelConfig(input.modelConfig);
    const nextDefaultSkills = input.defaultSkillIds
      ? normalizeStringList(input.defaultSkillIds)
      : parseStringArray(active.default_skill_set_ids_json);

    this.db.transaction(() => {
      this.db.query(`
        INSERT INTO agent_profile_revisions(
          profile_id, revision, personality_prompt, default_skill_set_ids_json,
          provider_hint, model_config_json, source, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        input.profileId,
        nextRevision,
        input.personalityPrompt ?? active.personality_prompt ?? "",
        JSON.stringify(nextDefaultSkills),
        input.providerHint ?? active.provider_hint ?? "",
        JSON.stringify(nextModelConfig),
        input.source ?? "manual",
        now,
      );

      this.db.query(`
        UPDATE agent_profiles
        SET
          persona_id = ?,
          name = ?,
          description = ?,
          can_moderate = ?,
          is_default = ?,
          active_revision = ?,
          updated_at = ?
        WHERE profile_id = ?
      `).run(
        input.personaId ?? profile.persona_id ?? "",
        input.name ?? profile.name,
        input.description ?? profile.description,
        input.canModerate === undefined ? profile.can_moderate : input.canModerate ? 1 : 0,
        input.isDefault === undefined ? profile.is_default : input.isDefault ? 1 : 0,
        nextRevision,
        now,
        input.profileId,
      );
    })();

    return {
      profile: this.getById(input.profileId)!,
      revision: this.getActiveRevision(input.profileId)!,
    };
  }

  archive(profileId: string): void {
    this.db
      .query("UPDATE agent_profiles SET archived = 1, updated_at = ? WHERE profile_id = ?")
      .run(new Date().toISOString(), profileId);
  }

  restore(profileId: string): void {
    this.db
      .query("UPDATE agent_profiles SET archived = 0, updated_at = ? WHERE profile_id = ?")
      .run(new Date().toISOString(), profileId);
  }

  private ensureCanonicalColumns(): void {
    const columns = this.db
      .query("PRAGMA table_info(agent_profiles)")
      .all() as Array<{ name: string }>;
    const columnNames = new Set(columns.map((column) => column.name));
    if (!columnNames.has("persona_id")) {
      this.db.exec(
        "ALTER TABLE agent_profiles ADD COLUMN persona_id TEXT NOT NULL DEFAULT ''",
      );
    }
  }
}

function parseStringArray(value: string | null | undefined): string[] {
  if (!value?.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return normalizeStringList(parsed);
  } catch {
    return [];
  }
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0),
    ),
  );
}

function normalizeModelConfig(
  config: ProfileModelConfig | undefined,
): ProfileModelConfig {
  const preferredModels = normalizeStringList(config?.preferredModels);
  const fallbackModels = normalizeStringList(config?.fallbackModels);

  const constraints = config?.constraints && isRecord(config.constraints)
    ? config.constraints
    : undefined;

  return {
    preferredModels,
    fallbackModels,
    ...(constraints ? { constraints } : {}),
  };
}

function parseModelConfig(
  raw: string | null | undefined,
): ProfileModelConfig {
  if (raw?.trim()) {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      return {
        preferredModels: normalizeStringList(parsed.preferredModels),
        fallbackModels: normalizeStringList(parsed.fallbackModels),
        ...(isRecord(parsed.constraints) ? { constraints: parsed.constraints } : {}),
      };
    } catch {
      // Treat malformed model config as empty; model_config_json is canonical.
    }
  }

  return { preferredModels: [], fallbackModels: [] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
