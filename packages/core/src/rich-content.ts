import { z } from "zod";

const MAX_PREVIEW_CHARACTERS = 4_000;

const markdownExtensions = new Set(["md", "markdown", "mdown"]);
const codeMimeByExtension: Record<string, string> = {
  c: "text/x-c",
  cc: "text/x-c++",
  cpp: "text/x-c++",
  cs: "text/x-csharp",
  css: "text/css",
  go: "text/x-go",
  h: "text/x-c",
  htm: "text/html",
  html: "text/html",
  java: "text/x-java-source",
  js: "text/javascript",
  json: "application/json",
  jsx: "text/jsx",
  kt: "text/x-kotlin",
  log: "text/plain",
  py: "text/x-python",
  rb: "text/x-ruby",
  rs: "text/x-rust",
  sh: "application/x-sh",
  sql: "application/sql",
  swift: "text/x-swift",
  toml: "application/toml",
  ts: "text/typescript",
  tsx: "text/tsx",
  txt: "text/plain",
  xml: "application/xml",
  yaml: "application/yaml",
  yml: "application/yaml",
};

const explicitlySafeMimeTypes = new Set([
  "application/json",
  "application/sql",
  "application/toml",
  "application/xml",
  "application/x-sh",
  "application/x-yaml",
  "application/yaml",
  "text/css",
  "text/javascript",
  "text/jsx",
  "text/markdown",
  "text/plain",
  "text/tsx",
  "text/typescript",
  "text/x-c",
  "text/x-c++",
  "text/x-csharp",
  "text/x-go",
  "text/x-java-source",
  "text/x-kotlin",
  "text/x-python",
  "text/x-ruby",
  "text/x-rust",
  "text/x-swift",
]);

export const ContentPartTypeSchema = z.enum(["text", "data", "file"]);
export type ContentPartType = z.infer<typeof ContentPartTypeSchema>;

export const ContentPartSchema = z.object({
  type: ContentPartTypeSchema,
  mimeType: z.string().optional(),
  text: z.string().optional(),
  data: z.string().optional(),
  uri: z.string().optional(),
  title: z.string().optional(),
  previewText: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
}).superRefine((value, ctx) => {
  if (value.type === "text" && typeof value.text !== "string") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "text parts require text",
    });
  }
  if (value.type === "data" && typeof value.data !== "string") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "data parts require data",
    });
  }
  if (value.type === "file" && typeof value.uri !== "string") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "file parts require uri",
    });
  }
});
export type ContentPart = z.infer<typeof ContentPartSchema>;

export const ContentEnvelopeSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("rich_content"),
  primaryMimeType: z.string(),
  previewText: z.string().optional(),
  supportsInline: z.boolean(),
  parts: z.array(ContentPartSchema).min(1),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type ContentEnvelope = z.infer<typeof ContentEnvelopeSchema>;

export interface NormalizeRichContentInput {
  content: unknown;
  mimeType?: string;
  title?: string;
  artifactType?: string;
  allowMarkdownInference?: boolean;
  metadata?: Record<string, unknown>;
}

export function isContentEnvelope(value: unknown): value is ContentEnvelope {
  return ContentEnvelopeSchema.safeParse(value).success;
}

export function normalizeRichContent(input: NormalizeRichContentInput): ContentEnvelope {
  if (isContentEnvelope(input.content)) {
    return input.content;
  }

  const resolvedMimeType = resolveMimeType(input);
  if (typeof input.content === "string") {
    return envelopeFromString(input.content, resolvedMimeType, input.metadata);
  }

  if (isRecord(input.content)) {
    if (typeof input.content.contentEnvelope === "object" && isContentEnvelope(input.content.contentEnvelope)) {
      return input.content.contentEnvelope;
    }

    if (
      input.content.kind === "space.basic_md"
      && typeof input.content.markdown === "string"
    ) {
      return envelopeFromString(
        input.content.markdown,
        "text/markdown",
        mergeMetadata(input.metadata, {
          artifactType: input.artifactType,
          title: input.title,
          sourceKind: "space.basic_md",
        }),
      );
    }

    return envelopeFromJson(input.content, resolvedMimeType, input.metadata);
  }

  if (Array.isArray(input.content)) {
    return envelopeFromJson(input.content, resolvedMimeType, input.metadata);
  }

  return envelopeFromString(String(input.content ?? ""), resolvedMimeType, input.metadata);
}

export function buildRichContentRecordFromText(
  text: string,
  options: Omit<NormalizeRichContentInput, "content"> = {},
): Record<string, unknown> {
  const envelope = normalizeRichContent({
    content: text,
    allowMarkdownInference: true,
    ...options,
  });
  return {
    text,
    mimeType: envelope.primaryMimeType,
    contentEnvelope: envelope,
  };
}

