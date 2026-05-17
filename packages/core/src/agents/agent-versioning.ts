import type { EventBus } from "../events/event-bus.js";

/**
 * Represents a snapshot of an agent profile at a specific revision.
 */
export interface AgentProfileSnapshot {
  profileId: string;
  revision: number;
  personalityPrompt: string;
  defaultSkillIds: string[];
  providerHint: string;
  modelId: string;
  source: string;
  resolvedAt: Date;
}

/**
 * Represents a version pin for an agent within a space.
 * Pins an agent profile to a specific revision, preventing runtime behavior changes.
 */
export interface AgentVersionPin {
  spaceId: string;
  agentId: string;
  profileId: string;
  pinnedRevision: number;
  pinnedAt: Date;
}

/**
 * Options for configuring the AgentVersionManager.
 */
export interface AgentVersionManagerOptions {
  eventBus: EventBus;
  loadRevision: (profileId: string, revision: number) => Promise<AgentProfileSnapshot | null>;
  loadActiveRevision: (profileId: string) => Promise<AgentProfileSnapshot | null>;
}

/**
 * Manages agent version pinning to prevent mid-conversation behavior changes.
 * Allows pinning agent profiles to specific revisions within a space context.
 */
export class AgentVersionManager {
  private eventBus: EventBus;
  private loadRevision: (profileId: string, revision: number) => Promise<AgentProfileSnapshot | null>;
  private loadActiveRevision: (profileId: string) => Promise<AgentProfileSnapshot | null>;

  // In-memory store for version pins: keyed by `${spaceId}:${agentId}`
  private versionPins: Map<string, AgentVersionPin> = new Map();

  constructor(options: AgentVersionManagerOptions) {
    this.eventBus = options.eventBus;
    this.loadRevision = options.loadRevision;
    this.loadActiveRevision = options.loadActiveRevision;
  }

  /**
   * Pins an agent in a space to a specific profile revision.
   * @param spaceId - The space ID
   * @param agentId - The agent ID
   * @param profileId - The agent profile ID
   * @param revision - The revision number to pin to
   */
  async pinToRevision(
    spaceId: string,
    agentId: string,
    profileId: string,
    revision: number
  ): Promise<AgentVersionPin> {
    // Validate that the revision exists by attempting to load it
    const snapshot = await this.loadRevision(profileId, revision);
    if (!snapshot) {
      throw new Error(
        `Unable to pin agent to revision: profile ${profileId} revision ${revision} not found`
      );
    }

    const key = this.getPinKey(spaceId, agentId);
    const pin: AgentVersionPin = {
      spaceId,
      agentId,
      profileId,
      pinnedRevision: revision,
      pinnedAt: new Date(),
    };

    this.versionPins.set(key, pin);

    // Emit event
    this.eventBus.emit({
      type: "agent.version_pinned",
      spaceId,
      agentId,
      profileId,
      pinnedRevision: revision,
      timestamp: new Date(),
    });

    return pin;
  }

  /**
   * Pins an agent in a space to the current active revision.
   * @param spaceId - The space ID
   * @param agentId - The agent ID
   * @param profileId - The agent profile ID
   */
  async pinToCurrent(
    spaceId: string,
    agentId: string,
    profileId: string
  ): Promise<AgentVersionPin> {
    // Load the current active revision
    const activeSnapshot = await this.loadActiveRevision(profileId);
    if (!activeSnapshot) {
      throw new Error(
        `Unable to pin agent to current revision: profile ${profileId} has no active revision`
      );
    }

    return this.pinToRevision(spaceId, agentId, profileId, activeSnapshot.revision);
  }

  /**
   * Unpins an agent in a space, reverting to active revision behavior.
   * @param spaceId - The space ID
   * @param agentId - The agent ID
   */
  unpinAgent(spaceId: string, agentId: string): void {
    const key = this.getPinKey(spaceId, agentId);
    const pin = this.versionPins.get(key);

    if (pin) {
      this.versionPins.delete(key);

      // Emit event
      this.eventBus.emit({
        type: "agent.version_unpinned",
        spaceId,
        agentId,
        profileId: pin.profileId,
        previousRevision: pin.pinnedRevision,
        timestamp: new Date(),
      });
    }
  }

  /**
   * Gets the effective agent profile for a space, considering version pins.
   * Returns the pinned revision's profile snapshot if pinned, otherwise the active revision.
   * @param spaceId - The space ID
   * @param agentId - The agent ID
   * @param profileId - The agent profile ID
   */
  async getEffectiveProfile(
    spaceId: string,
    agentId: string,
    profileId: string
  ): Promise<AgentProfileSnapshot | null> {
    const key = this.getPinKey(spaceId, agentId);
    const pin = this.versionPins.get(key);

    if (pin) {
      // Return the pinned revision
      return this.loadRevision(pin.profileId, pin.pinnedRevision);
    }

    // Fall back to active revision
    return this.loadActiveRevision(profileId);
  }

  /**
   * Lists all version pins, optionally filtered by space.
   * @param spaceId - Optional space ID to filter by
   */
  listPins(spaceId?: string): AgentVersionPin[] {
    const pins = Array.from(this.versionPins.values());

    if (spaceId) {
      return pins.filter((pin) => pin.spaceId === spaceId);
    }

    return pins;
  }

  /**
   * Checks if an agent in a space has a version pin.
   * @param spaceId - The space ID
   * @param agentId - The agent ID
   */
  isPinned(spaceId: string, agentId: string): boolean {
    const key = this.getPinKey(spaceId, agentId);
    return this.versionPins.has(key);
  }

  /**
   * Gets the version pin for an agent in a space, if one exists.
   * @param spaceId - The space ID
   * @param agentId - The agent ID
   */
  getPin(spaceId: string, agentId: string): AgentVersionPin | undefined {
    const key = this.getPinKey(spaceId, agentId);
    return this.versionPins.get(key);
  }

  /**
   * Internal helper to generate a unique key for a space-agent pair.
   */
  private getPinKey(spaceId: string, agentId: string): string {
    return `${spaceId}:${agentId}`;
  }
}
