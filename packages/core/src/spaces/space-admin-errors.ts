export type SpaceAdminErrorCode =
  | "INVALID_ARGUMENT"
  | "NOT_FOUND"
  | "ALREADY_EXISTS"
  | "FAILED_PRECONDITION";

export class SpaceAdminError extends Error {
  readonly code: SpaceAdminErrorCode;

  constructor(code: SpaceAdminErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}
