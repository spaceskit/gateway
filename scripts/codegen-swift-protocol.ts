#!/usr/bin/env bun
/**
 * codegen-swift-protocol.ts
 *
 * Reads `packages/server/src/protocol.ts` (the legacy WebSocket compatibility shim)
 * and generates:
 *   - ../client-swift/Sources/SpaceskitClient/GeneratedProtocol.swift
 *   - ../client-swift/Tests/SpaceskitClientTests/Fixtures/*.json
 *
 * Usage:
 *   bun run scripts/codegen-swift-protocol.ts
 *
 * The codegen is intentionally simple — it uses regex parsing rather than
 * the full TS compiler API so it stays zero-dep and fast. Protocol.ts is
 * a flat file of interfaces + one const object, so regex is sufficient.
 *
 * Canonical public contracts live in `../proto/`.
 */

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, "..");
const PROTOCOL_TS = resolve(ROOT, "packages/server/src/protocol.ts");
const SWIFT_OUT = resolve(ROOT, "../client-swift/Sources/SpaceskitClient/GeneratedProtocol.swift");
const FIXTURE_DIR = resolve(ROOT, "../client-swift/Tests/SpaceskitClientTests/Fixtures");

// ---------------------------------------------------------------------------
// Parse the WebSocket compatibility shim
// ---------------------------------------------------------------------------

interface TSField {
  name: string;
  tsType: string;
  optional: boolean;
  doc?: string;
}

interface TSInterface {
  name: string;
  fields: TSField[];
  generic?: string;
  doc?: string;
}

interface TSConstEntry {
  key: string;
  value: string;
}

function workspaceFixture(root: string, spaceId = "space-1", spaceUid = "space-uid-1"): Record<string, unknown> {
  return {
    spaceId,
    spaceUid,
    mode: "folder_bound",
    explicitWorkspaceRoot: root,
    effectiveWorkspaceRoot: root,
    metaPath: `${root}/.space`,
    logsPath: `${root}/.space/logs`,
    workPath: `${root}/.space/work`,
    sharedContextPath: `${root}/.space/shared-context`,
    scratchpadsPath: `${root}/.space/scratchpads`,
    layoutVersion: 2,
    gitRepoDetected: true,
    metadataStatus: "ready",
    updatedAt: "2026-03-06T18:44:23.062Z",
  };
}

const FIXTURE_OVERRIDES: Record<string, Record<string, unknown>> = {
  SpaceWorkspacePayload: workspaceFixture("/tmp/spaces/space-1"),
  SpaceGetWorkspaceResponsePayload: {
    workspace: workspaceFixture("/tmp/spaces/sample-space"),
  },
  SpaceSetWorkspaceResponsePayload: {
    workspace: workspaceFixture("/tmp/spaces/sample-space"),
  },
};

function parseProtocol(source: string): {
  interfaces: TSInterface[];
  messageTypes: TSConstEntry[];
} {
  const interfaces: TSInterface[] = [];
  const messageTypes: TSConstEntry[] = [];

  // Parse interfaces
  const interfaceRegex = /(?:\/\*\*([^*]*(?:\*(?!\/)[^*]*)*)\*\/\s*)?export\s+interface\s+(\w+)(?:<([^>]+)>)?\s*\{([^}]*)\}/g;
  let match: RegExpExecArray | null;

  while ((match = interfaceRegex.exec(source)) !== null) {
    const doc = match[1]?.trim();
    const name = match[2];
    const generic = match[3];
    const body = match[4];
    const fields: TSField[] = [];

    // Parse fields
    const fieldRegex = /(?:\/\*\*\s*([^*]*(?:\*(?!\/)[^*]*)*)\s*\*\/\s*)?(\w+)(\?)?:\s*([^;]+);/g;
    let fieldMatch: RegExpExecArray | null;

    while ((fieldMatch = fieldRegex.exec(body)) !== null) {
      fields.push({
        name: fieldMatch[2],
        optional: fieldMatch[3] === "?",
        tsType: fieldMatch[4].trim(),
        doc: fieldMatch[1]?.trim(),
      });
    }

    interfaces.push({ name, fields, generic, doc });
  }

  // Parse MessageTypes const
  const constRegex = /export\s+const\s+MessageTypes\s*=\s*\{([^}]+)\}/s;
  const constMatch = constRegex.exec(source);
  if (constMatch) {
    const entryRegex = /(\w+):\s*"([^"]+)"/g;
    let entryMatch: RegExpExecArray | null;
    while ((entryMatch = entryRegex.exec(constMatch[1])) !== null) {
      messageTypes.push({ key: entryMatch[1], value: entryMatch[2] });
    }
  }

  return { interfaces, messageTypes };
}

// ---------------------------------------------------------------------------
// TS → Swift type mapping
// ---------------------------------------------------------------------------

