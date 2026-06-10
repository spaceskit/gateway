import type { WorkbenchRunRow } from "@spaceskit/persistence";

export interface WorkbenchExecutorAdapterRunOptions {
  runId: string;
  signal: AbortSignal;
}

export interface WorkbenchExecutorAdapter {
  adapterId: string;
  run(options: WorkbenchExecutorAdapterRunOptions): Promise<WorkbenchRunRow>;
}

export function createInternalWorkbenchExecutorAdapter(
  executeRunIfReady: (runId: string, signal: AbortSignal) => Promise<WorkbenchRunRow>,
): WorkbenchExecutorAdapter {
  return {
    adapterId: "internal-workbench",
    run: (options) => executeRunIfReady(options.runId, options.signal),
  };
}
