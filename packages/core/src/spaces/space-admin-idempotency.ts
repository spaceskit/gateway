import { inferResponseType, stableJsonHash } from "./space-admin-normalizers.js";

export interface SpaceAdminIdempotencyRecord {
  requestHash: string;
  responseType: string;
  responsePayload: string;
}

export interface SaveSpaceAdminIdempotencyRecord extends SpaceAdminIdempotencyRecord {
  principalId: string;
  endpoint: string;
  idempotencyKey: string;
}

export interface SpaceAdminIdempotencyStore {
  loadIdempotencyRecord?: (
    principalId: string,
    endpoint: string,
    idempotencyKey: string,
  ) => Promise<SpaceAdminIdempotencyRecord | null>;
  saveIdempotencyRecord?: (record: SaveSpaceAdminIdempotencyRecord) => Promise<void>;
  onMissingIdempotencyKey?: (endpoint: string) => void;
}

export class SpaceAdminIdempotency {
  constructor(
    private readonly store: SpaceAdminIdempotencyStore,
    private readonly principalId: string,
    private readonly createFailedPreconditionError: (message: string) => Error,
  ) {}

  async run<T>(
    endpoint: string,
    idempotencyKey: string | undefined,
    requestPayload: Record<string, unknown>,
    execute: () => Promise<T>,
  ): Promise<T> {
    const normalizedKey = idempotencyKey?.trim();
    const loadRecord = this.store.loadIdempotencyRecord;
    const saveRecord = this.store.saveIdempotencyRecord;

    if (!normalizedKey || !loadRecord || !saveRecord) {
      if (!normalizedKey && loadRecord && saveRecord) {
        this.store.onMissingIdempotencyKey?.(endpoint);
      }
      return execute();
    }

    const requestHash = stableJsonHash(requestPayload);
    const existing = await loadRecord(this.principalId, endpoint, normalizedKey);
    if (existing) {
      if (existing.requestHash !== requestHash) {
        throw this.createFailedPreconditionError(
          `Idempotency key replay with different request payload: ${normalizedKey}`,
        );
      }

      try {
        return JSON.parse(existing.responsePayload) as T;
      } catch {
        throw this.createFailedPreconditionError("Stored idempotency response is invalid");
      }
    }

    const result = await execute();

    await saveRecord({
      principalId: this.principalId,
      endpoint,
      idempotencyKey: normalizedKey,
      requestHash,
      responseType: inferResponseType(result),
      responsePayload: JSON.stringify(result),
    });

    return result;
  }
}
