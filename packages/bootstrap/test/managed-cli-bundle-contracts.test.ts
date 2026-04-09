import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  JIRA_TOOL_DEFINITIONS,
} from "../../../scripts/jira-cli-tools/catalog.mjs";
import {
  HRVST_TOOL_DEFINITIONS,
} from "../../../scripts/hrvst-cli-tools/catalog.mjs";
import {
  OP_TOOL_DEFINITIONS,
} from "../../../scripts/op-cli-tools/catalog.mjs";
import {
  FRUITMAIL_TOOL_DEFINITIONS,
} from "../../../scripts/fruitmail-cli-tools/catalog.mjs";

function listLikeToolIds() {
  return [
    ...JIRA_TOOL_DEFINITIONS.map((tool) => ({
      bundleId: tool.bundleId,
      toolId: tool.id,
      schema: tool.payloadSchema,
      instructions: tool.instructions,
      listLike: tool.id.endsWith(".list"),
    })),
    ...HRVST_TOOL_DEFINITIONS.map((tool) => ({
      bundleId: tool.bundleId,
      toolId: tool.id,
      schema: tool.payloadSchema,
      instructions: tool.instructions,
      listLike: tool.id.endsWith(".list"),
    })),
    ...OP_TOOL_DEFINITIONS.map((tool) => ({
      bundleId: tool.bundleId,
      toolId: tool.id,
      schema: tool.payloadSchema,
      instructions: tool.instructions,
      listLike: tool.id.endsWith(".list"),
    })),
    ...FRUITMAIL_TOOL_DEFINITIONS.map((tool) => ({
      bundleId: tool.bundleId,
      toolId: tool.id,
      schema: tool.inputSchema,
      instructions: tool.instructions,
      listLike: tool.id.endsWith(".recent") || tool.id.endsWith(".search") || tool.id.endsWith(".unread"),
    })),
  ].filter((tool) => tool.listLike);
}

function hasExplicitPassthroughWarning(tool: {
  schema?: { properties?: Record<string, { description?: string }> };
  instructions?: string;
}) {
  const flags = (tool.schema?.properties ?? {}).flags;
  const hasRawFlagWarning = typeof flags?.description === "string"
    && flags.description.includes("raw CLI flag keys");
  const hasDiscoveryWarning = typeof tool.instructions === "string"
    && tool.instructions.includes("not query-bounded");

  return hasRawFlagWarning || hasDiscoveryWarning;
}

function bundleClassification(bundleId: string): "typed and bounded" | "typed but leaky" | "raw passthrough" {
  const listTools = listLikeToolIds().filter((tool) => tool.bundleId === bundleId);
  const rawWarningCount = listTools.filter((tool) => hasExplicitPassthroughWarning(tool)).length;
  const boundedCount = listTools.filter((tool) => "limit" in (tool.schema?.properties ?? {})).length;

  if (rawWarningCount === listTools.length) {
    return "raw passthrough";
  }
  if (boundedCount === listTools.length) {
    return "typed and bounded";
  }
  return "typed but leaky";
}

describe("managed cli bundle contract audit", () => {
  test("classifies repo-shipped bundles by query contract shape", () => {
    expect(bundleClassification("jira-cli")).toBe("typed but leaky");
    expect(bundleClassification("fruitmail-cli")).toBe("typed and bounded");
    expect(bundleClassification("hrvst-cli")).toBe("raw passthrough");
    expect(bundleClassification("onepassword-cli")).toBe("raw passthrough");
  });

  test("ensures each repo-shipped list/search tool is either bounded or explicitly passthrough", () => {
    for (const tool of listLikeToolIds()) {
      const properties = tool.schema?.properties ?? {};
      const hasExplicitLimit = "limit" in properties;
      const hasPassthroughWarning = hasExplicitPassthroughWarning(tool);

      expect(
        hasExplicitLimit || hasPassthroughWarning,
        `${tool.toolId} should expose a typed limit or an explicit passthrough warning`,
      ).toBe(true);
    }
  });

  test("keeps checked-in Jira list docs and manifests free of inline ORDER BY JQL examples", () => {
    const readme = readFileSync(
      new URL("../../../cli-tools/jira.issue.list/README.md", import.meta.url),
      "utf8",
    );
    const manifest = readFileSync(
      new URL("../../../cli-tools/jira.issue.list/manifest.json", import.meta.url),
      "utf8",
    );

    expect(readme).not.toMatch(/"jql"\s*:\s*"[^"\n]*ORDER BY/i);
    expect(manifest).not.toMatch(/"jql"\s*:\s*"[^"\n]*ORDER BY/i);
    expect(readme).toContain("orderBy");
    expect(readme).toContain("reverse");
  });
});
