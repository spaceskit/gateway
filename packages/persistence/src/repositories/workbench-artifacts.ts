import type { Database } from "bun:sqlite";

export interface WorkbenchArtifactRow {
  artifact_id: string;
  run_id: string;
  kind: string;
  title: string;
  content_type: string;
  content_text: string;
  created_at: string;
}

export interface CreateWorkbenchArtifactInput {
  artifactId: string;
  runId: string;
  kind: string;
  title: string;
  contentType: string;
  contentText: string;
}

export class WorkbenchArtifactRepository {
  constructor(private readonly db: Database) {}

  create(input: CreateWorkbenchArtifactInput): WorkbenchArtifactRow {
    const now = new Date().toISOString();
    this.db.query(`
      INSERT INTO workbench_artifacts(
        artifact_id,
        run_id,
        kind,
        title,
        content_type,
        content_text,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.artifactId,
      input.runId,
      input.kind,
      input.title,
      input.contentType,
      input.contentText,
      now,
    );
    return this.get(input.artifactId)!;
  }

  get(artifactId: string): WorkbenchArtifactRow | undefined {
    return this.db.query(`
      SELECT * FROM workbench_artifacts
      WHERE artifact_id = ?
    `).get(artifactId) as WorkbenchArtifactRow | undefined ?? undefined;
  }

  listByRun(runId: string): WorkbenchArtifactRow[] {
    return this.db.query(`
      SELECT * FROM workbench_artifacts
      WHERE run_id = ?
      ORDER BY created_at ASC
    `).all(runId) as WorkbenchArtifactRow[];
  }
}
