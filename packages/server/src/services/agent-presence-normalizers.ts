import type {
  AgentPresenceRowPayload,
  AgentPresenceSnapshotPayload,
  AgentProviderPayload,
  AgentWaitOptionPayload,
  AgentWaitStatusPayload,
} from "../protocol/agent-presence.js";

/**
 * Pure mappers from infra-pulse's `/api/agent-presence` JSON onto the gateway's
 * JSON-transport `AgentPresenceRowPayload` shape.
 *
 * infra-pulse (a SEPARATE repo, reached over HTTP — never imported) serves the
 * detector's `SessionWaitState[]` with kebab-case status strings (`turn-end`,
 * `idle-dead`) and a fractional epoch-ms `at`. The gateway normalizes those onto
 * the proto-enum-suffix string unions (`turn_end`, `idle_dead`). Unknown
 * providers/statuses degrade to `"unspecified"` rather than throwing — a single
 * malformed row must not poison the whole snapshot.
 *
 * The infra-pulse side of this contract is defined in the (private)
 * `@agent-presence/contracts` package; this repo stays dependency-free and is
 * drift-checked instead via the committed fixtures under
 * test/fixtures/agent-presence/ (regenerate with that package's
 * `bun run gen-fixtures -- --out <dir>` when the contract changes).
 */

/** Raw `/api/agent-presence` response body (best-effort typed; validated defensively). */
export interface InfraPulseAgentPresenceResponse {
  generatedAt?: unknown;
  total?: unknown;
  agents?: unknown;
  error?: unknown;
}

const PROVIDER_BY_STRING: Record<string, AgentProviderPayload> = {
  claude: "claude",
  codex: "codex",
  opencode: "opencode",
};

// infra-pulse emits kebab-case (`turn-end`, `idle-dead`); accept snake_case too
// in case the producer ever normalizes them.
const WAIT_STATUS_BY_STRING: Record<string, AgentWaitStatusPayload> = {
  question: "question",
  plan: "plan",
  permission: "permission",
  "turn-end": "turn_end",
  turn_end: "turn_end",
  working: "working",
  "idle-dead": "idle_dead",
  idle_dead: "idle_dead",
};

/** Map a single raw detector row, or `null` when it is too malformed to keep. */
export function mapInfraPulseAgentRow(raw: unknown): AgentPresenceRowPayload | null {
  if (!isRecord(raw)) return null;
  const sessionId = optionalString(raw.sessionId) ?? "";
  const provider = mapProvider(optionalString(raw.provider));
  const key = optionalString(raw.key) ?? defaultKey(provider, sessionId);
  if (!key) return null;

  return {
    key,
    provider,
    sessionId,
    cwd: optionalString(raw.cwd) ?? "",
    status: mapWaitStatus(optionalString(raw.status)),
    summary: optionalString(raw.summary) ?? "",
    title: optionalString(raw.title),
    options: mapOptions(raw.options),
    hash: optionalString(raw.hash) ?? "",
    at: finiteNumber(raw.at),
    live: raw.live === true,
  };
}

/** Map the full `/api/agent-presence` body into the snapshot the gateway serves/broadcasts. */
export function mapInfraPulseSnapshot(
  body: InfraPulseAgentPresenceResponse,
): AgentPresenceSnapshotPayload {
  const rawAgents = Array.isArray(body.agents) ? body.agents : [];
  const agents: AgentPresenceRowPayload[] = [];
  for (const raw of rawAgents) {
    const row = mapInfraPulseAgentRow(raw);
    if (row) agents.push(row);
  }
  return { agents, generatedAt: parseGeneratedAt(body.generatedAt) };
}

function mapProvider(value: string | undefined): AgentProviderPayload {
  if (!value) return "unspecified";
  return PROVIDER_BY_STRING[value.trim().toLowerCase()] ?? "unspecified";
}

function mapWaitStatus(value: string | undefined): AgentWaitStatusPayload {
  if (!value) return "unspecified";
  return WAIT_STATUS_BY_STRING[value.trim().toLowerCase()] ?? "unspecified";
}

function mapOptions(value: unknown): AgentWaitOptionPayload[] {
  if (!Array.isArray(value)) return [];
  const options: AgentWaitOptionPayload[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const label = optionalString(entry.label);
    if (!label) continue;
    options.push({ label, description: optionalString(entry.description) ?? "" });
  }
  return options;
}

/**
 * infra-pulse emits `generatedAt` as an ISO string. Carry it as fractional
 * epoch-ms (matching the `double` contract field). A numeric value is accepted
 * as-is; anything unparseable falls back to "now".
 */
function parseGeneratedAt(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return Date.now();
}

function defaultKey(provider: AgentProviderPayload, sessionId: string): string {
  if (!sessionId) return "";
  const providerLabel = provider === "unspecified" ? "agent" : provider;
  return `${providerLabel}:${sessionId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function optionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function finiteNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
