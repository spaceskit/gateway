import type { Database } from "bun:sqlite";

export interface SchedulerJobSpaceRow {
  job_id: string;
  space_id: string;
  linked_at: string;
}

export class SchedulerJobSpaceRepository {
  constructor(private readonly db: Database) {}

  upsert(jobId: string, spaceId: string): SchedulerJobSpaceRow {
    const now = new Date().toISOString();
    this.db.query(`
      INSERT INTO scheduler_job_spaces(job_id, space_id, linked_at)
      VALUES (?, ?, ?)
      ON CONFLICT(job_id, space_id) DO UPDATE SET
        linked_at = excluded.linked_at
    `).run(jobId, spaceId, now);
    return this.get(jobId, spaceId)!;
  }

  get(jobId: string, spaceId: string): SchedulerJobSpaceRow | undefined {
    return this.db.query(`
      SELECT * FROM scheduler_job_spaces
      WHERE job_id = ? AND space_id = ?
    `).get(jobId, spaceId) as SchedulerJobSpaceRow | undefined ?? undefined;
  }

  listByJob(jobId: string): SchedulerJobSpaceRow[] {
    return this.db.query(`
      SELECT * FROM scheduler_job_spaces
      WHERE job_id = ?
      ORDER BY linked_at DESC
    `).all(jobId) as SchedulerJobSpaceRow[];
  }

  listBySpace(spaceId: string): SchedulerJobSpaceRow[] {
    return this.db.query(`
      SELECT * FROM scheduler_job_spaces
      WHERE space_id = ?
      ORDER BY linked_at DESC
    `).all(spaceId) as SchedulerJobSpaceRow[];
  }

  replaceForJob(jobId: string, spaceIds: string[]): SchedulerJobSpaceRow[] {
    const uniqueSpaceIds = Array.from(new Set(spaceIds.map((spaceId) => spaceId.trim()).filter(Boolean)));
    this.db.query(`
      DELETE FROM scheduler_job_spaces
      WHERE job_id = ?
    `).run(jobId);

    for (const spaceId of uniqueSpaceIds) {
      this.upsert(jobId, spaceId);
    }

    return this.listByJob(jobId);
  }

  delete(jobId: string, spaceId: string): boolean {
    return this.db.query(`
      DELETE FROM scheduler_job_spaces
      WHERE job_id = ? AND space_id = ?
    `).run(jobId, spaceId).changes > 0;
  }

  deleteForJob(jobId: string): number {
    return this.db.query(`
      DELETE FROM scheduler_job_spaces
      WHERE job_id = ?
    `).run(jobId).changes;
  }
}
