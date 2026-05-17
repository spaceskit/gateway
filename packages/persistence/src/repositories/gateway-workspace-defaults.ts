import type { Database } from "bun:sqlite";

export interface GatewayWorkspaceDefaultsRow {
  singleton_id: number;
  space_home_root: string;
  updated_at: string;
}

export interface SetGatewayWorkspaceDefaultsInput {
  spaceHomeRoot: string;
}

export class GatewayWorkspaceDefaultsRepository {
  constructor(private readonly db: Database) {}

  get(): GatewayWorkspaceDefaultsRow {
    const row = this.db
      .query("SELECT * FROM gateway_workspace_defaults WHERE singleton_id = 1")
      .get() as GatewayWorkspaceDefaultsRow | null;
    if (row) {
      return row;
    }

    const now = new Date().toISOString();
    this.db.query(`
      INSERT INTO gateway_workspace_defaults(
        singleton_id,
        space_home_root,
        updated_at
      ) VALUES (1, '', ?)
      ON CONFLICT(singleton_id) DO NOTHING
    `).run(now);

    return this.db
      .query("SELECT * FROM gateway_workspace_defaults WHERE singleton_id = 1")
      .get() as GatewayWorkspaceDefaultsRow;
  }

  set(input: SetGatewayWorkspaceDefaultsInput): GatewayWorkspaceDefaultsRow {
    const now = new Date().toISOString();
    this.db.query(`
      INSERT INTO gateway_workspace_defaults(
        singleton_id,
        space_home_root,
        updated_at
      ) VALUES (1, ?, ?)
      ON CONFLICT(singleton_id) DO UPDATE SET
        space_home_root = excluded.space_home_root,
        updated_at = excluded.updated_at
    `).run(input.spaceHomeRoot, now);
    return this.get();
  }
}
