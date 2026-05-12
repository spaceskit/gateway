import type {
  AgentRuntime,
  CliLaunchSnapshot,
  RuntimeFeedbackCheckpoint,
  TurnContext,
} from "../agents/agent-runtime.js";
import type {
  ModelMessage,
  ProviderSessionHandle,
} from "../agents/model-provider.js";
import type {
  SpaceAgentAssignment,
  SpaceConfig,
} from "./types.js";
import {
  normalizeOptionalString,
  normalizeProviderSessionHandle,
  sanitizeSessionTitle,
  truncateSessionTitle,
  type TurnExecutionIdentity,
} from "./space-manager-normalizers.js";

export interface AgentSessionRuntimeMetadata {
  displayTitle?: string;
  providerSessionHandle?: ProviderSessionHandle;
}

export interface SaveAgentSessionRuntimeMetadataInput {
  spaceId: string;
  agentId: string;
  displayTitle?: string;
  providerSessionHandle?: ProviderSessionHandle;
}

export interface ActiveSpace {
  config: SpaceConfig;
  /** When true, config will be reloaded on the next turn without tearing down sessions. */
  configStale: boolean;
  /** Stable orchestrator session key for the lifetime of this active space. */
  orchestratorSessionId: string;
  /** Round-robin index for round_robin strategy. */
  roundRobinIndex: number;
  /** Cached runtimes (space+agent) so session continuity survives across turns. */
  runtimes: Map<string, AgentRuntime>;
  /** Per-agent conversation sessions (history and continuity metadata). */
  agentSessions: Map<string, AgentSessionState>;
  /** Active runtimes currently executing a turn (turnId -> runtime). */
  activeTurnRuntimes: Map<string, AgentRuntime>;
  /** Paused runtimes awaiting feedback (turnId -> runtime). */
  pausedRuntimes: Map<string, AgentRuntime>;
  /** Feedback timeout timers (turnId -> timer). */
  feedbackTimers: Map<string, ReturnType<typeof setTimeout>>;
  /** Agent IDs for paused runtimes (turnId -> agentId). */
  pausedRuntimeAgentIds: Map<string, string>;
  /** Stored feedback checkpoints for paused turns (turnId -> request). */
  pausedFeedbackRequests: Map<string, RuntimeFeedbackCheckpoint>;
}

export interface AgentSessionState {
  sessionId: string;
  agentId: string;
  messages: ModelMessage[];
  displayTitle?: string;
  providerSessionHandle?: ProviderSessionHandle;
  lastTurnId?: string;
  lastActivityAt: Date;
}

export interface ActiveSpaceStateSnapshot {
  agentStates: Record<string, { status: string; lastTurnId?: string; messages: ModelMessage[] }>;
  turnIds: string[];
}

export interface RestoreAgentSessionCheckpointInput {
  agentStates: Record<string, { status: string; lastTurnId?: string; messages?: ModelMessage[] }>;
  configLoader?: () => Promise<SpaceConfig | null>;
}

export type PersistAgentSessionRuntimeMetadata = (
  spaceId: string,
  session: AgentSessionState,
  metadata: Omit<SaveAgentSessionRuntimeMetadataInput, "spaceId" | "agentId">,
) => Promise<void>;

const MAX_AGENT_SESSION_MESSAGES = 200;

export function createActiveSpace(spaceId: string, config: SpaceConfig): ActiveSpace {
  return {
    config,
    configStale: false,
    orchestratorSessionId: `space:${spaceId}`,
    roundRobinIndex: 0,
    runtimes: new Map(),
    agentSessions: new Map(),
    activeTurnRuntimes: new Map(),
    pausedRuntimes: new Map(),
    feedbackTimers: new Map(),
    pausedRuntimeAgentIds: new Map(),
    pausedFeedbackRequests: new Map(),
  };
}

export function getActiveSpaceState(
  activeSpaces: Map<string, ActiveSpace>,
  spaceId: string,
): ActiveSpaceStateSnapshot | null {
  const active = activeSpaces.get(spaceId);
  if (!active) return null;

  const agentStates: ActiveSpaceStateSnapshot["agentStates"] = {};
  for (const [agentId, session] of active.agentSessions) {
    agentStates[agentId] = {
      status: "active",
      messages: [...session.messages],
      ...(session.lastTurnId ? { lastTurnId: session.lastTurnId } : {}),
    };
  }

  const turnIds: string[] = [];
  for (const session of active.agentSessions.values()) {
    if (session.lastTurnId) {
      turnIds.push(session.lastTurnId);
    }
  }

  return { agentStates, turnIds };
}

