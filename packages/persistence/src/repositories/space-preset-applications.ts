/**
 * Space preset application repository — audit trail for preset applications.
 */

import type { Database } from "bun:sqlite";

export interface SpacePresetApplicationRow {
  application_id: string;
  space_id: string;
  preset_id: string;
  preset_kind: string;
  preset_source: string;
  applied_by: string;
  result_json: string;
  applied_at: string;
}

export interface CreateSpacePresetApplicationInput {
  applicationId: string;
  spaceId: string;
  presetId: string;
  presetKind: string;
  presetSource: string;
  appliedBy: string;
  resultJson: string;
}

export class SpacePresetApplicationRepository {
  constructor(private db: Database) {}

  create(input: CreateSpacePresetApplicationInput): SpacePresetApplicationRow {
    const now = new Date().toISOString();
    this.db.query(`
      INSERT INTO space_preset_applications(
        application_id,
        space_id,
        preset_id,
        preset_kind,
        preset_source,
        applied_by,
        result_json,
        applied_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.applicationId,
      input.spaceId,
      input.presetId,
      input.presetKind,
      input.presetSource,
      input.appliedBy,
      input.resultJson,
      now,
    );

    return this.getById(input.applicationId)!;
  }

  getById(applicationId: string): SpacePresetApplicationRow | undefined {
    return this.db.query(`
      SELECT *
      FROM space_preset_applications
      WHERE application_id = ?
      LIMIT 1
    `).get(applicationId) as SpacePresetApplicationRow | undefined ?? undefined;
  }

  listBySpace(spaceId: string, limit = 100): SpacePresetApplicationRow[] {
    return this.db.query(`
      SELECT *
      FROM space_preset_applications
      WHERE space_id = ?
      ORDER BY applied_at DESC
      LIMIT ?
    `).all(spaceId, limit) as SpacePresetApplicationRow[];
  }
}
