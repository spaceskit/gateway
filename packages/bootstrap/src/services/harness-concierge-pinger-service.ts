import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import {
  isVoiceDeliverable,
  mapHarnessUrgency,
  parseHarnessPingsFile,
  type HarnessConciergePing,
  type SpacesEscalationUrgency,
} from "./harness-concierge-ping-contract.js";

/**
 * HarnessConciergePingerService — the proactive voice "pinger".
 *
 * The harness concierge *watchdog* (`bin/concierge`, the triage producer) decides
 * which tasks need the user's attention and writes them to
 * `~/Documents/work/harness/state/concierge-pings.json`. This service is the
 * *consumer*: on an interval it reads that file, keeps the voice-deliverable
 * pings, maps their urgency onto the spaces escalation vocabulary, and raises an
 * escalation request. The existing `ConciergeEscalationService.runMaintenance()`
 * timeout path then escalates an unanswered urgent request to a real call.
 *
 * This is the missing connector between PREPARATION (harness) and the proactive
 * NOTIFY/voice channel (spaces). It deliberately mirrors
 * `ConciergeWorkbenchMonitorService`: same escalation shape, same cooldown +
 * persisted-prompt dedup. It contains NO voice code of its own — it only decides
 * *which* harness pings to speak. See SYSTEM-MAP.md.
 */

export interface HarnessConciergePingerEscalationService {
  requestUserInput(input: Record<string, unknown>): Promise<unknown>;
  findRecentRequestByContext?(input: {
    spaceId: string;
    context: Record<string, unknown>;
    now?: Date;
    cooldownMs?: number;
  }): Promise<{ requestId: string; status: string } | undefined>;
}

export interface HarnessConciergePingerRunInput {
  spaceId: string;
  requestingAgentId: string;
  requestingTurnId?: string;
  principalId?: string;
  deviceId?: string;
}

export interface HarnessConciergePingerResolvedRequest {
  requestId: string;
  status: string;
  response?: Record<string, unknown>;
  context?: Record<string, unknown>;
}

export interface HarnessConciergePingerServiceOptions {
  escalationService: HarnessConciergePingerEscalationService;
  /** Absolute path to concierge-pings.json. */
  pingsPath?: string;
  /** Absolute path to the harness `concierge` CLI, for the ack/snooze/resolve round-trip. */
  conciergeBinPath?: string;
  /** Absolute path to the harness `task` CLI, for the question answer-back (`task answer --source spaces`). */
  taskBinPath?: string;
  /** Inject for tests: read the raw pings file. Defaults to reading `pingsPath`. */
  readPings?: () => Promise<HarnessConciergePing[]>;
  /** Inject for tests: clear a ping in the harness. Defaults to spawning the concierge CLI. */
  resolvePing?: (input: { pingId: string; action: "ack" | "resolve"; note?: string }) => Promise<void>;
  /** Inject for tests: answer a parked task question. Defaults to spawning the task CLI. */
  answerTask?: (input: { taskId: string; text: string }) => Promise<void>;
  now?: () => Date;
  cooldownMs?: number;
  /**
   * Answer window for urgent prompts before the call fallback fires
   * (urgent_call_after_timeout). Deliberately NOT cooldown-derived — inheriting
   * the 6h cooldown would delay the call fallback by 6 hours.
   */
  urgentTimeoutSeconds?: number;
  /** Cap on new escalations per pass, so a large ping backlog drains gradually. */
  maxEscalationsPerRun?: number;
  logger?: {
    warn(message: string, details?: Record<string, unknown>): void;
    info?(message: string, details?: Record<string, unknown>): void;
  } | null;
}

const DEFAULT_PINGS_PATH = "/Users/caruso/Documents/work/harness/state/concierge-pings.json";
const DEFAULT_CONCIERGE_BIN = "/Users/caruso/Documents/work/harness/bin/concierge";
const DEFAULT_TASK_BIN = "/Users/caruso/Documents/work/harness/bin/task";
const DEFAULT_COOLDOWN_MS = 6 * 60 * 60 * 1000;
const DEFAULT_URGENT_TIMEOUT_SECONDS = 120;
const DEFAULT_MAX_ESCALATIONS_PER_RUN = 5;
/**
 * Only urgent pings may ring: ConciergeEscalationService rejects
 * urgent_call_after_timeout for any other urgency (it throws
 * "fallbackPolicy urgent_call_after_timeout requires urgency=urgent").
 * Lower urgencies notify once and expire harmlessly.
 */
