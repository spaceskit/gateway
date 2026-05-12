/**
 * Migration v10_workbench_execution_context
 *
 * Auto-extracted from the original monolithic schema.ts. Do not edit
 * historical migrations — add new ones to the end of the chain instead.
 */
export const M050_V10_WORKBENCH_EXECUTION_CONTEXT_VERSION = "v10_workbench_execution_context";

export const M050_V10_WORKBENCH_EXECUTION_CONTEXT: readonly string[] = [
  `ALTER TABLE workbench_runs ADD COLUMN execution_context_json TEXT`,
];