function tsTypeToSwift(tsType: string, optional: boolean): string {
  let swiftType: string;

  // Handle union literal types like "approve" | "reject" | ...
  if (tsType.includes('"') && tsType.includes("|")) {
    swiftType = "String"; // Swift will validate via enum if needed
  } else {
    switch (tsType) {
      case "string":
        swiftType = "String";
        break;
      case "number":
        // Heuristic: if the field name suggests integer, use Int
        swiftType = "Double"; // Will be refined per-field below
        break;
      case "boolean":
        swiftType = "Bool";
        break;
      case "unknown":
        swiftType = "AnyCodable";
        return optional ? `${swiftType}?` : swiftType;
      case "Record<string, unknown>":
        swiftType = "[String: AnyCodable]";
        return optional ? `${swiftType}?` : swiftType;
      case "string[]":
        swiftType = "[String]";
        break;
      case "GatewayErrorCode":
      case "SpaceShareAccessMode":
        // String literal union aliases in protocol.ts
        swiftType = "String";
        break;
      default:
        if (tsType.startsWith("Record<string,")) {
          swiftType = "[String: AnyCodable]";
        } else {
          swiftType = "AnyCodable"; // fallback
        }
    }
  }

  return optional ? `${swiftType}?` : swiftType;
}

function refineNumberType(fieldName: string): string {
  // Fields that should be Int
  const intFields = new Set([
    "seq",
    "turnCount",
    "pendingFeedback",
  ]);

  return intFields.has(fieldName) ? "Int" : "Double";
}

function swiftTypeForField(field: TSField): string {
  if (field.tsType === "number") {
    const base = refineNumberType(field.name);
    return field.optional ? `${base}?` : base;
  }
  return tsTypeToSwift(field.tsType, field.optional);
}

// ---------------------------------------------------------------------------
// Generate Swift
// ---------------------------------------------------------------------------

function toCamelCase(name: string): string {
  // Already camelCase from TS
  return name;
}

function generateSwift(
  interfaces: TSInterface[],
  messageTypes: TSConstEntry[],
): string {
  const lines: string[] = [];

  lines.push("// GeneratedProtocol.swift");
  lines.push("// AUTO-GENERATED by scripts/codegen-swift-protocol.ts");
  lines.push("// DO NOT EDIT MANUALLY — re-run: bun run codegen:swift");
  lines.push("//");
  lines.push(`// Source: packages/server/src/protocol.ts (legacy WebSocket compatibility shim)`);
  lines.push(`// Generated: ${new Date().toISOString()}`);
  lines.push("");
  lines.push("import Foundation");
  lines.push("");

  // --- Interfaces (skip GatewayMessage — it's generic and hand-written) ---
  for (const iface of interfaces) {
    if (iface.generic) continue; // Skip generic GatewayMessage

    lines.push(`// MARK: - ${iface.name}`);
    lines.push("");
    if (iface.doc) {
      lines.push(`/// ${iface.doc.replace(/\n/g, "\n/// ")}`);
    }
    lines.push(`public struct Generated${iface.name}: Codable, Sendable, Equatable {`);

    for (const field of iface.fields) {
      const swiftType = swiftTypeForField(field);
      if (field.doc) {
        lines.push(`    /// ${field.doc.replace(/\n/g, "\n    /// ")}`);
      }
      lines.push(`    public let ${toCamelCase(field.name)}: ${swiftType}`);
    }

    lines.push("}");
    lines.push("");
  }

  // --- MessageTypes enum ---
  lines.push("// MARK: - Generated Message Types");
  lines.push("");
  lines.push("/// All known message type strings from the legacy WebSocket compatibility shim.");
  lines.push("public enum GeneratedMessageType {");
  for (const entry of messageTypes) {
    // Convert SCREAMING_SNAKE to camelCase
    const camel = entry.key
      .toLowerCase()
      .replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    lines.push(`    public static let ${camel} = "${entry.value}"`);
  }
  lines.push("}");
  lines.push("");

  // --- Field manifest for conformance tests ---
  lines.push("// MARK: - Field Manifest (for conformance tests)");
  lines.push("");
  lines.push("/// Maps each interface name to its expected field names and optionality.");
  lines.push("/// Used by conformance tests to verify Swift types match TS types.");
  lines.push("public let protocolFieldManifest: [String: [(name: String, optional: Bool)]] = [");
  for (const iface of interfaces) {
    if (iface.generic) continue;
    const fields = iface.fields
      .map((f) => `        (name: "${f.name}", optional: ${f.optional})`)
      .join(",\n");
    lines.push(`    "${iface.name}": [`);
    lines.push(fields);
    lines.push("    ],");
  }
  lines.push("]");
  lines.push("");

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Generate JSON Fixtures
// ---------------------------------------------------------------------------

function normalizedUnionMembers(tsType: string): string[] {
  return tsType
    .split("|")
    .map((part) => part.trim())
    .filter((part) => part !== "null" && part !== "undefined");
}

function sampleValue(
  tsType: string,
  fieldName: string,
  optional: boolean,
  interfacesByName: Map<string, TSInterface>,
  seenInterfaces: Set<string>,
): unknown {
  if (tsType.includes('"') && tsType.includes("|")) {
    // Pick the first literal from the union — ensures fixtures contain valid enum values
    const firstLiteral = tsType.match(/"([^"]+)"/);
    return firstLiteral ? firstLiteral[1] : "unknown";
  }

  if (tsType.includes("|")) {
    const [primary] = normalizedUnionMembers(tsType);
    if (primary) {
      return sampleValue(primary, fieldName, optional, interfacesByName, seenInterfaces);
    }
  }

  if (tsType.endsWith("[]")) {
    const itemType = tsType.slice(0, -2).trim();
    return [sampleValue(itemType, fieldName, false, interfacesByName, seenInterfaces)];
  }

  switch (tsType) {
    case "string":
      return `sample-${fieldName}`;
    case "number":
      return fieldName === "seq" || fieldName === "turnCount" || fieldName === "pendingFeedback"
        ? 42
        : 3.14;
    case "boolean":
      return true;
    case "unknown":
      return { example: true };
    case "string[]":
      return [`${fieldName}-1`, `${fieldName}-2`];
    case "GatewayErrorCode":
      return "INVALID_ARGUMENT";
    case "SpaceShareAccessMode":
      return "collaborator";
    default:
      if (interfacesByName.has(tsType)) {
        const nested = generateFixture(interfacesByName.get(tsType)!, interfacesByName, seenInterfaces);
        return Object.keys(nested).length > 0 ? nested : null;
      }
      if (tsType.startsWith("Record<string,")) {
        return { key1: "value1" };
      }
      return null;
  }
}

