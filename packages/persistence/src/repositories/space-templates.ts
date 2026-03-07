/**
 * Space template repository — manages reusable space template definitions + revisions.
 */

import type { Database } from "bun:sqlite";

export interface SpaceTemplateRow {
  template_id: string;
  owner_principal_id: string;
  name: string;
  description: string;
  active_revision: number;
  archived: number;
  created_at: string;
  updated_at: string;
}

export interface SpaceTemplateRevisionRow {
  id: number;
  template_id: string;
  revision: number;
  space_config_json: string;
  created_at: string;
}

export interface UpsertSpaceTemplateInput {
  templateId: string;
  ownerPrincipalId: string;
  name: string;
  description?: string;
  spaceConfigJson: string;
}

export class SpaceTemplateRepository {
  constructor(private db: Database) {}

  getById(templateId: string, ownerPrincipalId?: string): SpaceTemplateRow | undefined {
    if (ownerPrincipalId) {
      return this.db.query(`
        SELECT *
        FROM space_templates
        WHERE template_id = ?
          AND owner_principal_id = ?
      `).get(templateId, ownerPrincipalId) as SpaceTemplateRow | undefined ?? undefined;
    }

    return this.db.query(`
      SELECT *
      FROM space_templates
      WHERE template_id = ?
    `).get(templateId) as SpaceTemplateRow | undefined ?? undefined;
  }

  list(options: { includeArchived?: boolean; ownerPrincipalId?: string } = {}): SpaceTemplateRow[] {
    const owner = options.ownerPrincipalId?.trim();

    if (owner && options.includeArchived) {
      return this.db.query(`
        SELECT *
        FROM space_templates
        WHERE owner_principal_id = ?
        ORDER BY updated_at DESC
      `).all(owner) as SpaceTemplateRow[];
    }

    if (owner) {
      return this.db.query(`
        SELECT *
        FROM space_templates
        WHERE owner_principal_id = ?
          AND archived = 0
        ORDER BY updated_at DESC
      `).all(owner) as SpaceTemplateRow[];
    }

    if (options.includeArchived) {
      return this.db.query(`
        SELECT *
        FROM space_templates
        ORDER BY updated_at DESC
      `).all() as SpaceTemplateRow[];
    }

    return this.db.query(`
      SELECT *
      FROM space_templates
      WHERE archived = 0
      ORDER BY updated_at DESC
      `).all() as SpaceTemplateRow[];
  }

  getRevision(templateId: string, revision: number): SpaceTemplateRevisionRow | undefined {
    return this.db.query(`
      SELECT *
      FROM space_template_revisions
      WHERE template_id = ? AND revision = ?
      LIMIT 1
    `).get(templateId, revision) as SpaceTemplateRevisionRow | undefined ?? undefined;
  }

  getActiveRevision(templateId: string): SpaceTemplateRevisionRow | undefined {
    return this.db.query(`
      SELECT r.*
      FROM space_template_revisions r
      JOIN space_templates t
        ON t.template_id = r.template_id
       AND t.active_revision = r.revision
      WHERE t.template_id = ?
      LIMIT 1
    `).get(templateId) as SpaceTemplateRevisionRow | undefined ?? undefined;
  }

  listRevisions(templateId: string): SpaceTemplateRevisionRow[] {
    return this.db.query(`
      SELECT *
      FROM space_template_revisions
      WHERE template_id = ?
      ORDER BY revision DESC
    `).all(templateId) as SpaceTemplateRevisionRow[];
  }

  upsertWithNewRevision(input: UpsertSpaceTemplateInput): {
    template: SpaceTemplateRow;
    revision: SpaceTemplateRevisionRow;
    created: boolean;
  } {
    const now = new Date().toISOString();
    const templateId = input.templateId.trim();
    const ownerPrincipalId = input.ownerPrincipalId.trim();
    const name = input.name.trim();
    const description = (input.description ?? "").trim();

    if (!templateId) {
      throw new Error("templateId is required");
    }
    if (!ownerPrincipalId) {
      throw new Error("ownerPrincipalId is required");
    }
    if (!name) {
      throw new Error("name is required");
    }

    let created = false;
    this.db.transaction(() => {
      const existing = this.getById(templateId);
      const nextRevision = existing ? existing.active_revision + 1 : 1;
      if (
        existing
        && existing.owner_principal_id.length > 0
        && existing.owner_principal_id !== ownerPrincipalId
      ) {
        throw new Error(`Template ${templateId} is owned by another principal`);
      }

      if (!existing) {
        created = true;
        this.db.query(`
          INSERT INTO space_templates(
            template_id,
            owner_principal_id,
            name,
            description,
            active_revision,
            archived,
            created_at,
            updated_at
          ) VALUES (?, ?, ?, ?, 1, 0, ?, ?)
        `).run(templateId, ownerPrincipalId, name, description, now, now);
      } else {
        this.db.query(`
          UPDATE space_templates
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
          WHERE template_id = ?
        `).run(ownerPrincipalId, name, description, nextRevision, now, templateId);
      }

      this.db.query(`
        INSERT INTO space_template_revisions(
          template_id,
          revision,
          space_config_json,
          created_at
        ) VALUES (?, ?, ?, ?)
      `).run(templateId, nextRevision, input.spaceConfigJson, now);
    })();

    const template = this.getById(templateId);
    const revision = this.getActiveRevision(templateId);
    if (!template || !revision) {
      throw new Error(`Failed to load upserted template: ${templateId}`);
    }

    return { template, revision, created };
  }

  claimOwnerIfUnowned(templateId: string, ownerPrincipalId: string): boolean {
    return this.db.query(`
      UPDATE space_templates
      SET owner_principal_id = ?,
          updated_at = ?
      WHERE template_id = ?
        AND owner_principal_id = ''
    `).run(ownerPrincipalId, new Date().toISOString(), templateId).changes > 0;
  }

  archive(templateId: string): boolean {
    return this.db.query(`
      UPDATE space_templates
      SET archived = 1,
          updated_at = ?
      WHERE template_id = ?
        AND archived = 0
    `).run(new Date().toISOString(), templateId).changes > 0;
  }
}
