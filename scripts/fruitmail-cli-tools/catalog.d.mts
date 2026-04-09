export declare const SPACES_FRUITMAIL_WRAPPER_VERSION: string;
export declare const FRUITMAIL_CLI_TOOL_SCHEMA_VERSION: number;
export declare const FRUITMAIL_CLI_DEFAULT_TIMEOUT_MS: number;

export interface FruitMailToolDefinition {
  id: string;
  toolName: string;
  displayName: string;
  description: string;
  bundleId: string;
  bundleDisplayName: string;
  bundleDescription?: string;
  toolGroupId: string;
  toolGroupDisplayName: string;
  inputSchema: Record<string, unknown>;
  outputHint?: string;
  schemaVersion: number;
  wrapperVersion: string;
  wrapperScriptPath: string;
}

export declare const FRUITMAIL_TOOL_DEFINITIONS: FruitMailToolDefinition[];
export declare function getFruitMailToolDefinitionByOperation(operation: string): FruitMailToolDefinition | undefined;
