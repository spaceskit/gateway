import type {
  ModelMessage,
  TokenUsage,
} from "@spaceskit/core";
import type {
  CommandSpec,
  SupportedProviderId,
} from "./cli-executor-command-types.js";
import { asRecord, asString } from "./cli-executor-json-helpers.js";

export function renderPrompt(messages: ModelMessage[]): string {
  return messages
    .map((message) => {
      const role = message.role.toUpperCase();
      const suffix = message.role === "tool" && message.toolName
        ? ` (${message.toolName})`
        : "";
      return `${role}${suffix}:\n${message.content}`.trim();
    })
    .join("\n\n");
}

export function extractCliOutput(providerId: SupportedProviderId, stdout: string): string {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return "";
  }

  if (providerId === "codex") {
    const parsed = extractLastJsonText(trimmed);
    if (parsed) {
      return parsed;
    }
  }

  return trimmed;
}

function extractLastJsonText(stdout: string): string | null {
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("{") && line.endsWith("}"));

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const parsed = JSON.parse(lines[index]) as Record<string, unknown>;
      const directText = asString(parsed.text) || asString(parsed.message);
      if (directText) {
        return directText.trim();
      }
      const data = asRecord(parsed.data);
      const dataText = asString(data?.text) || asString(data?.message);
      if (dataText) {
        return dataText.trim();
      }
    } catch {
      continue;
    }
  }

  return null;
}

export function estimateUsage(messages: ModelMessage[], output: string): TokenUsage {
  const promptChars = messages.reduce((total, message) => total + message.content.length, 0);
  const promptTokens = Math.ceil(promptChars / 4);
  const completionTokens = Math.ceil(output.length / 4);
  return {
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
    tokenAccuracy: "estimated",
    usageSource: "ledger",
  };
}

export function commandPreview(spec: CommandSpec): string {
  const args = spec.args.map(shellEscape).join(" ");
  const cwdPrefix = spec.cwd ? `cd ${shellEscape(spec.cwd)} && ` : "";
  return `${cwdPrefix}${shellEscape(spec.executable)}${args ? ` ${args}` : ""}`;
}

function shellEscape(value: string): string {
  if (/^[A-Za-z0-9_./:-]+$/.test(value)) {
    return value;
  }
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