const POLICY_BY_URGENCY: Record<SpacesEscalationUrgency, string> = {
  urgent: "urgent_call_after_timeout",
  important: "none",
  passive: "none",
};
const PING_SOURCE = "harness-concierge";

export class HarnessConciergePingerService {
  private readonly now: () => Date;
  private readonly cooldownMs: number;
  private readonly urgentTimeoutSeconds: number;
  private readonly maxEscalationsPerRun: number;
  private readonly promptedAtByKey = new Map<string, number>();
  private readonly resolvedRequestIds = new Set<string>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly options: HarnessConciergePingerServiceOptions) {
    this.now = options.now ?? (() => new Date());
    this.cooldownMs = options.cooldownMs ?? DEFAULT_COOLDOWN_MS;
    this.urgentTimeoutSeconds = options.urgentTimeoutSeconds ?? DEFAULT_URGENT_TIMEOUT_SECONDS;
    this.maxEscalationsPerRun = options.maxEscalationsPerRun ?? DEFAULT_MAX_ESCALATIONS_PER_RUN;
  }

  start(input: HarnessConciergePingerRunInput, intervalMs: number): ReturnType<typeof setInterval> {
    this.stop();
    this.timer = setInterval(() => {
      void this.runOnce(input).catch((error) => {
        this.options.logger?.warn("Harness concierge pinger failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }, Math.max(10_000, intervalMs));
    return this.timer;
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  /** Read the pings file, escalate every fresh voice-deliverable ping. Returns the pings escalated this pass. */
  async runOnce(input: HarnessConciergePingerRunInput): Promise<HarnessConciergePing[]> {
    const pings = await this.loadPings();
    const escalated: HarnessConciergePing[] = [];
    for (const ping of pings) {
      if (escalated.length >= this.maxEscalationsPerRun) break;
      if (!isVoiceDeliverable(ping)) continue;
      const key = `harness_ping:${ping.id}`;
      if (this.isCoolingDown(key)) continue;
      // Isolate each ping: one rejected escalation must not abort the pass and
      // starve every ping behind it. The failed ping records no promptedAt, so
      // it is retried next pass.
      try {
        const context = this.buildContext(ping);
        if (await this.hasRecentPersistedPrompt(input.spaceId, context)) {
          this.promptedAtByKey.set(key, this.now().getTime());
          continue;
        }
        const urgency = mapHarnessUrgency(ping.urgency);
        await this.options.escalationService.requestUserInput({
          spaceId: input.spaceId,
          requestingAgentId: input.requestingAgentId,
          requestingTurnId: input.requestingTurnId ?? "harness-concierge-pinger",
          principalId: input.principalId,
          deviceId: input.deviceId,
          question: ping.message,
          reason: ping.reason ?? "harness-concierge",
          urgency,
          // Question pings additionally allow a free-text `revise` reply, which
          // handleResolvedRequest routes to `task answer --source spaces`.
          allowedResponses: ping.question
            ? ["approve", "open_app", "defer", "revise"]
            : ["approve", "open_app", "defer"],
          context,
          fallbackPolicy: POLICY_BY_URGENCY[urgency],
          timeoutSeconds: urgency === "urgent" ? this.urgentTimeoutSeconds : this.promptTimeoutSeconds(),
        });
        this.promptedAtByKey.set(key, this.now().getTime());
        escalated.push(ping);
      } catch (error) {
        this.options.logger?.warn("Harness concierge ping escalation failed", {
          pingId: ping.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return escalated;
  }

  /**
   * When the user answers a harness-ping escalation, clear the underlying ping
   * in the harness so it stops re-firing. `actioned`/approve → resolve;
   * `defer` → ack (acknowledged, no further nudging this cycle);
   * `revise` with text on a question ping → `task answer --source spaces`
   * (returns the parked task to the pool, matching the Telegram reply lane),
   * then resolve the ping.
   */
  async handleResolvedRequest(input: HarnessConciergePingerResolvedRequest): Promise<boolean> {
    if (this.resolvedRequestIds.has(input.requestId)) return false;
    const context = isRecord(input.context) ? input.context : {};
    if (context.source !== PING_SOURCE) return false;
    const pingId = optionalString(context.pingId);
    if (!pingId) return false;

    const action = optionalString(input.response?.action);
    let mutate: "ack" | "resolve" | null = null;
    let answer: { taskId: string; text: string } | null = null;
    if (input.status === "actioned" && (action === "approve" || action === "open_app")) {
      mutate = "resolve";
    } else if (input.status === "actioned" && action === "revise") {
      // Free-text reply to a question ping = the answer to the parked task.
      const taskId = optionalString(context.taskId);
      const text = optionalString(input.response?.message);
      const isQuestionPing = optionalString(context.question) !== undefined;
      if (!taskId || !text || !isQuestionPing) return false;
      answer = { taskId, text };
      mutate = "resolve";
    } else if (action === "defer" || input.status === "expired") {
      mutate = "ack";
    }
    if (!mutate) return false;

    this.resolvedRequestIds.add(input.requestId);
    try {
      if (answer) await this.answerTask(answer);
      await this.resolvePing({ pingId, action: mutate, note: `concierge call (${input.requestId})` });
      return true;
    } catch (error) {
      this.resolvedRequestIds.delete(input.requestId);
      this.options.logger?.warn("Harness concierge ping round-trip failed", {
        requestId: input.requestId,
        pingId,
        action: mutate,
        answered: !!answer,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  private buildContext(ping: HarnessConciergePing): Record<string, unknown> {
    return {
      source: PING_SOURCE,
      pingId: ping.id,
      taskId: ping.target,
      reason: ping.reason ?? "harness-concierge",
      action: "open_task",
      ...(ping.title ? { title: ping.title } : {}),
      ...(ping.targetPath ? { targetPath: ping.targetPath } : {}),
      ...(ping.question ? { question: ping.question } : {}),
    };
  }

  private async loadPings(): Promise<HarnessConciergePing[]> {
    if (this.options.readPings) return this.options.readPings();
    const path = this.options.pingsPath ?? DEFAULT_PINGS_PATH;
    const payload = JSON.parse(await readFile(path, "utf8")) as unknown;
    return parseHarnessPingsFile(payload);
  }

  private async resolvePing(input: { pingId: string; action: "ack" | "resolve"; note?: string }): Promise<void> {
    if (this.options.resolvePing) return this.options.resolvePing(input);
    const bin = this.options.conciergeBinPath ?? DEFAULT_CONCIERGE_BIN;
    const args = [input.action, input.pingId];
    if (input.note) args.push("--note", input.note);
    await runConcierge(bin, args);
  }

  private async answerTask(input: { taskId: string; text: string }): Promise<void> {
    if (this.options.answerTask) return this.options.answerTask(input);
    const bin = this.options.taskBinPath ?? DEFAULT_TASK_BIN;
    await runConcierge(bin, ["answer", input.taskId, input.text, "--source", "spaces"]);
  }

  private isCoolingDown(key: string): boolean {
    const promptedAt = this.promptedAtByKey.get(key);
    if (!promptedAt) return false;
    return this.now().getTime() - promptedAt < this.cooldownMs;
  }

  private async hasRecentPersistedPrompt(
    spaceId: string,
    context: Record<string, unknown>,
  ): Promise<boolean> {
    const existing = await this.options.escalationService.findRecentRequestByContext?.({
      spaceId,
      context,
      now: this.now(),
      cooldownMs: this.cooldownMs,
    });
    if (!existing) return false;
    if (existing.status === "expired" || existing.status === "cancelled") return false;
    return true;
  }

  private promptTimeoutSeconds(): number {
    return Math.max(1, Math.ceil(this.cooldownMs / 1000));
  }
}

function runConcierge(bin: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: "ignore" });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`concierge ${args[0]} exited with code ${code ?? "unknown"}`));
    });
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function optionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}
