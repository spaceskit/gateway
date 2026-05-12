export type SchedulerServiceErrorCode =
  | "INVALID_ARGUMENT"
  | "NOT_FOUND"
  | "FAILED_PRECONDITION"
  | "PERMISSION_DENIED";

export class SchedulerServiceError extends Error {
  readonly code: SchedulerServiceErrorCode;

  constructor(code: SchedulerServiceErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}
