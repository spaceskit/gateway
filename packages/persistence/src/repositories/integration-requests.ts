import type { Database } from "bun:sqlite";

export type IntegrationRequestStatus = "requested" | "reviewed" | "planned" | "rejected";
export type IntegrationRequestClass = "cloud" | "executor" | "local_runtime";

export interface IntegrationRequestRow {
  integration_request_id: string;
  integration_class: IntegrationRequestClass;
  requested_name: string;
  use_case: string;
  source_url: string;
  notes: string;
  principal_id: string;
  device_id: string;
  status: IntegrationRequestStatus;
  created_at: string;
  updated_at: string;
}

export interface CreateIntegrationRequestInput {
  integrationRequestId: string;
  integrationClass: IntegrationRequestClass;
  requestedName: string;
  useCase?: string;
  sourceUrl?: string;
  notes?: string;
  principalId?: string;
  deviceId?: string;
  status?: IntegrationRequestStatus;
  createdAt?: string;
}

export class IntegrationRequestRepository {
  constructor(private readonly db: Database) {}

  create(input: CreateIntegrationRequestInput): IntegrationRequestRow {
    const createdAt = input.createdAt ?? new Date().toISOString();
    this.db.query(`
      INSERT INTO integration_requests(
        integration_request_id,
        integration_class,
        requested_name,
        use_case,
        source_url,
        notes,
        principal_id,
        device_id,
        status,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.integrationRequestId,
      input.integrationClass,
      input.requestedName,
      input.useCase ?? "",
      input.sourceUrl ?? "",
      input.notes ?? "",
      input.principalId ?? "",
      input.deviceId ?? "",
      input.status ?? "requested",
      createdAt,
      createdAt,
    );
    return this.getById(input.integrationRequestId)!;
  }

  getById(integrationRequestId: string): IntegrationRequestRow | undefined {
    return this.db.query(`
      SELECT * FROM integration_requests WHERE integration_request_id = ?
    `).get(integrationRequestId) as IntegrationRequestRow | undefined ?? undefined;
  }

  list(limit = 100, integrationClass?: IntegrationRequestClass): IntegrationRequestRow[] {
    if (integrationClass) {
      return this.db.query(`
        SELECT * FROM integration_requests
        WHERE integration_class = ?
        ORDER BY created_at DESC
        LIMIT ?
      `).all(integrationClass, normalizeLimit(limit)) as IntegrationRequestRow[];
    }
    return this.db.query(`
      SELECT * FROM integration_requests
      ORDER BY created_at DESC
      LIMIT ?
    `).all(normalizeLimit(limit)) as IntegrationRequestRow[];
  }
}

function normalizeLimit(value: number): number {
  if (!Number.isFinite(value)) return 100;
  return Math.max(1, Math.min(1000, Math.floor(value)));
}
