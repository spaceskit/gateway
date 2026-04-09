#!/usr/bin/env node

import { spawn } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { delimiter, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  JIRA_TOOL_DEFINITIONS,
  SPACES_JIRA_WRAPPER_VERSION,
  getJiraToolDefinitionByOperation,
} from "./catalog.mjs";

const ISSUE_KEY_PATTERN = /\b[A-Z][A-Z0-9]+-\d+\b/g;
const COMMON_JIRA_DIRS = [
  "/opt/homebrew/bin",
  "/usr/local/bin",
  "/usr/bin",
  "~/.local/bin",
  "~/bin",
];
const DEFAULT_JIRA_LIST_LIMIT = 20;
const MAX_JIRA_LIST_LIMIT = 100;
const COMPACT_DELIMITER = "|||";
const ISSUE_COMPACT_COLUMNS = ["key", "summary", "status", "assignee", "reporter", "priority", "updated"];
const SPRINT_COMPACT_COLUMNS = ["id", "name", "start", "end", "complete", "state"];
const ANSI_ESCAPE_PATTERN = /\u001B\[[0-9;]*m/g;

export function buildJiraCommandArgs(operation, payloadInput = {}) {
  const payload = normalizePayloadRecord(payloadInput);
  switch (normalizeOperation(operation)) {
    case "me":
      return ["me"];
    case "serverinfo":
      return ["serverinfo"];
    case "project.list":
      return ["project", "list"];
    case "board.list":
      return withProjectPrefix(payload, ["board", "list"]);
    case "release.list":
      return withProjectPrefix(payload, ["release", "list"]);
    case "epic.list":
      return buildEpicListArgs(payload);
    case "sprint.list":
      return buildSprintListArgs(payload);
    case "issue.list":
      return buildIssueListArgs(payload);
    case "issue.view":
      return buildIssueViewArgs(payload);
    case "issue.create":
      return buildIssueCreateArgs(payload);
    case "issue.edit":
      return buildIssueEditArgs(payload);
    case "issue.clone":
      return buildIssueCloneArgs(payload);
    case "issue.assign":
      return buildIssueAssignArgs(payload);
    case "issue.move":
      return buildIssueMoveArgs(payload);
    case "issue.comment.add":
      return buildIssueCommentAddArgs(payload);
    case "issue.link":
      return buildIssueLinkArgs(payload);
    case "issue.link.remote":
      return buildIssueRemoteLinkArgs(payload);
    case "issue.unlink":
      return buildIssueUnlinkArgs(payload);
    case "issue.watch":
      return buildIssueWatchArgs(payload);
    case "issue.worklog.add":
      return buildIssueWorklogAddArgs(payload);
    case "sprint.add":
      return buildSprintAddArgs(payload);
    case "sprint.close":
      return buildSprintCloseArgs(payload);
    default:
      throw new Error(`Unsupported Jira operation: ${operation}`);
  }
}

export async function runJiraOperation(input, dependencies = {}) {
  const operation = normalizeOperation(input?.operation);
  const payload = normalizePayloadRecord(input?.payload);
  const env = normalizeEnv(input?.env ?? process.env);
  const runCommand = dependencies.runCommand ?? spawnCommand;
  const jiraExecutable = resolveJiraExecutable(env);
  const primaryArgs = buildJiraCommandArgs(operation, payload);
  const primary = await executeJira({
    jiraExecutable,
    args: primaryArgs,
    env,
    runCommand,
    operation,
  });

  switch (operation) {
    case "me":
      return envelope(operation, `Fetched the configured Jira identity.`, {
        data: {
          user: primary.stdout.trim(),
        },
      });
    case "serverinfo":
      return envelope(operation, `Fetched Jira server information.`, {
        data: textData(primary.stdout),
      });
    case "project.list":
      return envelope(operation, `Listed Jira projects.`, {
        data: textData(primary.stdout),
      });
    case "board.list":
      return envelope(operation, `Listed Jira boards.`, {
        data: textData(primary.stdout),
        refs: projectRef(payload),
      });
    case "release.list":
      return envelope(operation, `Listed Jira releases.`, {
        data: textData(primary.stdout),
        refs: projectRef(payload),
      });
    case "epic.list": {
      const detail = normalizeListDetail(payload.detail);
      const data = detail === "raw"
        ? parseJsonOutput(operation, primary.stdout)
        : parseCompactIssueRows(primary.stdout);
      const summary = payload.epicKey
        ? `Listed issues for Jira epic ${payload.epicKey}.`
        : "Listed Jira epics.";
      return envelope(operation, summary, {
        data,
        refs: epicListRefs(payload, data),
      });
    }
    case "sprint.list": {
      const detail = normalizeListDetail(payload.detail);
      const data = detail === "raw"
        ? parseJsonOutput(operation, primary.stdout)
        : isSprintIssueSelection(payload)
          ? parseCompactIssueRows(primary.stdout)
          : parseCompactSprintRows(primary.stdout);
      const summary = payload.sprintId
        ? `Listed issues for Jira sprint ${payload.sprintId}.`
        : payload.current
          ? "Listed issues for the current Jira sprint."
          : payload.previous
            ? "Listed issues for the previous Jira sprint."
            : payload.next
              ? "Listed issues for the next Jira sprint."
              : "Listed Jira sprints.";
      return envelope(operation, summary, {
        data,
        refs: sprintListRefs(payload, data),
      });
    }
    case "issue.list": {
      const detail = normalizeListDetail(payload.detail);
      const data = detail === "raw"
        ? parseJsonOutput(operation, primary.stdout)
        : parseCompactIssueRows(primary.stdout);
      return envelope(operation, "Listed Jira issues.", {
        data,
        refs: issueListRefs(payload, data),
      });
    }
    case "issue.view": {
      const data = parseJsonOutput(operation, primary.stdout);
      return envelope(operation, `Fetched Jira issue ${payload.issueKey}.`, {
        data,
        refs: {
          issueKey: payload.issueKey,
          ...projectRef(payload),
        },
      });
    }
    case "issue.create": {
      const created = parseJsonOutput(operation, primary.stdout);
      const issueKey = extractIssueKey(created) ?? extractIssueKey(primary.stdout);
      const refreshed = await tryReadIssue({
        issueKey,
        payload,
        jiraExecutable,
        env,
        runCommand,
      });
      return envelope(
        operation,
        issueKey ? `Created Jira issue ${issueKey}.` : "Created a Jira issue.",
        {
          data: refreshed ?? created,
          refs: {
            ...(issueKey ? { issueKey } : {}),
            ...projectRef(payload),
          },
        },
      );
    }
    case "issue.edit":
      return finalizeIssueMutation({
        operation,
        summary: `Updated Jira issue ${payload.issueKey}.`,
        issueKey: payload.issueKey,
        payload,
        jiraExecutable,
        env,
        runCommand,
        fallbackText: primary.stdout,
      });
    case "issue.clone": {
      const sourceIssueKey = requiredString(payload.issueKey, "issueKey");
      const clonedIssueKey = extractIssueKey(primary.stdout) ?? extractIssueKey(primary.stderr);
      const refreshed = await tryReadIssue({
        issueKey: clonedIssueKey,
        payload,
        jiraExecutable,
        env,
        runCommand,
      });
      const summary = clonedIssueKey
        ? `Cloned Jira issue ${sourceIssueKey} to ${clonedIssueKey}.`
        : `Cloned Jira issue ${sourceIssueKey}.`;
      return envelope(operation, summary, {
        data: refreshed ?? textData(primary.stdout),
        refs: {
          sourceIssueKey,
          ...(clonedIssueKey ? { issueKey: clonedIssueKey } : {}),
          ...projectRef(payload),
        },
      });
    }
    case "issue.assign":
      return finalizeIssueMutation({
        operation,
        summary: `Assigned Jira issue ${payload.issueKey} to ${payload.assignee}.`,
        issueKey: payload.issueKey,
        payload,
        jiraExecutable,
        env,
        runCommand,
        fallbackText: primary.stdout,
      });
    case "issue.move":
      return finalizeIssueMutation({
        operation,
        summary: `Moved Jira issue ${payload.issueKey} to ${payload.state}.`,
        issueKey: payload.issueKey,
        payload,
        jiraExecutable,
        env,
        runCommand,
        fallbackText: primary.stdout,
      });
    case "issue.comment.add":
      return finalizeIssueMutation({
        operation,
        summary: `Added a comment to Jira issue ${payload.issueKey}.`,
        issueKey: payload.issueKey,
        payload,
        jiraExecutable,
        env,
        runCommand,
        fallbackText: primary.stdout,
      });
    case "issue.link":
      return finalizeIssueMutation({
        operation,
        summary: `Linked Jira issues ${payload.inwardIssueKey} and ${payload.outwardIssueKey}.`,
        issueKey: payload.inwardIssueKey,
        payload,
        jiraExecutable,
        env,
        runCommand,
        fallbackText: primary.stdout,
        refs: {
          issueKey: payload.inwardIssueKey,
          linkedIssueKey: payload.outwardIssueKey,
          ...projectRef(payload),
        },
      });
    case "issue.link.remote":
      return finalizeIssueMutation({
        operation,
        summary: `Added a remote link to Jira issue ${payload.issueKey}.`,
        issueKey: payload.issueKey,
        payload,
        jiraExecutable,
        env,
        runCommand,
        fallbackText: primary.stdout,
      });
    case "issue.unlink":
      return finalizeIssueMutation({
        operation,
        summary: `Unlinked Jira issues ${payload.inwardIssueKey} and ${payload.outwardIssueKey}.`,
        issueKey: payload.inwardIssueKey,
        payload,
        jiraExecutable,
        env,
        runCommand,
        fallbackText: primary.stdout,
        refs: {
          issueKey: payload.inwardIssueKey,
          unlinkedIssueKey: payload.outwardIssueKey,
          ...projectRef(payload),
        },
      });
    case "issue.watch":
      return finalizeIssueMutation({
        operation,
        summary: `Added watcher ${payload.watcher} to Jira issue ${payload.issueKey}.`,
        issueKey: payload.issueKey,
        payload,
        jiraExecutable,
        env,
        runCommand,
        fallbackText: primary.stdout,
      });
    case "issue.worklog.add":
      return finalizeIssueMutation({
        operation,
        summary: `Added worklog to Jira issue ${payload.issueKey}.`,
        issueKey: payload.issueKey,
        payload,
        jiraExecutable,
        env,
        runCommand,
        fallbackText: primary.stdout,
      });
    case "sprint.add":
      return envelope(
        operation,
        `Added ${payload.issueKeys.length} issue(s) to Jira sprint ${payload.sprintId}.`,
        {
          data: textData(primary.stdout),
          refs: {
            sprintId: payload.sprintId,
            issueKeys: payload.issueKeys,
            ...projectRef(payload),
          },
        },
      );
    case "sprint.close":
      return envelope(
        operation,
        `Closed Jira sprint ${payload.sprintId}.`,
        {
          data: textData(primary.stdout),
          refs: {
            sprintId: payload.sprintId,
            ...projectRef(payload),
          },
        },
      );
    default:
      throw new Error(`Unsupported Jira operation: ${operation}`);
  }
}

export function parseWrapperCliArgs(argvInput = []) {
  const argv = Array.isArray(argvInput) ? [...argvInput] : [];
  const parsed = {
    help: false,
    version: false,
    operation: "",
    payload: {},
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--help" || token === "-h") {
      parsed.help = true;
      continue;
    }
    if (token === "--version" || token === "-v") {
      parsed.version = true;
      continue;
    }
    if (token === "--op" || token === "--operation") {
      parsed.operation = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (token.startsWith("--op=") || token.startsWith("--operation=")) {
      parsed.operation = token.split("=", 2)[1] ?? "";
      continue;
    }
    if (token === "--payload") {
      parsed.payload = parsePayloadArgument(argv[index + 1]);
      index += 1;
      continue;
    }
    if (token.startsWith("--payload=")) {
      parsed.payload = parsePayloadArgument(token.split("=", 2)[1]);
      continue;
    }
    throw new Error(`Unexpected argument: ${token}`);
  }

  return parsed;
}

export function resolveJiraExecutable(envInput = process.env) {
  const env = normalizeEnv(envInput);
  const explicit = nonEmptyString(env.SPACES_JIRA_EXECUTABLE);
  if (explicit) {
    assertExecutable(resolve(explicit), "SPACES_JIRA_EXECUTABLE");
    return resolve(explicit);
  }

  const searchDirs = [
    ...splitPathEntries(env.PATH),
    ...COMMON_JIRA_DIRS.map((entry) => expandHome(entry, env.HOME)),
  ];
  const visited = new Set();
  for (const dir of searchDirs) {
    const normalizedDir = nonEmptyString(dir);
    if (!normalizedDir || visited.has(normalizedDir)) {
      continue;
    }
    visited.add(normalizedDir);
    const candidate = join(normalizedDir, "jira");
    if (isExecutable(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    "Unable to locate `jira` in PATH or common install directories. Install jira-cli or set SPACES_JIRA_EXECUTABLE.",
  );
}

function normalizeOperation(value) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) {
    throw new Error("A Jira wrapper operation is required.");
  }
  const definition = getJiraToolDefinitionByOperation(normalized);
  if (!definition) {
    throw new Error(`Unsupported Jira wrapper operation: ${normalized}`);
  }
  return definition.operation;
}

function buildEpicListArgs(payload) {
  const args = withProjectPrefix(payload, ["epic", "list"]);
  if (nonEmptyString(payload.epicKey)) {
    args.push(requiredString(payload.epicKey, "epicKey"));
  }
  const detail = normalizeListDetail(payload.detail);
  appendIssueListFlags(args, payload, { detail });
  appendBoundedPagination(args, payload);
  if (detail === "raw") {
    args.push("--raw");
    return args;
  }
  appendCompactTableFlags(args, ISSUE_COMPACT_COLUMNS);
  return args;
}

function buildSprintListArgs(payload) {
  validateExclusiveSelectors(payload, ["sprintId", "current", "previous", "next"], "sprint.list");
  const args = withProjectPrefix(payload, ["sprint", "list"]);
  if (nonEmptyString(payload.sprintId)) {
    args.push(requiredString(payload.sprintId, "sprintId"));
  } else if (payload.current === true) {
    args.push("--current");
  } else if (payload.previous === true) {
    args.push("--prev");
  } else if (payload.next === true) {
    args.push("--next");
  }
  const states = stringArray(payload.state);
  if (states.length > 0) {
    args.push("--state", states.join(","));
  }
  if (payload.showAllIssues === true) {
    args.push("--show-all-issues");
  }
  const detail = normalizeListDetail(payload.detail);
  appendIssueListFlags(args, payload, { detail });
  appendBoundedPagination(args, payload);
  if (detail === "raw") {
    args.push("--raw");
    return args;
  }
  if (!isSprintIssueSelection(payload)) {
    args.push("--table");
    appendCompactTableFlags(args, SPRINT_COMPACT_COLUMNS);
    return args;
  }
  appendCompactTableFlags(args, ISSUE_COMPACT_COLUMNS);
  return args;
}

function buildIssueListArgs(payload) {
  const args = withProjectPrefix(payload, ["issue", "list"]);
  const query = nonEmptyString(payload.query);
  if (query) {
    args.push(query);
  }
  const detail = normalizeListDetail(payload.detail);
  appendIssueListFlags(args, payload, { detail });
  appendBoundedPagination(args, payload);
  if (detail === "raw") {
    args.push("--raw");
    return args;
  }
  appendCompactTableFlags(args, ISSUE_COMPACT_COLUMNS);
  return args;
}

function buildIssueViewArgs(payload) {
  const args = withProjectPrefix(payload, ["issue", "view", requiredString(payload.issueKey, "issueKey")]);
  const comments = integerValue(payload.comments, "comments");
  if (comments !== undefined) {
    args.push("--comments", String(comments));
  }
  args.push("--raw");
  return args;
}

function buildIssueCreateArgs(payload) {
  const args = withProjectPrefix(payload, ["issue", "create"]);
  args.push("--type", requiredString(payload.issueType, "issueType"));
  args.push("--summary", requiredString(payload.summary, "summary"));
  appendIssueMutationFlags(args, payload, {
    allowReporter: true,
    allowParent: true,
    allowOriginalEstimate: true,
  });
  args.push("--raw", "--no-input");
  return args;
}

function buildIssueEditArgs(payload) {
  const args = withProjectPrefix(payload, ["issue", "edit", requiredString(payload.issueKey, "issueKey")]);
  ensureHasOneOf(
    payload,
    [
      "summary",
      "body",
      "parent",
      "priority",
      "assignee",
      "labels",
      "components",
      "fixVersions",
      "affectsVersions",
      "customFields",
      "skipNotify",
    ],
    "issue.edit",
  );
  appendIssueMutationFlags(args, payload, {
    allowParent: true,
    allowSkipNotify: true,
  });
  args.push("--no-input");
  return args;
}

function buildIssueCloneArgs(payload) {
  const args = withProjectPrefix(payload, ["issue", "clone", requiredString(payload.issueKey, "issueKey")]);
  appendOptionalFlag(args, "--parent", payload.parent);
  appendOptionalFlag(args, "--summary", payload.summary);
  appendOptionalFlag(args, "--priority", payload.priority);
  appendOptionalFlag(args, "--assignee", payload.assignee);
  appendRepeatedFlag(args, "--label", payload.labels);
  appendRepeatedFlag(args, "--component", payload.components);
  for (const replacement of replacementArray(payload.replacements)) {
    args.push("--replace", `${replacement.find}:${replacement.replace}`);
  }
  return args;
}

function buildIssueAssignArgs(payload) {
  return withProjectPrefix(
    payload,
    ["issue", "assign", requiredString(payload.issueKey, "issueKey"), requiredString(payload.assignee, "assignee")],
  );
}

function buildIssueMoveArgs(payload) {
  const args = withProjectPrefix(
    payload,
    ["issue", "move", requiredString(payload.issueKey, "issueKey"), requiredString(payload.state, "state")],
  );
  appendOptionalFlag(args, "--comment", payload.comment);
  appendOptionalFlag(args, "--assignee", payload.assignee);
  appendOptionalFlag(args, "--resolution", payload.resolution);
  return args;
}

function buildIssueCommentAddArgs(payload) {
  const args = withProjectPrefix(
    payload,
    ["issue", "comment", "add", requiredString(payload.issueKey, "issueKey"), requiredString(payload.body, "body")],
  );
  if (payload.internal === true) {
    args.push("--internal");
  }
  args.push("--no-input");
  return args;
}

function buildIssueLinkArgs(payload) {
  return withProjectPrefix(
    payload,
    [
      "issue",
      "link",
      requiredString(payload.inwardIssueKey, "inwardIssueKey"),
      requiredString(payload.outwardIssueKey, "outwardIssueKey"),
      requiredString(payload.linkType, "linkType"),
    ],
  );
}

function buildIssueRemoteLinkArgs(payload) {
  return withProjectPrefix(
    payload,
    [
      "issue",
      "link",
      "remote",
      requiredString(payload.issueKey, "issueKey"),
      requiredString(payload.url, "url"),
      requiredString(payload.title, "title"),
    ],
  );
}

function buildIssueUnlinkArgs(payload) {
  return withProjectPrefix(
    payload,
    [
      "issue",
      "unlink",
      requiredString(payload.inwardIssueKey, "inwardIssueKey"),
      requiredString(payload.outwardIssueKey, "outwardIssueKey"),
    ],
  );
}

function buildIssueWatchArgs(payload) {
  return withProjectPrefix(
    payload,
    ["issue", "watch", requiredString(payload.issueKey, "issueKey"), requiredString(payload.watcher, "watcher")],
  );
}

function buildIssueWorklogAddArgs(payload) {
  const args = withProjectPrefix(
    payload,
    [
      "issue",
      "worklog",
      "add",
      requiredString(payload.issueKey, "issueKey"),
      requiredString(payload.timeSpent, "timeSpent"),
    ],
  );
  appendOptionalFlag(args, "--started", payload.started);
  appendOptionalFlag(args, "--timezone", payload.timezone);
  appendOptionalFlag(args, "--comment", payload.comment);
  appendOptionalFlag(args, "--new-estimate", payload.newEstimate);
  args.push("--no-input");
  return args;
}

function buildSprintAddArgs(payload) {
  const issueKeys = stringArray(payload.issueKeys);
  if (issueKeys.length === 0) {
    throw new Error("issueKeys must include at least one Jira issue key for sprint.add.");
  }
  return withProjectPrefix(
    payload,
    ["sprint", "add", requiredString(payload.sprintId, "sprintId"), ...issueKeys],
  );
}

function buildSprintCloseArgs(payload) {
  return withProjectPrefix(payload, ["sprint", "close", requiredString(payload.sprintId, "sprintId")]);
}

function withProjectPrefix(payload, baseArgs) {
  const args = [];
  if (nonEmptyString(payload.project)) {
    args.push("--project", payload.project.trim());
  }
  args.push(...baseArgs);
  return args;
}

function appendIssueListFlags(args, payload, options = {}) {
  appendOptionalFlag(args, "--jql", normalizeIssueListJql(payload.jql));
  appendOptionalFlag(args, "--type", payload.type);
  appendRepeatedFlag(args, "--status", payload.status);
  appendOptionalFlag(args, "--priority", payload.priority);
  appendOptionalFlag(args, "--reporter", payload.reporter);
  appendOptionalFlag(args, "--assignee", payload.assignee);
  appendOptionalFlag(args, "--component", payload.component);
  appendRepeatedFlag(args, "--label", payload.labels);
  appendOptionalFlag(args, "--parent", payload.parent);
  if (payload.history === true) {
    args.push("--history");
  }
  if (payload.watching === true) {
    args.push("--watching");
  }
  appendOptionalFlag(args, "--created", payload.created);
  appendOptionalFlag(args, "--updated", payload.updated);
  appendOptionalFlag(args, "--created-after", payload.createdAfter);
  appendOptionalFlag(args, "--updated-after", payload.updatedAfter);
  appendOptionalFlag(args, "--created-before", payload.createdBefore);
  appendOptionalFlag(args, "--updated-before", payload.updatedBefore);
  appendOptionalFlag(args, "--order-by", payload.orderBy);
  if (payload.reverse === true) {
    args.push("--reverse");
  }
  const comments = integerValue(payload.comments, "comments");
  if (comments !== undefined) {
    if (options.detail === "compact") {
      throw new Error("comments is only supported for Jira list reads with `detail: \"raw\"`.");
    }
    args.push("--comments", String(comments));
  }
}

function appendBoundedPagination(args, payload) {
  args.push("--paginate", `0:${resolveListLimit(payload)}`);
}

function appendCompactTableFlags(args, columns) {
  args.push(
    "--plain",
    "--no-headers",
    "--no-truncate",
    "--delimiter",
    COMPACT_DELIMITER,
    "--columns",
    columns.join(","),
  );
}

function appendIssueMutationFlags(args, payload, options = {}) {
  appendOptionalFlag(args, "--body", payload.body);
  appendOptionalFlag(args, "--parent", options.allowParent ? payload.parent : undefined);
  appendOptionalFlag(args, "--priority", payload.priority);
  appendOptionalFlag(args, "--reporter", options.allowReporter ? payload.reporter : undefined);
  appendOptionalFlag(args, "--assignee", payload.assignee);
  appendRepeatedFlag(args, "--label", payload.labels);
  appendRepeatedFlag(args, "--component", payload.components);
  appendRepeatedFlag(args, "--fix-version", payload.fixVersions);
  appendRepeatedFlag(args, "--affects-version", payload.affectsVersions);
  appendOptionalFlag(args, "--original-estimate", options.allowOriginalEstimate ? payload.originalEstimate : undefined);
  appendCustomFields(args, payload.customFields);
  if (options.allowSkipNotify && payload.skipNotify === true) {
    args.push("--skip-notify");
  }
}

function appendOptionalFlag(args, flag, value) {
  const normalized = nonEmptyString(value);
  if (!normalized) {
    return;
  }
  args.push(flag, normalized);
}

function appendRepeatedFlag(args, flag, values) {
  for (const value of stringArray(values)) {
    args.push(flag, value);
  }
}

function appendCustomFields(args, customFieldsInput) {
  const customFields = objectRecord(customFieldsInput);
  for (const [key, value] of Object.entries(customFields)) {
    args.push("--custom", `${key}=${stringifyScalar(value)}`);
  }
}

async function finalizeIssueMutation(input) {
  const refreshed = await tryReadIssue({
    issueKey: input.issueKey,
    payload: input.payload,
    jiraExecutable: input.jiraExecutable,
    env: input.env,
    runCommand: input.runCommand,
  });
  return envelope(input.operation, input.summary, {
    data: refreshed ?? textData(input.fallbackText),
    refs: input.refs ?? {
      issueKey: input.issueKey,
      ...projectRef(input.payload),
    },
  });
}

async function tryReadIssue(input) {
  const issueKey = nonEmptyString(input.issueKey);
  if (!issueKey) {
    return undefined;
  }
  try {
    const viewResult = await executeJira({
      jiraExecutable: input.jiraExecutable,
      args: buildIssueViewArgs({
        project: input.payload.project,
        issueKey,
      }),
      env: input.env,
      runCommand: input.runCommand,
      operation: "issue.view",
    });
    return parseJsonOutput("issue.view", viewResult.stdout);
  } catch {
    return undefined;
  }
}

async function executeJira(input) {
  const result = await input.runCommand({
    executable: input.jiraExecutable,
    args: input.args,
    env: input.env,
  });
  if (result.exitCode !== 0) {
    const message = nonEmptyString(result.stderr) || nonEmptyString(result.stdout)
      || `jira ${input.operation} failed with exit code ${result.exitCode}.`;
    throw new Error(message);
  }
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function envelope(operation, summary, extra = {}) {
  return {
    ok: true,
    operation,
    summary,
    ...(extra.data !== undefined ? { data: extra.data } : {}),
    ...(extra.refs && Object.keys(extra.refs).length > 0 ? { refs: extra.refs } : {}),
  };
}

function parseJsonOutput(operation, stdout) {
  const trimmed = typeof stdout === "string" ? stdout.trim() : "";
  if (!trimmed) {
    return {};
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    throw new Error(`Jira operation ${operation} returned invalid JSON output.`);
  }
}

function parseCompactIssueRows(stdout) {
  return parseCompactTableRows(stdout, ISSUE_COMPACT_COLUMNS);
}

function parseCompactSprintRows(stdout) {
  return parseCompactTableRows(stdout, SPRINT_COMPACT_COLUMNS);
}

function parseCompactTableRows(stdout, columns) {
  const lines = compactOutputLines(stdout);
  if (lines.length === 0) {
    return [];
  }
  return lines.map((line) => {
    const values = line.split(COMPACT_DELIMITER);
    if (values.length !== columns.length) {
      throw new Error(
        `Jira compact output column mismatch. Expected ${columns.length} values but received ${values.length}.`,
      );
    }
    const row = {};
    for (let index = 0; index < columns.length; index += 1) {
      row[columns[index]] = normalizeCompactValue(values[index]);
    }
    return row;
  });
}

function compactOutputLines(stdout) {
  const normalized = typeof stdout === "string" ? stdout : "";
  const lines = normalized
    .split("\n")
    .map((line) => stripAnsi(line).trim())
    .filter(Boolean);
  if (lines.length === 1 && /^✗\s+No result found\b/i.test(lines[0])) {
    return [];
  }
  return lines;
}

function textData(stdout) {
  const text = typeof stdout === "string" ? stdout.trim() : "";
  return {
    text,
    lines: text ? text.split("\n").map((line) => line.trim()).filter(Boolean) : [],
  };
}

function projectRef(payload) {
  return nonEmptyString(payload.project) ? { project: payload.project.trim() } : {};
}

function issueListRefs(payload, data) {
  const refs = {
    ...projectRef(payload),
  };
  const issueKeys = collectIssueKeys(data);
  if (issueKeys.length > 0) {
    refs.issueKeys = issueKeys;
  }
  return refs;
}

function epicListRefs(payload, data) {
  const refs = issueListRefs(payload, data);
  if (nonEmptyString(payload.epicKey)) {
    refs.epicKey = payload.epicKey.trim();
  }
  return refs;
}

function sprintListRefs(payload, data) {
  const refs = issueListRefs(payload, data);
  if (nonEmptyString(payload.sprintId)) {
    refs.sprintId = payload.sprintId.trim();
  }
  if (payload.current === true) {
    refs.selector = "current";
  } else if (payload.previous === true) {
    refs.selector = "previous";
  } else if (payload.next === true) {
    refs.selector = "next";
  }
  return refs;
}

function collectIssueKeys(data) {
  const keys = [];
  if (!data || typeof data !== "object") {
    return keys;
  }
  if (Array.isArray(data)) {
    for (const entry of data) {
      const key = extractIssueKey(entry);
      if (key) {
        keys.push(key);
      }
    }
    return uniq(keys);
  }
  const directKey = extractIssueKey(data);
  if (directKey) {
    keys.push(directKey);
  }
  const nestedIssues = Array.isArray(data.issues) ? data.issues : [];
  for (const issue of nestedIssues) {
    const key = extractIssueKey(issue);
    if (key) {
      keys.push(key);
    }
  }
  return uniq(keys);
}

function extractIssueKey(value) {
  if (!value) {
    return undefined;
  }
  if (typeof value === "string") {
    const match = value.match(ISSUE_KEY_PATTERN);
    return match?.[0];
  }
  if (typeof value === "object") {
    if (typeof value.key === "string" && value.key.match(ISSUE_KEY_PATTERN)) {
      ISSUE_KEY_PATTERN.lastIndex = 0;
      return value.key;
    }
    if (typeof value.issueKey === "string" && value.issueKey.match(ISSUE_KEY_PATTERN)) {
      ISSUE_KEY_PATTERN.lastIndex = 0;
      return value.issueKey;
    }
  }
  ISSUE_KEY_PATTERN.lastIndex = 0;
  return undefined;
}

function validateExclusiveSelectors(payload, selectors, operation) {
  const active = selectors.filter((selector) => {
    const value = payload[selector];
    if (typeof value === "boolean") {
      return value === true;
    }
    return nonEmptyString(value);
  });
  if (active.length > 1) {
    throw new Error(`${operation} accepts only one of ${selectors.join(", ")} at a time.`);
  }
}

function normalizeListDetail(value) {
  const normalized = nonEmptyString(value) ?? "compact";
  if (normalized === "compact" || normalized === "raw") {
    return normalized;
  }
  throw new Error("detail must be either `compact` or `raw`.");
}

function normalizeIssueListJql(value) {
  const normalized = nonEmptyString(value);
  if (!normalized) {
    return undefined;
  }
  if (/\border\s+by\b/i.test(normalized)) {
    throw new Error("JQL `ORDER BY` is rejected for Jira list reads. Use `orderBy` and `reverse` instead.");
  }
  return normalized;
}

function resolveListLimit(payload) {
  const explicitLimit = integerValue(payload.limit, "limit");
  if (explicitLimit !== undefined && explicitLimit > MAX_JIRA_LIST_LIMIT) {
    throw new Error(`limit must be less than or equal to ${MAX_JIRA_LIST_LIMIT}.`);
  }

  const legacyPaginate = nonEmptyString(payload.paginate);
  if (!legacyPaginate) {
    return explicitLimit ?? DEFAULT_JIRA_LIST_LIMIT;
  }

  const match = legacyPaginate.match(/^0:(\d+)$/);
  if (!match) {
    throw new Error("jira-cli 1.7.x offset pagination is unreliable. Use `limit` or zero-offset `paginate` only.");
  }
  const parsedLimit = Number.parseInt(match[1], 10);
  if (!Number.isInteger(parsedLimit) || parsedLimit <= 0 || parsedLimit > MAX_JIRA_LIST_LIMIT) {
    throw new Error(`paginate must use a limit between 1 and ${MAX_JIRA_LIST_LIMIT}.`);
  }
  if (explicitLimit !== undefined && explicitLimit !== parsedLimit) {
    throw new Error("limit and paginate must agree when both are provided.");
  }
  return parsedLimit;
}

function isSprintIssueSelection(payload) {
  return nonEmptyString(payload.sprintId) !== undefined
    || payload.current === true
    || payload.previous === true
    || payload.next === true;
}

function ensureHasOneOf(payload, keys, operation) {
  const found = keys.some((key) => {
    const value = payload[key];
    if (typeof value === "boolean") {
      return value === true;
    }
    if (Array.isArray(value)) {
      return value.length > 0;
    }
    if (value && typeof value === "object") {
      return Object.keys(value).length > 0;
    }
    return nonEmptyString(value) !== undefined;
  });
  if (!found) {
    throw new Error(`${operation} requires at least one editable field in addition to the issue key.`);
  }
}

function requiredString(value, field) {
  const normalized = nonEmptyString(value);
  if (!normalized) {
    throw new Error(`${field} is required.`);
  }
  return normalized;
}

function integerValue(value, field) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative integer.`);
  }
  return value;
}

function normalizeCompactValue(value) {
  const normalized = stripAnsi(String(value ?? "")).trim();
  return normalized.length > 0 ? normalized : null;
}

function objectRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value;
}

function replacementArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`replacements[${index}] must be an object.`);
    }
    return {
      find: requiredString(entry.find, `replacements[${index}].find`),
      replace: requiredString(entry.replace, `replacements[${index}].replace`),
    };
  });
}

function stringArray(value) {
  if (value === undefined || value === null) {
    return [];
  }
  if (Array.isArray(value)) {
    return value
      .map((entry, index) => requiredString(entry, `array[${index}]`))
      .filter(Boolean);
  }
  return [requiredString(value, "value")];
}

function stringifyScalar(value) {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

function parsePayloadArgument(rawValue) {
  const raw = typeof rawValue === "string" ? rawValue.trim() : "";
  if (!raw) {
    return {};
  }
  try {
    return normalizePayloadRecord(JSON.parse(raw));
  } catch {
    throw new Error("The Jira wrapper payload must be valid JSON.");
  }
}

function normalizePayloadRecord(value) {
  if (value === undefined || value === null) {
    return {};
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("The Jira wrapper payload must be a JSON object.");
  }
  return value;
}

function normalizeEnv(value) {
  return { ...(value ?? {}) };
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function stripAnsi(value) {
  return value.replace(ANSI_ESCAPE_PATTERN, "");
}

function splitPathEntries(pathValue) {
  return typeof pathValue === "string" ? pathValue.split(delimiter).filter(Boolean) : [];
}

function expandHome(value, home) {
  if (!value.startsWith("~/")) {
    return value;
  }
  const homeDir = typeof home === "string" && home.length > 0 ? home : process.env.HOME ?? "";
  return join(homeDir, value.slice(2));
}

function isExecutable(path) {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function assertExecutable(path, label) {
  if (!isExecutable(path)) {
    throw new Error(`${label} does not point to an executable file: ${path}`);
  }
}

function uniq(values) {
  return Array.from(new Set(values));
}

export async function runSpacesJiraCli(argvInput = process.argv.slice(2), input = {}) {
  const parsed = parseWrapperCliArgs(argvInput);
  if (parsed.help) {
    return {
      kind: "help",
      output: buildHelpText(),
    };
  }
  if (parsed.version) {
    return {
      kind: "version",
      output: `spaces-jira ${SPACES_JIRA_WRAPPER_VERSION}`,
    };
  }

  const result = await runJiraOperation(
    {
      operation: parsed.operation,
      payload: parsed.payload,
      env: input.env ?? process.env,
    },
    {
      runCommand: input.runCommand,
    },
  );
  return {
    kind: "result",
    output: JSON.stringify(result),
    result,
  };
}

function buildHelpText() {
  const toolRows = JIRA_TOOL_DEFINITIONS
    .map((tool) => `  - ${tool.operation} -> ${tool.id}`)
    .join("\n");
  return [
    "Spaces Jira wrapper",
    "",
    "Usage:",
    "  spaces-jira --op <operation> --payload <json>",
    "  spaces-jira --version",
    "",
    "Operations:",
    toolRows,
    "",
    "The wrapper reuses the host jira-cli configuration and emits JSON with the shape:",
    "  { ok, operation, summary, data?, refs? }",
  ].join("\n");
}

async function spawnCommand(input) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(input.executable, input.args, {
      env: input.env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      rejectPromise(error);
    });
    child.on("close", (code) => {
      resolvePromise({
        exitCode: typeof code === "number" ? code : 1,
        stdout,
        stderr,
      });
    });
  });
}

const IS_MAIN_MODULE = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (IS_MAIN_MODULE) {
  runSpacesJiraCli()
    .then((response) => {
      if (response.output) {
        process.stdout.write(`${response.output}\n`);
      }
    })
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`${message}\n`);
      process.exitCode = 1;
    });
}