export async function restoreActiveSpaceFromCheckpoint(input: {
  activeSpaces: Map<string, ActiveSpace>;
  spaceId: string;
  checkpoint: RestoreAgentSessionCheckpointInput;
  loadSpaceConfig: (spaceId: string) => Promise<SpaceConfig | null>;
}): Promise<boolean> {
  const loader = input.checkpoint.configLoader ?? (() => input.loadSpaceConfig(input.spaceId));
  const config = await loader();
  if (!config) return false;

  const active = createActiveSpace(input.spaceId, config);
  for (const [agentId, state] of Object.entries(input.checkpoint.agentStates)) {
    const messages = state.messages ?? [];
    const capped = messages.length > MAX_AGENT_SESSION_MESSAGES
      ? messages.slice(messages.length - MAX_AGENT_SESSION_MESSAGES)
      : [...messages];

    active.agentSessions.set(agentId, {
      sessionId: `${active.orchestratorSessionId}:agent:${agentId}`,
      agentId,
      messages: capped,
      lastActivityAt: new Date(),
      ...(state.lastTurnId ? { lastTurnId: state.lastTurnId } : {}),
    });
  }

  input.activeSpaces.set(input.spaceId, active);
  return true;
}

export async function ensureActiveSpace(input: {
  activeSpaces: Map<string, ActiveSpace>;
  spaceId: string;
  loadSpaceConfig: (spaceId: string) => Promise<SpaceConfig | null>;
}): Promise<ActiveSpace> {
  const existing = input.activeSpaces.get(input.spaceId);
  if (existing && !existing.configStale) return existing;

  const config = await input.loadSpaceConfig(input.spaceId);
  if (!config) throw new Error(`Space ${input.spaceId} not found`);
  if (config.status === "archived" || config.status === "deleted") {
    throw new Error(`Space ${input.spaceId} is ${config.status}`);
  }

  if (existing) {
    existing.config = config;
    existing.configStale = false;
    return existing;
  }

  const active = createActiveSpace(input.spaceId, config);
  input.activeSpaces.set(input.spaceId, active);
  return active;
}

export async function getRuntimeForAgent(input: {
  space: ActiveSpace;
  agentId: string;
  resolveRuntime: (spaceId: string, agentId: string) => Promise<AgentRuntime>;
}): Promise<AgentRuntime> {
  const cached = input.space.runtimes.get(input.agentId);
  if (cached) return cached;

  const runtime = await input.resolveRuntime(input.space.config.id, input.agentId);
  input.space.runtimes.set(input.agentId, runtime);
  return runtime;
}

export async function getOrCreateAgentSession(input: {
  space: ActiveSpace;
  agentId: string;
  loadHistory: (spaceId: string, limit?: number) => Promise<ModelMessage[]>;
  loadAgentHistory?: (spaceId: string, agentId: string, limit?: number) => Promise<ModelMessage[]>;
  loadAgentSessionMetadata?: (
    spaceId: string,
    agentId: string,
  ) => Promise<AgentSessionRuntimeMetadata | undefined> | AgentSessionRuntimeMetadata | undefined;
}): Promise<AgentSessionState> {
  const existing = input.space.agentSessions.get(input.agentId);
  if (existing) return existing;

  const loadedHistory = input.loadAgentHistory
    ? await input.loadAgentHistory(input.space.config.id, input.agentId, 100)
    : await input.loadHistory(input.space.config.id, 100);
  const loadedMetadata = await input.loadAgentSessionMetadata?.(input.space.config.id, input.agentId);

  const displayTitle = normalizeOptionalString(loadedMetadata?.displayTitle);
  const providerSessionHandle = normalizeProviderSessionHandle(loadedMetadata?.providerSessionHandle);
  const session: AgentSessionState = {
    sessionId: `${input.space.orchestratorSessionId}:agent:${input.agentId}`,
    agentId: input.agentId,
    messages: [...loadedHistory],
    lastActivityAt: new Date(),
    ...(displayTitle ? { displayTitle } : {}),
    ...(providerSessionHandle ? { providerSessionHandle } : {}),
  };
  input.space.agentSessions.set(input.agentId, session);
  return session;
}