export function deriveEnvelopeText(envelope: ContentEnvelope): string | undefined {
  const parts: string[] = [];
  for (const part of envelope.parts) {
    if (part.type === "text" && typeof part.text === "string") {
      parts.push(part.text);
      continue;
    }
    if (part.type === "data" && typeof part.data === "string") {
      parts.push(part.data);
    }
  }
  const combined = parts.join("\n").trim();
  if (combined.length > 0) return combined;
  const preview = envelope.previewText?.trim();
  return preview && preview.length > 0 ? preview : undefined;
}

function envelopeFromString(
  rawText: string,
  mimeType: string,
  metadata?: Record<string, unknown>,
): ContentEnvelope {
  const normalizedMimeType = mimeType === "text/html" ? "text/plain" : mimeType;
  const displayText = mimeType === "text/html" ? escapeHtml(rawText) : rawText;
  const supportsInline = isInlineSafeMimeType(normalizedMimeType);
  return {
    schemaVersion: 1,
    kind: "rich_content",
    primaryMimeType: normalizedMimeType,
    previewText: truncatePreview(displayText),
    supportsInline,
    parts: [{
      type: "text",
      mimeType: normalizedMimeType,
      text: displayText,
      previewText: truncatePreview(displayText),
    }],
    metadata: mergeMetadata(metadata, mimeType === "text/html"
      ? { originalMimeType: "text/html", htmlEscaped: true }
      : undefined),
  };
}

function envelopeFromJson(
  rawValue: Record<string, unknown> | unknown[],
  requestedMimeType: string,
  metadata?: Record<string, unknown>,
): ContentEnvelope {
  const json = prettyPrintJson(rawValue);
  const primaryMimeType = requestedMimeType === "text/html"
    ? "application/json"
    : requestedMimeType;
  const safeMimeType = isInlineSafeMimeType(primaryMimeType)
    ? primaryMimeType
    : "application/json";
  return {
    schemaVersion: 1,
    kind: "rich_content",
    primaryMimeType: safeMimeType,
    previewText: truncatePreview(json),
    supportsInline: isInlineSafeMimeType(safeMimeType),
    parts: [{
      type: "data",
      mimeType: safeMimeType,
      data: json,
      previewText: truncatePreview(json),
    }],
    metadata,
  };
}

function resolveMimeType(input: NormalizeRichContentInput): string {
  const explicit = normalizeMimeType(input.mimeType);
  if (explicit) {
    return explicit;
  }

  if (input.artifactType === "space.basic_md") {
    return "text/markdown";
  }

  if (isRecord(input.content)) {
    const nestedMime = normalizeMimeType(readString(input.content.mimeType) ?? readString(input.content.contentType));
    if (nestedMime) {
      return nestedMime;
    }
    if (
      input.content.kind === "space.basic_md"
      && typeof input.content.markdown === "string"
    ) {
      return "text/markdown";
    }
    return "application/json";
  }

  if (Array.isArray(input.content)) {
    return "application/json";
  }

  const extensionMime = inferMimeTypeFromTitle(input.title);
  if (extensionMime) {
    return extensionMime;
  }

  if (
    typeof input.content === "string"
    && input.allowMarkdownInference
    && looksLikeMarkdown(input.content)
  ) {
    return "text/markdown";
  }

  return "text/plain";
}

function inferMimeTypeFromTitle(title: string | undefined): string | undefined {
  const trimmed = title?.trim().toLowerCase();
  if (!trimmed) return undefined;
  const extension = trimmed.split(".").pop();
  if (!extension || extension === trimmed) return undefined;
  if (markdownExtensions.has(extension)) {
    return "text/markdown";
  }
  return codeMimeByExtension[extension];
}

function normalizeMimeType(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return undefined;
  return normalized.split(";")[0]?.trim() || undefined;
}

function looksLikeMarkdown(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  return /^#{1,6}\s/m.test(trimmed)
    || /```[\s\S]*```/.test(trimmed)
    || /^\s*[-*+]\s/m.test(trimmed)
    || /^\s*\d+\.\s/m.test(trimmed)
    || /\[[^\]]+\]\([^)]+\)/.test(trimmed)
    || /(^|\s)(\*\*|__)[^\n]+(\*\*|__)(\s|$)/.test(trimmed)
    || /(^|\s)(\*|_)[^\n]+(\*|_)(\s|$)/.test(trimmed);
}

function isInlineSafeMimeType(mimeType: string): boolean {
  return mimeType.startsWith("text/") || explicitlySafeMimeTypes.has(mimeType);
}

function prettyPrintJson(value: Record<string, unknown> | unknown[]): string {
  return JSON.stringify(value, null, 2);
}

function truncatePreview(value: string): string {
  if (value.length <= MAX_PREVIEW_CHARACTERS) {
    return value;
  }
  return `${value.slice(0, MAX_PREVIEW_CHARACTERS).trimEnd()}\n\n… [truncated — ${value.length} chars total]`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function mergeMetadata(
  lhs: Record<string, unknown> | undefined,
  rhs: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!lhs && !rhs) return undefined;
  return {
    ...(lhs ?? {}),
    ...(rhs ?? {}),
  };
}
