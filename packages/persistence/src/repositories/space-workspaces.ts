import type { Database } from "bun:sqlite";

export interface SpaceWorkspaceRow {
  space_id: string;
  explicit_root: string;
  effective_root: string;
  managed_folder_name: string;
  managed_resource_id: string;
  layout_version: number;
  metadata_path: string;
  metadata_status: string;
  metadata_updated_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface UpsertSpaceWorkspaceInput {
  spaceId: string;
  explicitRoot: string;
  effectiveRoot: string;
  managedFolderName?: string;
  managedResourceId: string;
  layoutVersion?: number;
  metadataPath?: string;
  metadataStatus?: string;
  metadataUpdatedAt?: string | null;
}

export class SpaceWorkspaceRepository {
  constructor(private readonly db: Database) {}

  getBySpace(spaceId: string): SpaceWorkspaceRow | undefined {
    return this.db
      .query("SELECT * FROM space_workspaces WHERE space_id = ?")
      .get(spaceId) as SpaceWorkspaceRow | undefined ?? undefined;
  }

  upsert(input: UpsertSpaceWorkspaceInput): SpaceWorkspaceRow {
    const now = new Date().toISOString();
    const existing = this.getBySpace(input.spaceId);
    const createdAt = existing?.created_at ?? now;

    this.db.query(`
      INSERT INTO space_workspaces(
        space_id,
        explicit_root,
        effective_root,
        managed_folder_name,
        managed_resource_id,
        layout_version,
        metadata_path,
        metadata_status,
        metadata_updated_at,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(space_id) DO UPDATE SET
        explicit_root = excluded.explicit_root,
        effective_root = excluded.effective_root,
        managed_folder_name = excluded.managed_folder_name,
        managed_resource_id = excluded.managed_resource_id,
        layout_version = excluded.layout_version,
        metadata_path = excluded.metadata_path,
        metadata_status = excluded.metadata_status,
        metadata_updated_at = excluded.metadata_updated_at,
        updated_at = excluded.updated_at
    `).run(
      input.spaceId,
      input.explicitRoot,
      input.effectiveRoot,
      input.managedFolderName ?? "",
      input.managedResourceId,
      input.layoutVersion ?? 1,
      input.metadataPath ?? "",
      input.metadataStatus ?? "unknown",
      input.metadataUpdatedAt ?? null,
      createdAt,
      now,
    );

    return this.getBySpace(input.spaceId)!;
  }

  delete(spaceId: string): boolean {
    return this.db
      .query("DELETE FROM space_workspaces WHERE space_id = ?")
      .run(spaceId).changes > 0;
  }
}
