import { describe, expect, test } from "bun:test";
import {
  USER_ESCALATION_SKILL_ID,
  createConciergeEscalationToolDefinitions,
  createConciergeEscalationToolFilter,
} from "../../src/agents/concierge-escalation-tools.js";

describe("concierge escalation tools", () => {
  test("defines the trusted concierge escalation tool set", () => {
    const definitions = createConciergeEscalationToolDefinitions();
    expect(definitions.map((entry) => entry.name)).toEqual([
      "concierge.request_user_input",
      "concierge.get_request_status",
      "concierge.cancel_request",
    ]);
  });

  test("filter only allows profiles with the user-escalation skill", async () => {
    const filter = createConciergeEscalationToolFilter({
      spaceAdminService: {
        getSpace: async () => ({
          agents: [
            { agentId: "trusted-agent", profileId: "profile-trusted" },
            { agentId: "worker-agent", profileId: "profile-worker" },
          ],
        }),
      },
      profileRepo: {
        getActiveRevision: (profileId: string) => ({
          default_skill_set_ids_json: profileId === "profile-trusted"
            ? JSON.stringify([USER_ESCALATION_SKILL_ID])
            : JSON.stringify([]),
        }),
      },
    });

    await expect(filter("space-main", "trusted-agent")).resolves.toBe(true);
    await expect(filter("space-main", "worker-agent")).resolves.toBe(false);
  });
});
