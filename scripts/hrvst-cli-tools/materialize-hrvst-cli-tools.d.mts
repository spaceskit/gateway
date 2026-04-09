export interface MaterializeHrvstCliToolsInput {
  targetDir: string;
  wrapperPath?: string;
  fixedCwd?: string;
  toolIds?: string[];
}

export function materializeHrvstCliTools(
  input: MaterializeHrvstCliToolsInput,
): Promise<unknown>;
