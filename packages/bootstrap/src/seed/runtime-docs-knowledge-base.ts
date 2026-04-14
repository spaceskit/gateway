import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { KnowledgeBaseService } from "../services/knowledge-base-service.js";

const RUNTIME_DOC_ENTRIES = [
  {
    entryId: "kb-runtime-doc-claude-agent-sdk-overview",
    name: "Claude Agent SDK Overview",
    uri: "https://platform.claude.com/docs/en/agent-sdk/overview",
    description: "Official Anthropic overview for the Claude Agent SDK.",
    tags: ["docs", "sdk", "claude", "anthropic", "agent-sdk"],
  },
  {
    entryId: "kb-runtime-doc-openai-codex-sdk",
    name: "OpenAI Codex SDK",
    uri: "https://developers.openai.com/codex/sdk/",
    description: "Official OpenAI Codex SDK documentation.",
    tags: ["docs", "sdk", "codex", "openai"],
  },
  {
    entryId: "kb-runtime-doc-gemini-cli-docs",
    name: "Gemini CLI Docs",
    uri: "https://geminicli.com/docs/",
    description: "Official Gemini CLI documentation.",
    tags: ["docs", "cli", "gemini", "google"],
  },
  {
    entryId: "kb-runtime-doc-harvest-cli",
    name: "Harvest CLI Docs",
    uri: "https://kgajera.github.io/hrvst-cli/",
    description: "Official Harvest CLI documentation.",
    tags: ["docs", "cli", "harvest", "time-tracking", "hrvst"],
  },
  {
    entryId: "kb-runtime-doc-1password-cli",
    name: "1Password CLI Docs",
    uri: "https://developer.1password.com/docs/cli/",
    description: "Official 1Password CLI documentation.",
    tags: ["docs", "cli", "1password", "secrets", "security"],
  },
  {
    entryId: "kb-runtime-doc-codexbar",
    name: "CodexBar — AI Usage Monitor",
    uri: "https://github.com/steipete/CodexBar",
    description: "macOS menu bar app monitoring AI usage limits across Claude, Codex, Gemini and 14+ providers. Bundled CLI for scripting. Gateway integration via SPACESKIT_CODEXBAR_MODE env var.",
    tags: ["docs", "tools", "codexbar", "usage", "monitoring", "macos"],
  },
] as const;

const GENERATED_SPACES_DOC_ENTRIES = [
  {
    entryId: "kb-spaces-generated-doc-protocol-reference",
    name: "Spaces Protocol Generated Reference",
    path: "docs/site/src/content/docs/reference/protocol/index.md",
    description: "Generated Spaces protocol reference rendered from gateway protocol contracts.",
    tags: ["docs", "spaces", "generated-docs", "protocol", "gateway", "workbench"],
  },
  {
    entryId: "kb-spaces-generated-doc-config-reference",
    name: "Spaces Configuration Generated Reference",
    path: "docs/site/src/content/docs/reference/config/index.md",
    description: "Generated Spaces gateway configuration reference rendered from bootstrap environment contracts.",
    tags: ["docs", "spaces", "generated-docs", "config", "gateway", "workbench"],
  },
] as const;

export interface RuntimeDocsKnowledgeSeedOptions {
  repoRoot?: string;
}

export interface GeneratedSpacesDocsKnowledgeEntry {
  entryId: string;
  name: string;
  uri: string;
  description: string;
  tags: string[];
}

export function resolveGeneratedSpacesDocsRepoRoot(startPath = process.cwd()): string {
  const candidates = [
    resolve(startPath),
    resolve(startPath, ".."),
  ];
  return candidates.find((candidate) => existsSync(resolve(
    candidate,
    "docs/site/src/content/docs/reference",
  ))) ?? resolve(startPath);
}

export function listGeneratedSpacesDocsKnowledgeEntries(
  repoRoot: string,
): GeneratedSpacesDocsKnowledgeEntry[] {
  const resolvedRepoRoot = resolve(repoRoot);
  return GENERATED_SPACES_DOC_ENTRIES.map((entry) => ({
    entryId: entry.entryId,
    name: entry.name,
    uri: pathToFileURL(resolve(resolvedRepoRoot, entry.path)).toString(),
    description: entry.description,
    tags: [...entry.tags],
  }));
}

export function seedRuntimeDocsKnowledgeBase(
  service: KnowledgeBaseService,
  options: RuntimeDocsKnowledgeSeedOptions = {},
): void {
  for (const entry of RUNTIME_DOC_ENTRIES) {
    service.upsertEntry({
      entryId: entry.entryId,
      name: entry.name,
      kind: "web",
      uri: entry.uri,
      description: entry.description,
      tags: [...entry.tags],
      scopeType: "global",
    });
  }

  if (!options.repoRoot) {
    return;
  }

  for (const entry of listGeneratedSpacesDocsKnowledgeEntries(options.repoRoot)) {
    service.upsertEntry({
      entryId: entry.entryId,
      name: entry.name,
      kind: "file",
      uri: entry.uri,
      description: entry.description,
      tags: entry.tags,
      scopeType: "global",
    });
  }
}