function generateFixture(
  iface: TSInterface,
  interfacesByName: Map<string, TSInterface>,
  seenInterfaces = new Set<string>(),
): Record<string, unknown> {
  const override = FIXTURE_OVERRIDES[iface.name];
  if (override) {
    return structuredClone(override);
  }

  if (seenInterfaces.has(iface.name)) {
    return {};
  }

  const nextSeen = new Set(seenInterfaces);
  nextSeen.add(iface.name);
  const fixture: Record<string, unknown> = {};
  for (const field of iface.fields) {
    // Include optional fields too, so conformance tests can check they decode
    fixture[field.name] = sampleValue(field.tsType, field.name, field.optional, interfacesByName, nextSeen);
  }
  return fixture;
}

function generateFixtures(interfaces: TSInterface[]): Map<string, string> {
  const fixtures = new Map<string, string>();
  const interfacesByName = new Map(interfaces.map((iface) => [iface.name, iface]));

  for (const iface of interfaces) {
    if (iface.generic) continue;
    const fixture = generateFixture(iface, interfacesByName);
    fixtures.set(iface.name, JSON.stringify(fixture, null, 2));
  }

  // Also generate a full wrapped message fixture for each
  for (const iface of interfaces) {
    if (iface.generic) continue;
    const fixture = generateFixture(iface, interfacesByName);
    const wrapped = {
      type: `test_${iface.name.toLowerCase()}`,
      id: `msg-${iface.name.toLowerCase()}-001`,
      ts: new Date().toISOString(),
      payload: fixture,
    };
    fixtures.set(`Message_${iface.name}`, JSON.stringify(wrapped, null, 2));
  }

  return fixtures;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  console.log("Reading protocol.ts compatibility shim...");
  const source = readFileSync(PROTOCOL_TS, "utf-8");

  console.log("Parsing interfaces and message types...");
  const { interfaces, messageTypes } = parseProtocol(source);

  console.log(`  Found ${interfaces.length} interfaces`);
  console.log(`  Found ${messageTypes.length} message types`);

  // Generate Swift
  console.log("Generating Swift...");
  const swift = generateSwift(interfaces, messageTypes);
  mkdirSync(dirname(SWIFT_OUT), { recursive: true });
  writeFileSync(SWIFT_OUT, swift);
  console.log(`  → ${SWIFT_OUT}`);

  // Generate fixtures
  console.log("Generating JSON fixtures...");
  const fixtures = generateFixtures(interfaces);
  mkdirSync(FIXTURE_DIR, { recursive: true });
  for (const [name, json] of fixtures) {
    const path = resolve(FIXTURE_DIR, `${name}.json`);
    writeFileSync(path, json);
  }
  console.log(`  → ${fixtures.size} fixtures in ${FIXTURE_DIR}`);

  // Summary
  console.log("");
  console.log("Codegen complete! Swift types:");
  for (const iface of interfaces) {
    if (iface.generic) continue;
    console.log(`  Generated${iface.name} (${iface.fields.length} fields)`);
  }
  console.log("");
  console.log("Message types:");
  for (const entry of messageTypes) {
    console.log(`  ${entry.key} → "${entry.value}"`);
  }
}

main();
