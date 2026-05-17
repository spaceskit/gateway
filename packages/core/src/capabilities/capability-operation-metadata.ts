import type { CapabilityOperationMetadata, CapabilityType } from "./types.js";

const DEFAULT_PATH_ARGS = [
  "path",
  "filePath",
  "targetPath",
  "sourcePath",
  "destinationPath",
  "directory",
  "cwd",
];

const DEFAULT_COMMAND_ARGS = ["command", "cmd", "script", "program"];

export function defaultOperationMetadata(
  capability: CapabilityType,
  operation: string,
): CapabilityOperationMetadata {
  const normalizedOperation = operation.trim().toLowerCase();
  const filesystemWrite = capability === "files" && isLikelyFilesystemWriteOperation(normalizedOperation);
  const requiresShell = capability === "shell";
  const requiresNetwork = capability === "browser" || capability === "messaging" || capability === "mcp";

  return {
    requiresShell,
    requiresNetwork,
    filesystemWrite,
    pathArgs: capability === "files" ? DEFAULT_PATH_ARGS : undefined,
    commandArgs: requiresShell ? DEFAULT_COMMAND_ARGS : undefined,
  };
}

function isLikelyFilesystemWriteOperation(operation: string): boolean {
  if (!operation) return false;
  return (
    operation.includes("write")
    || operation.includes("append")
    || operation.includes("create")
    || operation.includes("update")
    || operation.includes("save")
    || operation.includes("delete")
    || operation.includes("remove")
    || operation.includes("rename")
    || operation.includes("move")
    || operation.includes("mkdir")
    || operation.includes("touch")
    || operation.includes("copy")
  );
}
