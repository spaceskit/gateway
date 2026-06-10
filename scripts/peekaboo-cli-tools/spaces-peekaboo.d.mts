export function buildPeekabooCommandArgs(operation: string, payload?: Record<string, unknown>): string[];

export function runPeekabooOperation(
  input: {
    operation: string;
    payload?: Record<string, unknown>;
    env?: NodeJS.ProcessEnv;
  },
  dependencies?: {
    runCommand?: (input: {
      executable: string;
      args: string[];
      env: NodeJS.ProcessEnv;
      stdin?: string;
    }) => Promise<{ exitCode: number; stdout: string; stderr: string }>;
  },
): Promise<Record<string, unknown>>;

export function parseWrapperCliArgs(argv?: string[]): {
  help: boolean;
  version: boolean;
  operation: string;
  payload: Record<string, unknown>;
};

export function resolvePeekabooExecutable(env?: NodeJS.ProcessEnv): string;
