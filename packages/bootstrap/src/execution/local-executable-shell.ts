import { basename } from "node:path";

export function shellInvocationArgs(shellPath: string, command: string): string[] {
  const name = basename(shellPath).toLowerCase();
  switch (name) {
    case "tcsh":
    case "csh":
      return ["-l", "-c", command];
    case "fish":
      return ["-l", "-c", command];
    default:
      return ["-lc", command];
  }
}

export function shellLookupCommands(shellPath: string): string[] {
  const name = basename(shellPath).toLowerCase();
  switch (name) {
    case "tcsh":
    case "csh":
      return ["which"];
    default:
      return ["command -v", "which"];
  }
}

export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

export function firstNonEmptyLine(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
}
