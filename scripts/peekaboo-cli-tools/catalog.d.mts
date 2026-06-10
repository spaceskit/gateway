export interface PeekabooCliToolDefinition {
  id: string;
  operation: string;
  bundleId: string;
  payloadSchema: {
    properties?: Record<string, { description?: string }>;
  };
  instructions?: string;
}

export const PEEKABOO_TOOL_DEFINITIONS: PeekabooCliToolDefinition[];

export function getPeekabooToolDefinitionByOperation(operation: string): PeekabooCliToolDefinition | null;

export function resolveDefaultSpacesPeekabooWrapperPath(): string;

export function buildPeekabooCliManifest(
  tool: PeekabooCliToolDefinition,
  input?: {
    wrapperPath?: string;
    fixedCwd?: string;
    now?: string;
    enabled?: boolean;
  },
): Record<string, unknown>;

export function buildPeekabooCliToolReadme(tool: PeekabooCliToolDefinition): string;
