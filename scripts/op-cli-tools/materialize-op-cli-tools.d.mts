export interface MaterializeOpCliToolsInput {
  targetDir: string;
  wrapperPath?: string;
  fixedCwd?: string;
  toolIds?: string[];
}

export function materializeOpCliTools(
  input: MaterializeOpCliToolsInput,
): Promise<unknown>;
