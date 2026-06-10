/**
 * Typed contract for the harness concierge ping queue
 * (`~/Documents/work/harness/state/concierge-pings.json`).
 *
 * This is the formalization of a previously-implicit JSON contract. The harness
 * (`bin/concierge`, the triage *producer*) writes these pings; the spaces
 * concierge (the voice *consumer*) reads and delivers them. The file is the
 * single seam between PREPARATION (harness) and the proactive NOTIFY/voice
 * channel (spaces). See SYSTEM-MAP.md.
 *
 * Keep this in sync with the writer in
 * `/Users/caruso/Documents/work/harness/bin/concierge`.
 *
 * NOTE: this is an intentional self-contained MIRROR of the canonical types in
 * the private `@harness/contracts` package
 * (`/Users/caruso/code/harness-contracts/src/concierge-pings.ts`). spaces/gateway
 * is a PUBLIC submodule and must not depend on the private personal-ops package,
 * so the harness integration stays a runtime file/env data contract — not a code
 * dependency. If the ping schema changes, update both. See SYSTEM-MAP.md.
 */

/** Urgency vocabulary emitted by the harness (4-level historically, 3 in use). */
export type HarnessPingUrgency = "urgent" | "high" | "medium" | "low";

/** Delivery channel the harness recommends for a ping. */
export type HarnessPingDeliveryChannel = "voice" | "phone-ready" | "chat" | string;

/** Lifecycle status the harness tracks per ping. */
export type HarnessPingDeliveryStatus =
  | "active"
  | "waiting"
  | "snoozed"
  | "acknowledged"
  | "resolved"
  | string;

/** A single ping as written by the harness concierge watchdog. */
export interface HarnessConciergePing {
  /** Stable id, e.g. "concierge/N-task-quality-admin-T-0013". Used as the round-trip key. */
  id: string;
  /** The harness task this ping points back to, e.g. "admin/T-0013". */
  target: string;
  urgency: HarnessPingUrgency;
  /** Whether the harness considers this ping ready to be delivered. */
  deliver: boolean;
  deliveryChannel: HarnessPingDeliveryChannel;
  deliveryStatus?: HarnessPingDeliveryStatus;
  /** Human-facing one-liner — becomes the escalation question. */
  message: string;
  /** Why the ping exists (e.g. "task-quality", "stale-workflow", "needs-human-review"). */
  reason?: string;
  /** Suggested next action text. */
  action?: string;
  /** Short title for the source task. */
  title?: string;
  /** Open question text for awaiting-input pings — becomes the escalation question verbatim. */
  question?: string;
  detail?: string;
  source?: string;
  generatedAt?: string;
  escalationLevel?: number;
  targetPath?: string;
  project?: string;
  taskStatus?: string;
  taskPriority?: string;
  lastPingAt?: string;
  nextPingAt?: string;
  pingCount?: number;
}

/** Top-level shape of concierge-pings.json. */
export interface HarnessConciergePingsFile {
  pings: HarnessConciergePing[];
  activePings?: HarnessConciergePing[];
  counts?: Record<string, number>;
  generatedAt?: string;
  source?: string;
  /** Injected by the spaces /api/concierge-pings endpoint. */
  sourcePath?: string;
}

/** Urgency the spaces escalation/voice layer understands. */
export type SpacesEscalationUrgency = "passive" | "important" | "urgent";

/**
 * Map the harness's urgency onto the spaces escalation urgency.
 *
 * Contract (4 → 3):
 *   urgent        -> urgent
 *   high          -> important
 *   medium | low  -> passive
 */
export function mapHarnessUrgency(urgency: HarnessPingUrgency): SpacesEscalationUrgency {
  switch (urgency) {
    case "urgent":
      return "urgent";
    case "high":
      return "important";
    case "medium":
    case "low":
    default:
      return "passive";
  }
}

/** Delivery channels that should be delivered by voice/call. */
const VOICE_CHANNELS = new Set<HarnessPingDeliveryChannel>(["voice", "phone-ready"]);

/** Ping states in which the user has already responded — never re-deliver these. */
const SUPPRESSED_STATUSES = new Set<HarnessPingDeliveryStatus>([
  "snoozed",
  "acknowledged",
  "resolved",
]);

/**
 * Whether a ping should be delivered through the proactive voice channel.
 *
 * The harness only escalates `deliveryChannel` to voice/phone-ready after a ping
 * has nagged several times (escalationLevel ≥ 1) — so the *escalated channel is
 * itself the signal* that this needs a call. We therefore key off the channel,
 * not the transient `deliver` (due-this-instant) flag, which rarely coincides
 * with voice-tier in a single scan. We still skip pings the user has already
 * acted on (snoozed / acknowledged / resolved). Cooldown + persisted-prompt
 * dedup in the pinger service prevent repeat calls within a window.
 */
export function isVoiceDeliverable(ping: HarnessConciergePing): boolean {
  if (!VOICE_CHANNELS.has(ping.deliveryChannel)) return false;
  if (ping.deliveryStatus && SUPPRESSED_STATUSES.has(ping.deliveryStatus)) return false;
  return true;
}

/** Parse and lightly validate the pings file payload. */
export function parseHarnessPingsFile(payload: unknown): HarnessConciergePing[] {
  if (typeof payload !== "object" || payload === null) return [];
  const file = payload as Partial<HarnessConciergePingsFile>;
  const raw = Array.isArray(file.pings) ? file.pings : [];
  const pings: HarnessConciergePing[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const candidate = entry as Partial<HarnessConciergePing>;
    if (typeof candidate.id !== "string" || candidate.id.trim() === "") continue;
    if (typeof candidate.message !== "string") continue;
    pings.push({
      ...candidate,
      id: candidate.id,
      target: typeof candidate.target === "string" ? candidate.target : "",
      urgency: normalizeUrgency(candidate.urgency),
      deliver: candidate.deliver === true,
      deliveryChannel:
        typeof candidate.deliveryChannel === "string" ? candidate.deliveryChannel : "chat",
      message: candidate.message,
    });
  }
  return pings;
}

function normalizeUrgency(value: unknown): HarnessPingUrgency {
  if (value === "urgent" || value === "high" || value === "medium" || value === "low") {
    return value;
  }
  return "medium";
}
