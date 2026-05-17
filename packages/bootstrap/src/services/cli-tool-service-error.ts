export class CliToolServiceError extends Error {
  readonly code:
    | "INVALID_ARGUMENT"
    | "NOT_FOUND"
    | "FAILED_PRECONDITION";

  constructor(code: CliToolServiceError["code"], message: string) {
    super(message);
    this.code = code;
  }
}
