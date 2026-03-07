import type { Database } from "bun:sqlite";

export interface AgentPresetRow {
  preset_id: string;
  owner_principal_id: string;
  name: string;
  description: string;
  active_revision: number;
  archived: number;
  created_at: string;
  updated_at: string;
}

export interface AgentPresetRevisionRow {
  id: number;
  preset_id: string;
  revision: number;
  preset_config_json: string;
  created_at: string;
}

export interface UpsertAgentPresetInput {
  presetId: string;
  ownerPrincipalId: string;
  name: string;
  description?: string;
  presetConfigJson: string;
}

export class AgentPresetRepository {
  constructor(private db: Database) {}

  getById(presetId: string, ownerPrincipalId?: string): AgentPresetRow | undefined {
    if (ownerPrincipalId) {
      return this.db.query(`
        SELECT *
        FROM agent_presets
        WHERE preset_id = ?
          AND owner_principal_id = ?
      `).get(presetId, ownerPrincipalId) as AgentPresetRow | undefined ?? undefined;
    }

    return this.db.query(`
      SELECT *
      FROM agent_presets
      WHERE preset_id = ?
    `).get(presetId) as AgentPresetRow | undefined ?? undefined;
  }

  list(options: { includeArchived?: boolean; ownerPrincipalId?: string } = {}): AgentPresetRow[] {
    const owner = options.ownerPrincipalId?.trim();

    if (owner && options.includeArchived) {
      return this.db.query(`
        SELECT *
        FROM agent_presets
        WHERE owner_principal_id = ?
        ORDER BY updated_at DESC
      `).all(owner) as AgentPresetRow[];
    }

    if (owner) {
      return this.db.query(`
        SELECT *
        FROM agent_presets
        WHERE owner_principal_id = ?
          AND archived = 0
        ORDER BY updated_at DESC
      `).all(owner) as AgentPresetRow[];
    }

    if (options.includeArchived) {
      return this.db.query(`
        SELECT *
        FROM agent_presets
        ORDER BY updated_at DESC
      `).all() as AgentPresetRow[];
    }

    return this.db.query(`
      SELECT *
      FROM agent_presets
      WHERE archived = 0
      ORDER BY updated_at DESC
    `).all() as AgentPresetRow[];
  }

  getRevision(presetId: string, revision: number): AgentPresetRevisionRow | undefined {
    return this.db.query(`
      SELECT *
      FROM agent_preset_revisions
      WHERE preset_id = ? AND revision = ?
      LIMIT 1
    `).get(presetId, revision) as AgentPresetRevisionRow | undefined ?? undefined;
  }

  getActiveRevision(presetId: string): AgentPresetRevisionRow | undefined {
    return this.db.query(`
      SELECT r.*
      FROM agent_preset_revisions r
      JOIN agent_presets p
        ON p.preset_id = r.preset_id
       AND p.active_revision = r.revision
      WHERE p.preset_id = ?
      LIMIT 1
    `).get(presetId) as AgentPresetRevisionRow | undefined ?? undefined;
  }

  listRevisions(presetId: string): AgentPresetRevisionRow[] {
    return this.db.query(`
      SELECT *
      FROM agent_preset_revisions
      WHERE preset_id = ?
      ORDER BY revision DESC
    `).all(presetId) as AgentPresetRevisionRow[];
  }

  upsertWithNewRevision(input: UpsertAgentPresetInput): {
    preset: AgentPresetRow;
    revision: AgentPresetRevisionRow;
    created: boolean;
  } {
    const now = new Date().toISOString();
    const presetId = input.presetId.trim();
    const ownerPrincipalId = input.ownerPrincipalId.trim();
    const name = input.name.trim();
    const description = (input.description ?? "").trim();

    if (!presetId) {
      throw new Error("presetId is required");
    }
    if (!ownerPrincipalId) {
      throw new Error("ownerPrincipalId is required");
    }
    if (!name) {
      throw new Error("name is required");
    }

    let created = false;
    this.db.transaction(() => {
      const existing = this.getById(presetId);
      const nextRevision = existing ? existing.active_revision + 1 : 1;

      if (
        existing
        && existing.owner_principal_id.length > 0
        && existing.owner_principal_id !== ownerPrincipalId
      ) {
        throw new Error(`Preset ${presetId} is owned by another principal`);
      }

      if (!existing) {
        created = true;
        this.db.query(`
          INSERT INTO agent_presets(
            preset_id,
            owner_principal_id,
            name,
            description,
            active_revision,
            archived,
            created_at,
            updated_at
          ) VALUES (?, ?, ?, ?, 1, 0, ?, ?)
        `).run(presetId, ownerPrincipalId, name, description, now, now);
      } else {
        this.db.query(`
          UPDATE agent_presets
          SET
            owner_principal_id = CASE
              WHEN owner_principal_id = '' THEN ?
              ELSE owner_principal_id
            END,
            name = ?,
            description = ?,
            active_revision = ?,
            archived = 0,
            updated_at = ?
          WHERE preset_id = ?
        `).run(ownerPrincipalId, name, description, nextRevision, now, presetId);
      }

      this.db.query(`
        INSERT INTO agent_preset_revisions(
          preset_id,
          revision,
          preset_config_json,
          created_at
        ) VALUES (?, ?, ?, ?)
      `).run(presetId, nextRevision, input.presetConfigJson, now);
    })();

    const preset = this.getById(presetId);
    const revision = this.getActiveRevision(presetId);
    if (!preset || !revision) {
      throw new Error(`Failed to load upserted agent preset: ${presetId}`);
    }

    return { preset, revision, created };
  }

  claimOwnerIfUnowned(presetId: string, ownerPrincipalId: string): boolean {
    return this.db.query(`
      UPDATE agent_presets
      SET owner_principal_id = ?,
          updated_at = ?
      WHERE preset_id = ?
        AND owner_principal_id = ''
    `).run(ownerPrincipalId, new Date().toISOString(), presetId).changes > 0;
  }

  archive(presetId: string): boolean {
    return this.db.query(`
      UPDATE agent_presets
      SET archived = 1,
          updated_at = ?
      WHERE preset_id = ?
        AND archived = 0
    `).run(new Date().toISOString(), presetId).changes > 0;
  }
}
