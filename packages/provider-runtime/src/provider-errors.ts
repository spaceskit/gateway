export class ToolsUnsupportedError extends Error {
  readonly code = "TOOLS_UNSUPPORTED";

  constructor(providerId: string, detail?: string) {
    super(
      `[spaceskit:tools-unsupported] ${providerId} native execution does not support gateway tool calls yet.${detail ? ` ${detail}` : ""}`,
    );
    this.name = "ToolsUnsupportedError";
  }
}

export class UnsupportedProviderError extends Error {
  readonly code = "UNSUPPORTED_PROVIDER";

  constructor(providerId: string, detail?: string) {
    super(detail ? `${providerId}: ${detail}` : `Unsupported provider: ${providerId}`);
    this.name = "UnsupportedProviderError";
  }
}
