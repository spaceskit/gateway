import { stringify, parseDocument } from "yaml";

export const GOAL_CONTRACT_FENCE = "```yaml goal_contract";

export interface GoalContract {
  schemaVersion: 1;
  goalId: string;
  contractState: "draft" | "reviewed";
  owner: string;
  status: string;
  delegation: string;
  aiShippable: boolean;
  products: string[];
  outcome: string;
  scope: {
    in: string[];
    out: string[];
  };
  successCriteria: string[];
  verification: {
    commands: string[];
  };
  blockers: string[];
}

export interface GoalContractMetadata {
  owner?: string;
  status?: string;
  delegation?: string;
  aiShippable?: boolean;
  products?: string[];
}

export interface GoalContractIssue {
  code: string;
  message: string;
}

export interface GoalContractParseResult {
  state: "missing" | "present" | "malformed";
  contract?: GoalContract;
  yamlText?: string;
  errors: GoalContractIssue[];
}

export interface GoalContractValidationResult extends GoalContractParseResult {
  valid: boolean;
  warnings: GoalContractIssue[];
}

export interface DraftGoalContractInput {
  goalId: string;
  owner: string;
  status: string;
  delegation: string;
  aiShippable: boolean;
  products: string[];
  outcome: string;
  scopeIn: string[];
  scopeOut: string[];
  successCriteria: string[];
  verificationCommands: string[];
  blockers: string[];
}

export function parseGoalContractBlock(markdown: string): GoalContractParseResult {
  const match = markdown.match(/```yaml\s+goal_contract\s*\r?\n([\s\S]*?)\r?\n```/);
  if (!match) {
    return {
      state: "missing",
      errors: [{ code: "missing_contract", message: "Missing goal_contract block." }],
    };
  }

  const yamlText = match[1] ?? "";
  const document = parseDocument(yamlText);
  if (document.errors.length > 0) {
    return {
      state: "malformed",
      yamlText,
      errors: [{ code: "malformed_contract", message: "goal_contract YAML is malformed." }],
    };
  }

  const value = document.toJS();
  if (!isRecord(value)) {
    return {
      state: "malformed",
      yamlText,
      errors: [{ code: "malformed_contract", message: "goal_contract must be a mapping." }],
    };
  }

  return {
    state: "present",
    yamlText,
    contract: value as unknown as GoalContract,
    errors: [],
  };
}

