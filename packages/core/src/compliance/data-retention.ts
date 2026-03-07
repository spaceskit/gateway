/**
 * GDPR / Data Retention — POST-MVP STUB
 *
 * This module provides the interfaces for GDPR compliance features.
 * Implementation deferred to post-MVP. See STATUS.md for details.
 *
 * TODO: Implement after MVP
 * - Automated purge with configurable per-table retention policies
 * - Subject Access Request (SAR) export in JSON/CSV
 * - Right-to-erasure with proper audit trail
 * - Auto-purge scheduler
 * - Requires legal review before production deployment
 */

/**
 * Retention policy configuration for different data types
 */
export interface RetentionPolicy {
  defaultRetentionDays: number;
  turnRetentionDays?: number;
  experienceRetentionDays?: number;
  artifactRetentionDays?: number;
  auditLogRetentionDays?: number;
}

/**
 * Request for exporting subject data (GDPR right of access)
 */
export interface DataExportRequest {
  requestId: string;
  subjectId: string;
  requestedAt: Date;
  format: "json" | "csv";
  includeTypes: ("turns" | "experiences" | "artifacts" | "profiles" | "auditLogs")[];
}

/**
 * Result of a data export operation
 */
export interface DataExportResult {
  requestId: string;
  subjectId: string;
  completedAt: Date;
  exportPath: string;
  recordCount: number;
  sizeBytes: number;
}

/**
 * Result of a data purge operation
 */
export interface PurgeResult {
  purgedTurns: number;
  purgedExperiences: number;
  purgedArtifacts: number;
  purgedAuditLogs: number;
  purgedAt: Date;
}

/**
 * Options for DataRetentionManager initialization
 */
export interface DataRetentionManagerOptions {
  eventBus: unknown;
  db: unknown;
  exportBasePath?: string;
  policy: RetentionPolicy;
}

/**
 * Manages GDPR compliance — stub implementation.
 * TODO: Implement after MVP.
 */
export class DataRetentionManager {
  constructor(_options: DataRetentionManagerOptions) {
    // Post-MVP
  }

  async purgeExpiredData(): Promise<PurgeResult> {
    throw new Error("DataRetentionManager is a post-MVP stub. Not yet implemented.");
  }

  async exportSubjectData(_request: DataExportRequest): Promise<DataExportResult> {
    throw new Error("DataRetentionManager is a post-MVP stub. Not yet implemented.");
  }

  async deleteSubjectData(_subjectId: string): Promise<void> {
    throw new Error("DataRetentionManager is a post-MVP stub. Not yet implemented.");
  }

  startAutoPurge(_intervalMs?: number): void {
    // no-op stub
  }

  stopAutoPurge(): void {
    // no-op stub
  }

  getRetentionStatus(): Record<string, number | string> {
    return { status: "post-mvp-stub" };
  }
}
