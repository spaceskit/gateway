export type SupportedProviderId = "claude" | "codex" | "gemini";
export type CommandMode = "generate" | "stream";

export interface ModelReference {
  providerId: SupportedProviderId;
  fullModelId: string;
  providerModelId: string;
}

export interface CommandSpec {
  executable: string;
  args: string[];
  stdin?: string;
  cwd?: string;
}
