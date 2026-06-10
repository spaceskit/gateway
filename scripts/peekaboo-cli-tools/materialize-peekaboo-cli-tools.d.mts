export interface MaterializePeekabooCliToolsInput {
  targetDir: string;
  wrapperPath?: string;
  fixedCwd?: string;
  toolIds?: string[];
}

export function materializePeekabooCliTools(
  input: MaterializePeekabooCliToolsInput,
): Promise<{
  wrapperPath: string;
  fixedCwd: string;
  targetDir: string;
  toolCount: number;
  tools: Array<{
    toolId: string;
    operation: string;
    manifestPath: string;
    readmePath: string;
  }>;
}>;

export function resolveDefaultSpacesPeekabooWrapperPath(): string;
