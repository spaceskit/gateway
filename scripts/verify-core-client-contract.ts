#!/usr/bin/env bun
/**
 * verify-core-client-contract.ts
 *
 * Verifies high-risk shared WebSocket contract interfaces remain aligned between:
 * - server WebSocket compatibility shim: packages/server/src/protocol.ts
 * - core client source: packages/core/src/client/gateway-client.ts
 *
 * Canonical public contracts live in `../proto/`; this script only protects
 * the legacy sync/speech compatibility surface that still rides over the
 * WebSocket shim.
 *
 * Usage:
 *   bun run scripts/verify-core-client-contract.ts
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const SERVER_PROTOCOL = resolve(ROOT, "packages/server/src/protocol.ts");
const CORE_CLIENT = resolve(ROOT, "packages/core/src/client/gateway-client.ts");

const CONTRACT_MAP: Array<{ server: string; core: string }> = [
  { server: "SubscribePayload", core: "SubscribePayload" },
  { server: "SubscribeDeniedSpace", core: "SubscribeDeniedSpace" },
  { server: "SubscribeResponsePayload", core: "SubscribeResponsePayload" },
  { server: "AuthResultPayload", core: "AuthResultPayload" },
  { server: "NotificationPayload", core: "NotificationPayload" },
  { server: "ErrorPayload", core: "ErrorPayload" },
  { server: "SyncResourceRefPayload", core: "SyncResourceRef" },
  { server: "SyncResourcePayload", core: "SyncResource" },
  { server: "SyncResourceDeniedPayload", core: "SyncResourceDenied" },
  { server: "SyncProvenancePayload", core: "SyncProvenance" },
  { server: "SyncAnnouncePayload", core: "SyncAnnouncePayload" },
  { server: "SyncAnnounceResponsePayload", core: "SyncAnnounceResult" },
  { server: "SyncQueryResourcesPayload", core: "SyncQueryResourcesPayload" },
  { server: "SyncQueryResourcesResponsePayload", core: "SyncQueryResourcesResult" },
  { server: "SyncPullResourcesPayload", core: "SyncPullResourcesPayload" },
  { server: "SyncPullResourcesResponsePayload", core: "SyncPullResourcesResult" },
  { server: "SpeechStartPayload", core: "SpeechStartPayload" },
  { server: "SpeechAudioChunkPayload", core: "SpeechAudioChunkPayload" },
  { server: "SpeechControlPayload", core: "SpeechControlPayload" },
  { server: "SpeechEventPayload", core: "SpeechEventPayload" },
];

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

function diffFields(
  expected: Set<string>,
  actual: Set<string>,
): { missing: string[]; extra: string[] } {
  const missing: string[] = [];
  for (const field of expected) {
    if (!actual.has(field)) {
      missing.push(field);
    }
  }

  const extra: string[] = [];
  for (const field of actual) {
    if (!expected.has(field)) {
      extra.push(field);
    }
  }

  return { missing, extra };
}

function main() {
  const serverSource = readFileSync(SERVER_PROTOCOL, "utf-8");
  const coreSource = readFileSync(CORE_CLIENT, "utf-8");

  const serverInterfaces = parseInterfaces(serverSource);
  const coreInterfaces = parseInterfaces(coreSource);

  let passed = 0;
  let failed = 0;

  for (const pair of CONTRACT_MAP) {
    const serverFields = serverInterfaces.get(pair.server);
    const coreFields = coreInterfaces.get(pair.core);

    if (!serverFields) {
      console.error(`❌ Missing server interface: ${pair.server}`);
      failed += 1;
      continue;
    }
    if (!coreFields) {
      console.error(`❌ Missing core interface: ${pair.core}`);
      failed += 1;
      continue;
    }

    const { missing, extra } = diffFields(serverFields, coreFields);
    if (missing.length > 0 || extra.length > 0) {
      const details = [
        missing.length > 0 ? `missing in core: [${missing.join(", ")}]` : "",
        extra.length > 0 ? `extra in core: [${extra.join(", ")}]` : "",
      ]
        .filter(Boolean)
        .join("; ");
      console.error(`❌ ${pair.server} ↔ ${pair.core}: ${details}`);
      failed += 1;
      continue;
    }

    console.log(`✅ ${pair.server} ↔ ${pair.core} (${serverFields.size} fields)`);
    passed += 1;
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
}

main();
