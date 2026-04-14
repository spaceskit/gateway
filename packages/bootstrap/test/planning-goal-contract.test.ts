import { describe, expect, test } from "bun:test";
import {
  buildDraftGoalContractMarkdown,
  insertDraftGoalContract,
  parseGoalContractBlock,
  validateGoalContractMarkdown,
} from "../src/services/planning-goal-contract.js";

const verificationCommands = [
  "cd gateway && bun test packages/bootstrap/test/workbench-service.test.ts",
  "cd gateway && bun run typecheck",
];

const validContract = `\`\`\`yaml goal_contract
schemaVersion: 1
goalId: td-workbench-goal-contracts
contractState: reviewed
owner: gateway
status: Planned
delegation: autonomous
aiShippable: true
products:
  - gateway
outcome: Make planning tasks machine-readable enough for Workbench audits.
scope:
  in:
    - Parse goal contracts.
  out:
    - Native app UI changes.
successCriteria:
  - Contract drift is reported by audit.
verification:
  commands:
    - cd gateway && bun test packages/bootstrap/test/workbench-service.test.ts
    - cd gateway && bun run typecheck
blockers: []
\`\`\``;

describe("planning goal contracts", () => {
  test("parses a yaml goal_contract fenced block", () => {
    const result = parseGoalContractBlock(`# Task\n\n${validContract}\n`);

    expect(result.state).toBe("present");
    expect(result.contract?.goalId).toBe("td-workbench-goal-contracts");
    expect(result.contract?.verification.commands).toEqual(verificationCommands);
    expect(result.errors).toEqual([]);
  });

  test("validates required fields and metadata drift", () => {
    const result = validateGoalContractMarkdown({
      markdown: validContract,
      expectedGoalId: "td-workbench-goal-contracts",
      metadata: {
        owner: "gateway",
        status: "Planned",
        delegation: "supervised",
        aiShippable: true,
        products: ["gateway"],
      },
      verificationCommands,
    });

    expect(result.valid).toBe(false);
    expect(result.errors.map((issue) => issue.code)).toContain("delegation_mismatch");
    expect(result.errors.map((issue) => issue.message)).toContain("goal_contract delegation must match task metadata.");
  });

  test("marks draft contracts as warnings, not errors", () => {
    const draft = validContract.replace("contractState: reviewed", "contractState: draft");
    const result = validateGoalContractMarkdown({
      markdown: draft,
      expectedGoalId: "td-workbench-goal-contracts",
      metadata: {
        owner: "gateway",
        status: "Planned",
        delegation: "autonomous",
        aiShippable: true,
        products: ["gateway"],
      },
      verificationCommands,
    });

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings.map((issue) => issue.code)).toContain("draft_contract");
  });

  test("builds and inserts a draft contract after metadata", () => {
    const markdown = `# Task: td-workbench-goal-contracts

## Metadata
- Status: Planned
- Owner: gateway
- Delegation: autonomous
- AI-Shippable: yes

## Goal
- Make planning tasks machine-readable.
`;

    const block = buildDraftGoalContractMarkdown({
      goalId: "td-workbench-goal-contracts",
      owner: "gateway",
      status: "Planned",
      delegation: "autonomous",
      aiShippable: true,
      products: ["gateway"],
      outcome: "Make planning tasks machine-readable.",
      scopeIn: ["Make planning tasks machine-readable."],
      scopeOut: ["No out-of-scope work declared."],
      successCriteria: ["Make planning tasks machine-readable."],
      verificationCommands,
      blockers: [],
    });
    const updated = insertDraftGoalContract(markdown, block);

    expect(updated).toContain("```yaml goal_contract\nschemaVersion: 1");
    expect(updated.indexOf("```yaml goal_contract")).toBeGreaterThan(updated.indexOf("## Metadata"));
    expect(updated.indexOf("```yaml goal_contract")).toBeLessThan(updated.indexOf("## Goal"));
  });
});
