export class CapabilityNotAvailableError extends Error {
  constructor(capability: string, operation: string) {
    super(`No available provider for ${capability}.${operation}`);
    this.name = "CapabilityNotAvailableError";
  }
}

export class CapabilityDeniedError extends Error {
  readonly code = "PERMISSION_DENIED" as const;

  constructor(capability: string, operation: string, reason?: string) {
    super(reason ?? `Capability denied by gateway policy: ${capability}.${operation}`);
    this.name = "CapabilityDeniedError";
  }
}
