export interface MaterializeJiraCliToolsInput {
  targetDir: string;
  wrapperPath?: string;
  fixedCwd?: string;
  toolIds?: string[];
}

export function materializeJiraCliTools(
  input: MaterializeJiraCliToolsInput,
): Promise<unknown>;