export function validateGoalContractMarkdown(input: {
  markdown: string;
  expectedGoalId: string;
  metadata: GoalContractMetadata;
  verificationCommands: string[];
}): GoalContractValidationResult {
  const parsed = parseGoalContractBlock(input.markdown);
  if (parsed.state !== "present" || !parsed.contract) {
    return {
      ...parsed,
      valid: false,
      warnings: [],
    };
  }

  const errors = [...parsed.errors];
  const warnings: GoalContractIssue[] = [];
  const contract = parsed.contract as unknown;

  if (!isRecord(contract)) {
    errors.push({ code: "malformed_contract", message: "goal_contract must be a mapping." });
    return {
      ...parsed,
      valid: false,
      errors,
      warnings,
    };
  }

  requireLiteral(contract.schemaVersion, 1, "schemaVersion", errors);
  requireString(contract.goalId, "goalId", errors);
  requireString(contract.contractState, "contractState", errors);
  requireString(contract.owner, "owner", errors);
  requireString(contract.status, "status", errors);
  requireString(contract.delegation, "delegation", errors);
  requireBoolean(contract.aiShippable, "aiShippable", errors);
  requireStringArray(contract.products, "products", errors);
  requireString(contract.outcome, "outcome", errors);
  requireStringArray(isRecord(contract.scope) ? contract.scope.in : undefined, "scope.in", errors);
  requireStringArray(isRecord(contract.scope) ? contract.scope.out : undefined, "scope.out", errors);
  requireStringArray(contract.successCriteria, "successCriteria", errors);
  requireStringArray(isRecord(contract.verification) ? contract.verification.commands : undefined, "verification.commands", errors);
  requireStringArray(contract.blockers, "blockers", errors);

  if (errors.length > 0) {
    return {
      ...parsed,
      valid: false,
      errors,
      warnings,
    };
  }

  const goalContract = contract as unknown as GoalContract;
  if (goalContract.goalId !== input.expectedGoalId) {
    errors.push({ code: "goal_id_mismatch", message: "goal_contract goalId must match the task filename stem." });
  }
  if (input.metadata.owner && goalContract.owner.trim() !== input.metadata.owner.trim()) {
    errors.push({ code: "owner_mismatch", message: "goal_contract owner must match task metadata." });
  }
  if (input.metadata.status && goalContract.status.trim() !== input.metadata.status.trim()) {
    errors.push({ code: "status_mismatch", message: "goal_contract status must match task metadata." });
  }
  if (input.metadata.delegation && normalizeScalar(goalContract.delegation) !== normalizeScalar(input.metadata.delegation)) {
    errors.push({ code: "delegation_mismatch", message: "goal_contract delegation must match task metadata." });
  }
  if (typeof input.metadata.aiShippable === "boolean" && goalContract.aiShippable !== input.metadata.aiShippable) {
    errors.push({ code: "ai_shippable_mismatch", message: "goal_contract aiShippable must match task metadata." });
  }
  if (input.metadata.products && !arraysEqual(normalizeList(goalContract.products), normalizeList(input.metadata.products))) {
    errors.push({ code: "products_mismatch", message: "goal_contract products must match task metadata." });
  }
  if (!arraysEqual(goalContract.verification.commands, input.verificationCommands)) {
    errors.push({ code: "verification_commands_mismatch", message: "goal_contract verification.commands must match machine-readable verification commands." });
  }
  if (goalContract.contractState === "draft") {
    warnings.push({ code: "draft_contract", message: "goal_contract is marked draft and needs human review." });
  }
  if (goalContract.contractState !== "draft" && goalContract.contractState !== "reviewed") {
    errors.push({ code: "invalid_contract_state", message: "goal_contract contractState must be draft or reviewed." });
  }

  return {
    ...parsed,
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

export function buildDraftGoalContractMarkdown(input: DraftGoalContractInput): string {
  const contract: GoalContract = {
    schemaVersion: 1,
    goalId: input.goalId,
    contractState: "draft",
    owner: input.owner,
    status: input.status,
    delegation: input.delegation,
    aiShippable: input.aiShippable,
    products: normalizeDisplayList(input.products),
    outcome: normalizeText(input.outcome, "No outcome declared."),
    scope: {
      in: normalizeDisplayList(input.scopeIn.length > 0 ? input.scopeIn : [input.outcome]),
      out: normalizeDisplayList(input.scopeOut.length > 0 ? input.scopeOut : ["No out-of-scope work declared."]),
    },
    successCriteria: normalizeDisplayList(input.successCriteria.length > 0 ? input.successCriteria : [input.outcome]),
    verification: {
      commands: input.verificationCommands,
    },
    blockers: normalizeDisplayList(input.blockers),
  };
  return `${GOAL_CONTRACT_FENCE}\n${stringify(contract, { lineWidth: 0 }).trimEnd()}\n\`\`\``;
}

export function insertDraftGoalContract(markdown: string, contractBlock: string): string {
  if (parseGoalContractBlock(markdown).state === "present") {
    return markdown;
  }

  const metadataHeading = findHeading(markdown, "Metadata");
  if (metadataHeading !== -1) {
    const nextHeading = findNextHeading(markdown, metadataHeading + 1);
    const insertAt = nextHeading === -1 ? markdown.length : nextHeading;
    return insertAtBlock(markdown, insertAt, contractBlock);
  }

  const firstHeading = markdown.match(/^#\s+.+$/m);
  if (firstHeading?.index !== undefined) {
    const headingEnd = markdown.indexOf("\n", firstHeading.index);
    return insertAtBlock(markdown, headingEnd === -1 ? markdown.length : headingEnd + 1, contractBlock);
  }

  return `${contractBlock}\n\n${markdown}`;
}

export function deriveDraftGoalContractInput(markdown: string, taskFileName: string): DraftGoalContractInput {
  const metadata = collectPlanningMetadata(markdown);
  const goalId = taskFileName.replace(/\.md$/i, "");
  const owner = metadata.get("owner") ?? "unassigned";
  const status = metadata.get("status") ?? "Planned";
  const delegation = (metadata.get("delegation") ?? "supervised").trim().toLowerCase();
  const aiShippable = normalizeScalar(metadata.get("ai-shippable") ?? metadata.get("ai shippable") ?? "no") === "yes";
  const products = splitMetadataList(metadata.get("products"));
  const outcome = firstMeaningfulLine(extractMarkdownSection(markdown, "Goal"))
    ?? firstMeaningfulLine(extractMarkdownSection(markdown, "Problem And Outcome"))
    ?? extractTaskTitle(markdown)
    ?? goalId;
  const scopeIn = extractSectionList(markdown, "Scope In");
  const scopeOut = extractSectionList(markdown, "Scope Out");
  const successCriteria = extractSectionList(markdown, "Acceptance Criteria")
    .concat(extractSectionList(markdown, "Success Metric"))
    .filter(Boolean);

  return {
    goalId,
    owner,
    status,
    delegation,
    aiShippable,
    products,
    outcome,
    scopeIn: scopeIn.length > 0 ? scopeIn : [outcome],
    scopeOut,
    successCriteria: successCriteria.length > 0 ? successCriteria : [outcome],
    verificationCommands: extractMachineReadableVerificationCommands(markdown),
    blockers: [],
  };
}

export function collectPlanningMetadata(content: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const line of content.split("\n")) {
    const bullet = line.match(/^\s*-\s+([^:]+):\s*(.+)\s*$/);
    if (bullet) {
      result.set(normalizeMetadataKey(bullet[1]!), bullet[2]!.trim());
      continue;
    }
    const bold = line.match(/^\s*\*\*([^*]+)\*\*:\s*(.+)\s*$/);
    if (bold) {
      result.set(normalizeMetadataKey(bold[1]!), bold[2]!.trim());
    }
  }
  return result;
}

export function extractMachineReadableVerificationCommands(content: string): string[] {
  const section = extractMarkdownSection(content, "Verification Commands (Machine-Readable)");
  if (!section) return [];
  return section
    .split("\n")
    .map((line) => line.match(/^\s*\d+\.\s+`([^`]+)`/))
    .filter((match): match is RegExpMatchArray => Boolean(match))
    .map((match) => match[1]!);
}

export function extractMarkdownSection(content: string, headingTitle: string): string | null {
  const lines = content.split("\n");
  const headingIndex = lines.findIndex((line) => line.startsWith("## ") && line.slice(3).trim() === headingTitle);
  if (headingIndex === -1) return null;
  const sectionLines: string[] = [];
  for (let index = headingIndex + 1; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (line.startsWith("## ")) break;
    sectionLines.push(line);
  }
  return sectionLines.join("\n").trim() || null;
}

function extractTaskTitle(content: string): string | null {
  const match = content.match(/^#\s+(?:Task:\s+)?(.+)$/m);
  return match?.[1]?.trim() ?? null;
}

function extractSectionList(markdown: string, headingTitle: string): string[] {
  const section = extractMarkdownSection(markdown, headingTitle);
  if (!section) return [];
  const items = section
    .split("\n")
    .map((line) => stripMarkdownListPrefix(line))
    .filter(Boolean);
  return items.length > 0 ? items : [];
}

function firstMeaningfulLine(section: string | null): string | null {
  if (!section) return null;
  for (const line of section.split("\n")) {
    const stripped = stripMarkdownListPrefix(line);
    if (stripped) return stripped;
  }
  return null;
}

function stripMarkdownListPrefix(line: string): string {
  return line
    .trim()
    .replace(/^\d+\.\s+/, "")
    .replace(/^[-*]\s+/, "")
    .trim();
}

function insertAtBlock(markdown: string, index: number, contractBlock: string): string {
  const before = markdown.slice(0, index).trimEnd();
  const after = markdown.slice(index).trimStart();
  return `${before}\n\n${contractBlock}\n\n${after}`;
}

function findHeading(markdown: string, title: string): number {
  const match = new RegExp(`^##\\s+${escapeRegExp(title)}\\s*$`, "m").exec(markdown);
  return match?.index ?? -1;
}

function findNextHeading(markdown: string, fromIndex: number): number {
  const rest = markdown.slice(fromIndex);
  const match = /^##\s+.+$/m.exec(rest);
  return match?.index === undefined ? -1 : fromIndex + match.index;
}

function requireLiteral(value: unknown, expected: unknown, path: string, errors: GoalContractIssue[]): void {
  if (value !== expected) {
    errors.push({ code: `invalid_${pathToCode(path)}`, message: `goal_contract ${path} must be ${String(expected)}.` });
  }
}

function requireString(value: unknown, path: string, errors: GoalContractIssue[]): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    errors.push({ code: `missing_${pathToCode(path)}`, message: `goal_contract ${path} must be a non-empty string.` });
  }
}

