/**
 * Terminology mapping for consumer vs advanced UI surfaces.
 * Gateway-side canonical mapping — apps consume this for display strings.
 */

export type TerminologyProfile = "consumer" | "advanced";

export interface TermMapping {
  /** Internal canonical key */
  key: string;
  /** Consumer-friendly term */
  consumer: string;
  /** Advanced/technical term */
  advanced: string;
}

/** Core term mappings */
export const TERM_MAPPINGS: ReadonlyArray<TermMapping> = [
  { key: "gateway", consumer: "Server", advanced: "Gateway" },
  { key: "space", consumer: "Space", advanced: "Space" },
  { key: "agent", consumer: "Assistant", advanced: "Agent" },
  { key: "profile", consumer: "Personality", advanced: "Agent Profile" },
  { key: "capability", consumer: "Skill", advanced: "Capability" },
  { key: "connector", consumer: "Integration", advanced: "Connector" },
  { key: "orchestrator", consumer: "Coordinator", advanced: "Orchestrator" },
  { key: "turn_model", consumer: "Response Style", advanced: "Turn Model" },
  { key: "resource", consumer: "Device", advanced: "Resource" },
  { key: "principal", consumer: "User", advanced: "Principal" },
  { key: "noise_transport", consumer: "Encrypted Connection", advanced: "Noise Transport" },
  { key: "invite", consumer: "Invitation", advanced: "Share Invite" },
] as const;

/** Pre-built lookup maps for O(1) access */
const consumerMap: Record<string, string> = {};
const advancedMap: Record<string, string> = {};

for (const m of TERM_MAPPINGS) {
  consumerMap[m.key] = m.consumer;
  advancedMap[m.key] = m.advanced;
}

/**
 * Get the display term for a given key and profile.
 * Returns the key itself if no mapping exists (no throw).
 */
export function getTerm(key: string, profile: TerminologyProfile): string {
  const map = profile === "consumer" ? consumerMap : advancedMap;
  return map[key] ?? key;
}

/**
 * Get all terms for a profile as a key->display record.
 */
export function getTermMap(profile: TerminologyProfile): Record<string, string> {
  const result: Record<string, string> = {};
  for (const m of TERM_MAPPINGS) {
    result[m.key] = profile === "consumer" ? m.consumer : m.advanced;
  }
  return result;
}