export async function resolveCommittedSessionFields(input: {
  space: ActiveSpace;
  session: AgentSessionState;
  userMessage: ModelMessage;
  persistAgentSessionMetadata: PersistAgentSessionRuntimeMetadata;
}): Promise<Pick<TurnContext, "providerSessionHandle" | "sessionTitle">> {
  if (!normalizeOptionalString(input.session.displayTitle)) {
    input.session.displayTitle = buildSessionTitle(input.space, input.session.agentId, input.userMessage.content);
    await input.persistAgentSessionMetadata(input.space.config.id, input.session, {
      displayTitle: input.session.displayTitle,
    }).catch(() => {});
  }

  return {
    ...(input.session.providerSessionHandle ? { providerSessionHandle: input.session.providerSessionHandle } : {}),
    ...(input.session.displayTitle ? { sessionTitle: input.session.displayTitle } : {}),
  };
}

export function buildSessionTitle(space: ActiveSpace, agentId: string, input: string): string {
  const baseTitle = sanitizeSessionTitle(input);
  const fallback = sanitizeSessionTitle(`${space.config.name} · ${agentId}`) || `Space · ${agentId}`;
  if (!baseTitle) {
    return truncateSessionTitle(fallback);
  }
  if (space.config.agents.length <= 1) {
    return truncateSessionTitle(baseTitle);
  }
  return truncateSessionTitle(`${baseTitle} · ${agentId}`);
}

export async function buildLaunchSnapshots(input: {
  space: ActiveSpace;
  turnId: string;
  agents: SpaceAgentAssignment[];
  userMessage: ModelMessage;
  maxHops: number;
  executionIdentity?: TurnExecutionIdentity;
  getRuntime: (space: ActiveSpace, agentId: string) => Promise<AgentRuntime>;
  getSession: (space: ActiveSpace, agentId: string) => Promise<AgentSessionState>;
}): Promise<CliLaunchSnapshot[]> {
  const snapshots = await Promise.all(
    input.agents.map(async (assignment) => {
      const runtime = await input.getRuntime(input.space, assignment.agentId);
      const session = await input.getSession(input.space, assignment.agentId);
      const launchContext: TurnContext = {
        spaceId: input.space.config.id,
        turnId: input.turnId,
        messages: [...session.messages, input.userMessage],
        lineageId: input.space.orchestratorSessionId,
        hopCount: 0,
        maxHops: input.maxHops,
        principalId: input.executionIdentity?.principalId,
        deviceId: input.executionIdentity?.deviceId,
        executionOrigin: input.executionIdentity?.executionOrigin,
        accessMode: input.executionIdentity?.accessMode,
        mode: input.executionIdentity?.mode,
        effort: input.executionIdentity?.effort,
      };

      try {
        const snapshot = await runtime.getLaunchSnapshot?.(launchContext);
        return snapshot ?? undefined;
      } catch {
        return undefined;
      }
    }),
  );

  return snapshots.filter((snapshot): snapshot is CliLaunchSnapshot => Boolean(snapshot));
}

export function updateAgentSession(input: {
  session: AgentSessionState;
  turnId: string;
  userMessage: ModelMessage;
  assistantMessage: ModelMessage;
  options?: {
    spaceId: string;
    providerSessionHandle?: ProviderSessionHandle;
  };
  persistAgentSessionMetadata: PersistAgentSessionRuntimeMetadata;
}): void {
  if (input.session.lastTurnId !== input.turnId) {
    input.session.messages.push(input.userMessage);
  }
  input.session.messages.push(input.assistantMessage);
  if (input.session.messages.length > MAX_AGENT_SESSION_MESSAGES) {
    input.session.messages = input.session.messages.slice(-MAX_AGENT_SESSION_MESSAGES);
  }
  input.session.lastTurnId = input.turnId;
  input.session.lastActivityAt = new Date();
  const providerSessionHandle = normalizeProviderSessionHandle(input.options?.providerSessionHandle);
  if (!providerSessionHandle || !input.options) {
    return;
  }

  input.session.providerSessionHandle = providerSessionHandle;
  void input.persistAgentSessionMetadata(input.options.spaceId, input.session, {
    providerSessionHandle,
  }).catch(() => {});
}
