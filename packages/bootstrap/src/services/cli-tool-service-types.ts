export type CliToolCwdMode = "space_root" | "fixed";
export type CliToolOutputMode = "text" | "json";
export type CliToolDangerLevel = "standard" | "destructive";
export type CliToolHealthStatus = "unknown" | "ok" | "degraded";

export interface CliToolExampleRecord {
  name: string;
  description?: string;
  arguments: Record<string, unknown>;
  expectedOutput?: string;
}

export interface CliToolManifestRecord {
  schemaVersion: number;
  id: string;
  displayName: string;
  description: string;
  bundleId?: string;
  bundleDisplayName?: string;
  bundleDescription?: string;
  toolGroupId?: string;
  toolGroupDisplayName?: string;
  executable: string;
  resolvedExecutable: string;
  argsTemplate: string[];
  inputSchema: Record<string, unknown>;
  instructions?: string;
  examples: CliToolExampleRecord[];
  timeoutMs: number;
  maxOutputBytes: number;
  cwdMode: CliToolCwdMode;
  fixedCwd?: string;
  outputMode: CliToolOutputMode;
  dangerLevel: CliToolDangerLevel;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RegisterCliToolInput {
  schemaVersion?: number;
  id: string;
  displayName: string;
  description: string;
  bundleId?: string;
  bundleDisplayName?: string;
  bundleDescription?: string;
  toolGroupId?: string;
  toolGroupDisplayName?: string;
  executable: string;
  argsTemplate: string[];
  inputSchema: Record<string, unknown>;
  instructions?: string;
  examples?: CliToolExampleRecord[];
  timeoutMs?: number;
  maxOutputBytes?: number;
  cwdMode: CliToolCwdMode;
  fixedCwd?: string;
  outputMode: CliToolOutputMode;
  dangerLevel?: CliToolDangerLevel;
  readme?: string;
  enabled?: boolean;
}

export interface RegisteredCliTool extends CliToolManifestRecord {
  providerId: string;
  available: boolean;
  healthStatus: CliToolHealthStatus;
  healthMessage?: string;
  manifestPath: string;
  readmePath?: string;
  readmeContent?: string;
  requiresApproval: boolean;
}

export interface CliToolScaffoldResult {
  manifest: RegisterCliToolInput;
  readme: string;
}

export interface CliToolInvocationPreview {
  toolId: string;
  displayName: string;
  description: string;
  bundleId?: string;
  bundleDisplayName?: string;
  bundleDescription?: string;
  toolGroupId?: string;
  toolGroupDisplayName?: string;
  executable: string;
  resolvedExecutable: string;
  renderedArgs: string[];
  cwdMode: CliToolCwdMode;
  workingDirectory?: string;
  outputMode: CliToolOutputMode;
  dangerLevel: CliToolDangerLevel;
  timeoutMs: number;
  maxOutputBytes: number;
  instructions?: string;
  readmeSummary?: string;
  readmeContent?: string;
}
