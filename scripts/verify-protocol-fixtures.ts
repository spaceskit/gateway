#!/usr/bin/env bun
/**
 * verify-protocol-fixtures.ts
 *
 * Reads the generated JSON fixtures and verifies that each fixture's
 * field names match the corresponding interface in the legacy WebSocket
 * compatibility shim (`protocol.ts`).
 *
 * This is the compatibility-shim conformance test. Run after codegen to
 * ensure the fixtures haven't drifted from that shim while `proto/`
 * remains the canonical public contract source.
 *
 * Usage:
 *   bun run scripts/verify-protocol-fixtures.ts
 */

import { readFileSync, readdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const PROTOCOL_TS = resolve(ROOT, "packages/server/src/protocol.ts");
const FIXTURE_DIR = resolve(ROOT, "../client-swift/Tests/SpaceskitClientTests/Fixtures");

// Parse interfaces from the compatibility shim (same regex approach as codegen)
function parseInterfaces(source: string): Map<string, Set<string>> {
  const interfaces = new Map<string, Set<string>>();
  const interfaceRegex = /export\s+interface\s+(\w+)(?:<[^>]+>)?\s*\{([^}]*)\}/g;
  let match: RegExpExecArray | null;

  while ((match = interfaceRegex.exec(source)) !== null) {
    const name = match[1];
    const body = match[2];
    const fields = new Set<string>();

    const fieldRegex = /(?:\/\*\*[^*]*(?:\*(?!\/)[^*]*)*\*\/\s*)?(\w+)\??:\s*[^;]+;/g;
    let fieldMatch: RegExpExecArray | null;
    while ((fieldMatch = fieldRegex.exec(body)) !== null) {
      fields.add(fieldMatch[1]);
    }

    interfaces.set(name, fields);
  }

  return interfaces;
}

function main() {
  const source = readFileSync(PROTOCOL_TS, "utf-8");
  const interfaces = parseInterfaces(source);

  const fixtureFiles = readdirSync(FIXTURE_DIR).filter(
    (f) => f.endsWith(".json") && !f.startsWith("Message_"),
  );

  let passed = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const file of fixtureFiles) {
    const name = file.replace(".json", "");
    const tsFields = interfaces.get(name);

    if (!tsFields) {
      errors.push(`⚠️  ${name}: no matching interface in protocol.ts compatibility shim (orphaned fixture?)`);
      failed++;
      continue;
    }

    const fixture = JSON.parse(readFileSync(resolve(FIXTURE_DIR, file), "utf-8"));
    const fixtureFields = new Set(Object.keys(fixture));

    // Check: every TS field should be in the fixture
    const missingInFixture: string[] = [];
    for (const field of tsFields) {
      if (!fixtureFields.has(field)) {
        missingInFixture.push(field);
      }
    }

    // Check: every fixture field should be in the TS interface
    const extraInFixture: string[] = [];
    for (const field of fixtureFields) {
      if (!tsFields.has(field)) {
        extraInFixture.push(field);
      }
    }

    if (missingInFixture.length > 0 || extraInFixture.length > 0) {
      let msg = `❌ ${name}:`;
      if (missingInFixture.length > 0) {
        msg += ` missing in fixture: [${missingInFixture.join(", ")}]`;
      }
      if (extraInFixture.length > 0) {
        msg += ` extra in fixture: [${extraInFixture.join(", ")}]`;
      }
      errors.push(msg);
      failed++;
    } else {
      console.log(`✅ ${name} — ${tsFields.size} fields match`);
      passed++;
    }
  }

  // Check for TS interfaces without fixtures
  for (const [name] of interfaces) {
    if (name === "GatewayMessage") continue; // Generic, skip
    if (!fixtureFiles.some((f) => f === `${name}.json`)) {
      errors.push(`⚠️  ${name}: interface exists in protocol.ts compatibility shim but no fixture generated`);
      failed++;
    }
  }

  console.log("");
  if (errors.length > 0) {
    console.log("Issues found:");
    for (const e of errors) {
      console.log(`  ${e}`);
    }
  }

  console.log(`\n${passed} passed, ${failed} issues`);

  if (failed > 0) {
    console.log("\nRe-run codegen to fix: bun run scripts/codegen-swift-protocol.ts");
    process.exit(1);
  }
}

main();