function requireBoolean(value: unknown, path: string, errors: GoalContractIssue[]): void {
  if (typeof value !== "boolean") {
    errors.push({ code: `invalid_${pathToCode(path)}`, message: `goal_contract ${path} must be a boolean.` });
  }
}

function requireStringArray(value: unknown, path: string, errors: GoalContractIssue[]): void {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.trim().length === 0)) {
    errors.push({ code: `invalid_${pathToCode(path)}`, message: `goal_contract ${path} must be an array of non-empty strings.` });
  }
}

function pathToCode(path: string): string {
  return path.replace(/[.]/g, "_").replace(/[^a-zA-Z0-9_]/g, "").replace(/[A-Z]/g, (char) => `_${char.toLowerCase()}`);
}

function normalizeScalar(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function normalizeList(values: string[]): string[] {
  return values.map((value) => value.trim().toLowerCase()).filter(Boolean).sort();
}

function normalizeDisplayList(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => normalizeText(value, "")).filter(Boolean)));
}

function normalizeText(value: string, fallback: string): string {
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : fallback;
}

function arraysEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function splitMetadataList(raw: string | undefined): string[] {
  if (!raw) return [];
  return Array.from(
    new Set(
      raw
        .split(/[|,]/)
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean),
    ),
  );
}

function normalizeMetadataKey(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, " ");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
