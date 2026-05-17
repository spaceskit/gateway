import type { CapabilityType } from "@spaceskit/core";
import type {
  SpaceConnectorPolicyEntry,
  SpaceConnectorPolicyEntryState,
  SpaceConnectorPolicySourceKind,
} from "./space-tool-policy-service.js";

const SOURCE_SELECTOR_PREFIXES: Record<SpaceConnectorPolicySourceKind, string> = {
  connector_family: "connector_family:",
  cli_bundle: "cli_bundle:",
  connector_instance: "connector_instance:",
};

export function matchesToolSet(set: Set<string>, operationId: string, capability: CapabilityType): boolean {
  if (set.has(operationId)) return true;
  if (set.has(capability)) return true;
  if (set.has(`${capability}.*`)) return true;
  return false;
}

export function parseToolList(raw: string | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
    }
  } catch {
    // Ignore parse failures.
  }
  return [];
}

export function parseToolListExcludingSourceSelectors(entries: Set<string>): string[] {
  return Array.from(entries).filter((entry) => parseSourceSelector(entry, "enabled") == null);
}

export function normalizeConnectorEntries(entries: SpaceConnectorPolicyEntry[]): SpaceConnectorPolicyEntry[] {
  const output: SpaceConnectorPolicyEntry[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    if (!isSourceKind(entry?.sourceKind)) continue;
    const sourceId = normalizeOptional(entry?.sourceId);
    if (!sourceId) continue;
    const state = entry?.state === "disabled" ? "disabled" : "enabled";
    const key = `${entry.sourceKind}:${sourceId}:${state}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push({
      sourceKind: entry.sourceKind,
      sourceId,
      state,
    });
  }
  return output;
}

export function selectorFromEntry(entry: SpaceConnectorPolicyEntry): string {
  return `${SOURCE_SELECTOR_PREFIXES[entry.sourceKind]}${entry.sourceId}`;
}

export function parseSourceSelector(
  value: string,
  state: SpaceConnectorPolicyEntryState,
): SpaceConnectorPolicyEntry | undefined {
  const normalized = normalizeOptional(value);
  if (!normalized) return undefined;
  for (const [sourceKind, prefix] of Object.entries(SOURCE_SELECTOR_PREFIXES) as Array<[SpaceConnectorPolicySourceKind, string]>) {
    if (!normalized.startsWith(prefix)) continue;
    const sourceId = normalizeOptional(normalized.slice(prefix.length));
    if (!sourceId) return undefined;
    return {
      sourceKind,
      sourceId,
      state,
    };
  }
  return undefined;
}

export function isSourceKind(value: unknown): value is SpaceConnectorPolicySourceKind {
  return value === "connector_family"
    || value === "cli_bundle"
    || value === "connector_instance";
}

export function normalizeRequired(value: string | undefined, field: string): string {
  const normalized = normalizeOptional(value);
  if (!normalized) {
    throw new Error(`${field} is required`);
  }
  return normalized;
}

export function normalizeOptional(value: string | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}
