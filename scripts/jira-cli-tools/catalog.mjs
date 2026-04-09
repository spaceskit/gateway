import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const SPACES_JIRA_WRAPPER_VERSION = "0.1.0";
export const JIRA_CLI_TOOL_SCHEMA_VERSION = 1;
export const JIRA_CLI_DEFAULT_TIMEOUT_MS = 45_000;
export const JIRA_CLI_SMALL_OUTPUT_BYTES = 64 * 1024;
export const JIRA_CLI_MEDIUM_OUTPUT_BYTES = 128 * 1024;
export const JIRA_CLI_LARGE_OUTPUT_BYTES = 256 * 1024;

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const JIRA_BUNDLE_METADATA = {
  bundleId: "jira-cli",
  bundleDisplayName: "Jira CLI",
  bundleDescription: "Gateway-managed Jira CLI bundle for account discovery plus project, board, release, epic, sprint, and issue operations.",
};
const JIRA_GROUP_METADATA = {
  general: {
    toolGroupId: "general",
    toolGroupDisplayName: "General",
  },
  projects: {
    toolGroupId: "projects",
    toolGroupDisplayName: "Projects",
  },
  boards: {
    toolGroupId: "boards",
    toolGroupDisplayName: "Boards",
  },
  releases: {
    toolGroupId: "releases",
    toolGroupDisplayName: "Releases",
  },
  epics: {
    toolGroupId: "epics",
    toolGroupDisplayName: "Epics",
  },
  sprints: {
    toolGroupId: "sprints",
    toolGroupDisplayName: "Sprints",
  },
  issues: {
    toolGroupId: "issues",
    toolGroupDisplayName: "Issues",
  },
};

const PROJECT_PROPERTY = stringProperty("Optional Jira project key or id override for this call.");
const QUERY_PROPERTY = stringProperty("Optional free-text search query.");
const JQL_PROPERTY = stringProperty("Optional raw JQL query.");
const TYPE_PROPERTY = stringProperty("Optional Jira issue type filter.");
const STATUS_ARRAY_PROPERTY = stringArrayProperty("Optional issue status filters.");
const PRIORITY_PROPERTY = stringProperty("Optional issue priority filter.");
const REPORTER_PROPERTY = stringProperty("Optional reporter email or display name.");
const ASSIGNEE_PROPERTY = stringProperty("Optional assignee email or display name.");
const COMPONENT_PROPERTY = stringProperty("Optional component filter.");
const LABELS_PROPERTY = stringArrayProperty("Optional issue labels.");
const PARENT_PROPERTY = stringProperty("Optional parent issue key.");
const HISTORY_PROPERTY = booleanProperty("Whether to limit results to recently accessed issues.");
const WATCHING_PROPERTY = booleanProperty("Whether to limit results to watched issues.");
const CREATED_PROPERTY = stringProperty("Optional created date filter, for example `today`, `-7d`, or `2026-03-01`.");
const UPDATED_PROPERTY = stringProperty("Optional updated date filter.");
const CREATED_AFTER_PROPERTY = stringProperty("Optional lower bound for created date.");
const UPDATED_AFTER_PROPERTY = stringProperty("Optional lower bound for updated date.");
const CREATED_BEFORE_PROPERTY = stringProperty("Optional upper bound for created date.");
const UPDATED_BEFORE_PROPERTY = stringProperty("Optional upper bound for updated date.");
const LIMIT_PROPERTY = integerProperty(
  "Maximum number of results to return. Defaults to 20 and must be between 1 and 100.",
  { minimum: 1, maximum: 100 },
);
const DETAIL_PROPERTY = {
  type: "string",
  description: "Result detail level. `compact` returns summary rows only and is the default; `raw` returns upstream Jira JSON for narrow queries.",
  enum: ["compact", "raw"],
};
const ORDER_BY_PROPERTY = stringProperty("Optional field used to order results.");
const REVERSE_PROPERTY = booleanProperty("Whether to reverse the default order.");
const PAGINATE_PROPERTY = stringProperty("Legacy zero-offset pagination string such as `0:50`. Offsets other than zero are rejected because `jira-cli` 1.7.x returns duplicate pages.");
const COMMENTS_PROPERTY = integerProperty("Optional number of recent comments to include for `detail: \"raw\"` reads.", { minimum: 0 });
const ISSUE_KEY_PROPERTY = stringProperty("Jira issue key, for example `OPS-123`.");
const EPIC_KEY_PROPERTY = stringProperty("Optional Jira epic key.");
const SPRINT_ID_PROPERTY = stringProperty("Jira sprint id.");
const STATE_PROPERTY = stringArrayProperty("Optional sprint states. Valid values are `future`, `active`, and `closed`.");

const COMMON_ISSUE_LIST_PROPERTIES = {
  project: PROJECT_PROPERTY,
  query: QUERY_PROPERTY,
  jql: JQL_PROPERTY,
  type: TYPE_PROPERTY,
  status: STATUS_ARRAY_PROPERTY,
  priority: PRIORITY_PROPERTY,
  reporter: REPORTER_PROPERTY,
  assignee: ASSIGNEE_PROPERTY,
  component: COMPONENT_PROPERTY,
  labels: LABELS_PROPERTY,
  parent: PARENT_PROPERTY,
  history: HISTORY_PROPERTY,
  watching: WATCHING_PROPERTY,
  created: CREATED_PROPERTY,
  updated: UPDATED_PROPERTY,
  createdAfter: CREATED_AFTER_PROPERTY,
  updatedAfter: UPDATED_AFTER_PROPERTY,
  createdBefore: CREATED_BEFORE_PROPERTY,
  updatedBefore: UPDATED_BEFORE_PROPERTY,
  limit: LIMIT_PROPERTY,
  detail: DETAIL_PROPERTY,
  orderBy: ORDER_BY_PROPERTY,
  reverse: REVERSE_PROPERTY,
  paginate: PAGINATE_PROPERTY,
  comments: COMMENTS_PROPERTY,
};

export const JIRA_TOOL_DEFINITIONS = [
  defineTool({
    id: "jira.me",
    operation: "me",
    displayName: "Jira Me",
    description: "Display the Jira identity configured on the external gateway host.",
    commandHint: "jira me",
    instructions: "Use this tool to confirm which Jira user the gateway is authenticated as before making mutations.",
    payloadSchema: emptyPayloadSchema(),
    examples: [
      example(
        "Show current Jira user",
        "Confirms the configured Jira identity.",
        {},
        jsonEnvelopeExample("me", "Fetched the configured Jira identity."),
      ),
    ],
    maxOutputBytes: JIRA_CLI_SMALL_OUTPUT_BYTES,
  }),
  defineTool({
    id: "jira.serverinfo",
    operation: "serverinfo",
    displayName: "Jira Server Info",
    description: "Show Jira instance information for the configured server.",
    commandHint: "jira serverinfo",
    instructions: "Use this tool to confirm the Jira instance before creating or updating issues.",
    payloadSchema: emptyPayloadSchema(),
    examples: [
      example(
        "Show Jira server information",
        "Confirms the Jira server that the host config targets.",
        {},
        jsonEnvelopeExample("serverinfo", "Fetched Jira server information."),
      ),
    ],
    maxOutputBytes: JIRA_CLI_SMALL_OUTPUT_BYTES,
  }),
  defineTool({
    id: "jira.project.list",
    operation: "project.list",
    displayName: "Jira Project List",
    description: "List Jira projects visible to the configured user.",
    commandHint: "jira project list",
    instructions: "Use this tool to discover accessible Jira projects before issue queries or creation. This discovery read is not query-bounded, so keep it targeted and operator-driven.",
    payloadSchema: emptyPayloadSchema(),
    examples: [
      example(
        "List Jira projects",
        "Shows the projects visible to the configured account.",
        {},
        jsonEnvelopeExample("project.list", "Listed Jira projects."),
      ),
    ],
    maxOutputBytes: JIRA_CLI_LARGE_OUTPUT_BYTES,
  }),
  defineTool({
    id: "jira.board.list",
    operation: "board.list",
    displayName: "Jira Board List",
    description: "List Jira boards in the selected project context.",
    commandHint: "jira board list",
    instructions: "Use this tool when you need board names or ids before sprint queries. This discovery read is not query-bounded, so keep it targeted and operator-driven.",
    payloadSchema: objectPayloadSchema({
      project: PROJECT_PROPERTY,
    }),
    examples: [
      example(
        "List boards for a project",
        "Shows the boards in the OPS project context.",
        { project: "OPS" },
        jsonEnvelopeExample("board.list", "Listed Jira boards."),
      ),
    ],
    maxOutputBytes: JIRA_CLI_LARGE_OUTPUT_BYTES,
  }),
  defineTool({
    id: "jira.release.list",
    operation: "release.list",
    displayName: "Jira Release List",
    description: "List Jira releases (project versions) in the selected project context.",
    commandHint: "jira release list",
    instructions: "Use this tool when you need release or version names before planning or updating work. This discovery read is not query-bounded, so keep it targeted and operator-driven.",
    payloadSchema: objectPayloadSchema({
      project: PROJECT_PROPERTY,
    }),
    examples: [
      example(
        "List releases for a project",
        "Shows release versions for the OPS project.",
        { project: "OPS" },
        jsonEnvelopeExample("release.list", "Listed Jira releases."),
      ),
    ],
    maxOutputBytes: JIRA_CLI_LARGE_OUTPUT_BYTES,
  }),
  defineTool({
    id: "jira.epic.list",
    operation: "epic.list",
    displayName: "Jira Epic List",
    description: "List Jira epics, or list issues inside one epic, with compact summary rows by default and raw Jira JSON optionally.",
    commandHint: "jira epic list",
    instructions: "Use this tool to inspect epics or the issues inside a specific epic. Keep the default compact mode for scanning and switch to `detail: \"raw\"` only for narrow reads.",
    payloadSchema: objectPayloadSchema({
      ...COMMON_ISSUE_LIST_PROPERTIES,
      epicKey: EPIC_KEY_PROPERTY,
    }),
    examples: [
      example(
        "List active epics",
        "Searches epics with status filters.",
        { project: "OPS", status: ["In Progress"], limit: 20 },
        jsonEnvelopeExample("epic.list", "Listed Jira epics."),
      ),
      example(
        "List issues in an epic",
        "Lists issues for a specific epic.",
        { project: "OPS", epicKey: "OPS-100", limit: 20 },
        jsonEnvelopeExample("epic.list", "Listed issues for Jira epic OPS-100."),
      ),
    ],
    maxOutputBytes: JIRA_CLI_LARGE_OUTPUT_BYTES,
  }),
  defineTool({
    id: "jira.sprint.list",
    operation: "sprint.list",
    displayName: "Jira Sprint List",
    description: "List Jira sprints, or list issues in a sprint, with compact summary rows by default and raw Jira JSON optionally.",
    commandHint: "jira sprint list",
    instructions: "Use this tool to inspect sprints or the issues inside a current, previous, next, or explicit sprint. Keep the default compact mode for scanning and switch to `detail: \"raw\"` only for narrow reads.",
    payloadSchema: objectPayloadSchema({
      ...COMMON_ISSUE_LIST_PROPERTIES,
      sprintId: SPRINT_ID_PROPERTY,
      current: booleanProperty("Whether to list issues in the current sprint."),
      previous: booleanProperty("Whether to list issues in the previous sprint."),
      next: booleanProperty("Whether to list issues in the next sprint."),
      state: STATE_PROPERTY,
      showAllIssues: booleanProperty("Whether to show sprint issues from all projects."),
    }),
    examples: [
      example(
        "List active and closed sprints",
        "Lists sprint records for the current board context.",
        { project: "OPS", state: ["active", "closed"], limit: 20 },
        jsonEnvelopeExample("sprint.list", "Listed Jira sprints."),
      ),
      example(
        "List issues in the current sprint",
        "Lists issue records for the current active sprint.",
        { project: "OPS", current: true, assignee: "alice@example.com", limit: 20 },
        jsonEnvelopeExample("sprint.list", "Listed issues for the current Jira sprint."),
      ),
    ],
    maxOutputBytes: JIRA_CLI_LARGE_OUTPUT_BYTES,
  }),
  defineTool({
    id: "jira.issue.list",
    operation: "issue.list",
    displayName: "Jira Issue List",
    description: "Search Jira issues with filters or JQL, returning compact summary rows by default and raw Jira JSON optionally.",
    commandHint: "jira issue list",
    instructions: "Use this tool for issue search. Prefer precise status, assignee, label, or JQL filters, keep the default compact mode for scanning, and switch to `detail: \"raw\"` only for narrow reads.",
    payloadSchema: objectPayloadSchema(COMMON_ISSUE_LIST_PROPERTIES),
    examples: [
      example(
        "List my in-progress issues",
        "Finds current work for one assignee.",
        { project: "OPS", assignee: "alice@example.com", status: ["In Progress"], limit: 20 },
        jsonEnvelopeExample("issue.list", "Listed Jira issues."),
      ),
      example(
        "Run a sorted Jira query",
        "Uses JQL plus wrapper sort fields for a targeted raw issue search.",
        { project: "OPS", jql: "summary ~ \"connector\"", orderBy: "updated", reverse: true, limit: 10, detail: "raw" },
        jsonEnvelopeExample("issue.list", "Listed Jira issues."),
      ),
    ],
    maxOutputBytes: JIRA_CLI_LARGE_OUTPUT_BYTES,
  }),
  defineTool({
    id: "jira.issue.view",
    operation: "issue.view",
    displayName: "Jira Issue View",
    description: "Fetch a single Jira issue by key and return raw structured output.",
    commandHint: "jira issue view ISSUE-KEY --raw",
    instructions: "Use this tool when you already know the Jira issue key and need the latest fields or comments.",
    payloadSchema: objectPayloadSchema(
      {
        project: PROJECT_PROPERTY,
        issueKey: ISSUE_KEY_PROPERTY,
        comments: COMMENTS_PROPERTY,
      },
      { required: ["issueKey"] },
    ),
    examples: [
      example(
        "View one issue",
        "Fetches a specific Jira issue by key.",
        { issueKey: "OPS-123" },
        jsonEnvelopeExample("issue.view", "Fetched Jira issue OPS-123."),
      ),
    ],
    maxOutputBytes: JIRA_CLI_MEDIUM_OUTPUT_BYTES,
  }),
  defineTool({
    id: "jira.issue.create",
    operation: "issue.create",
    displayName: "Jira Issue Create",
    description: "Create a Jira issue and return the refreshed issue payload when Jira exposes the new key.",
    commandHint: "jira issue create --raw --no-input",
    instructions: "Use this tool to create a Jira issue. Provide the minimal required fields and only the metadata you intend to set.",
    payloadSchema: objectPayloadSchema(
      {
        project: PROJECT_PROPERTY,
        issueType: stringProperty("Jira issue type, for example `Task` or `Bug`."),
        summary: stringProperty("Issue summary."),
        body: stringProperty("Issue description body."),
        parent: stringProperty("Optional parent or epic issue key."),
        priority: stringProperty("Optional priority."),
        reporter: REPORTER_PROPERTY,
        assignee: ASSIGNEE_PROPERTY,
        labels: LABELS_PROPERTY,
        components: stringArrayProperty("Optional component names."),
        fixVersions: stringArrayProperty("Optional fixVersion names."),
        affectsVersions: stringArrayProperty("Optional affectsVersion names."),
        originalEstimate: stringProperty("Optional original estimate, for example `4h`."),
        customFields: objectMapProperty("Optional Jira custom fields keyed by field handle."),
      },
      { required: ["issueType", "summary"] },
    ),
    examples: [
      example(
        "Create a task",
        "Creates a Jira task with summary and description.",
        {
          project: "OPS",
          issueType: "Task",
          summary: "Register the Jira CLI bundle",
          body: "Add the repo-shipped Jira bundle and smoke it on one external gateway.",
        },
        jsonEnvelopeExample("issue.create", "Created Jira issue OPS-456."),
      ),
    ],
    maxOutputBytes: JIRA_CLI_MEDIUM_OUTPUT_BYTES,
  }),
  defineTool({
    id: "jira.issue.edit",
    operation: "issue.edit",
    displayName: "Jira Issue Edit",
    description: "Edit an existing Jira issue and return the refreshed issue payload.",
    commandHint: "jira issue edit ISSUE-KEY --no-input",
    instructions: "Use this tool to update the fields of an existing Jira issue. Supply only the fields that should change.",
    payloadSchema: objectPayloadSchema(
      {
        project: PROJECT_PROPERTY,
        issueKey: ISSUE_KEY_PROPERTY,
        summary: stringProperty("Optional updated summary."),
        body: stringProperty("Optional updated description."),
        parent: stringProperty("Optional parent issue key."),
        priority: stringProperty("Optional priority."),
        assignee: ASSIGNEE_PROPERTY,
        labels: stringArrayProperty("Optional labels to append or remove. Prefix a label with `-` to remove it."),
        components: stringArrayProperty("Optional components to replace or remove. Prefix with `-` to remove one."),
        fixVersions: stringArrayProperty("Optional fixVersion updates."),
        affectsVersions: stringArrayProperty("Optional affectsVersion updates."),
        customFields: objectMapProperty("Optional Jira custom fields keyed by field handle."),
        skipNotify: booleanProperty("Whether to skip watcher notifications."),
      },
      { required: ["issueKey"] },
    ),
    examples: [
      example(
        "Update issue summary",
        "Edits the summary of an existing issue.",
        { issueKey: "OPS-123", summary: "Refined issue summary" },
        jsonEnvelopeExample("issue.edit", "Updated Jira issue OPS-123."),
      ),
    ],
    maxOutputBytes: JIRA_CLI_MEDIUM_OUTPUT_BYTES,
  }),
  defineTool({
    id: "jira.issue.clone",
    operation: "issue.clone",
    displayName: "Jira Issue Clone",
    description: "Clone a Jira issue and return the refreshed cloned issue payload when the new key can be derived.",
    commandHint: "jira issue clone ISSUE-KEY",
    instructions: "Use this tool to duplicate an existing issue, optionally overriding summary, assignee, or metadata.",
    payloadSchema: objectPayloadSchema(
      {
        project: PROJECT_PROPERTY,
        issueKey: ISSUE_KEY_PROPERTY,
        parent: stringProperty("Optional parent issue key for the clone."),
        summary: stringProperty("Optional summary override for the clone."),
        priority: stringProperty("Optional priority override."),
        assignee: ASSIGNEE_PROPERTY,
        labels: LABELS_PROPERTY,
        components: stringArrayProperty("Optional component names."),
        replacements: replacementArrayProperty(),
      },
      { required: ["issueKey"] },
    ),
    examples: [
      example(
        "Clone an issue for a new sprint",
        "Clones one issue and updates the summary text.",
        {
          issueKey: "OPS-123",
          summary: "OPS-123 follow-up",
          replacements: [{ find: "Sprint 1", replace: "Sprint 2" }],
        },
        jsonEnvelopeExample("issue.clone", "Cloned Jira issue OPS-123."),
      ),
    ],
    maxOutputBytes: JIRA_CLI_MEDIUM_OUTPUT_BYTES,
  }),
  defineTool({
    id: "jira.issue.assign",
    operation: "issue.assign",
    displayName: "Jira Issue Assign",
    description: "Assign a Jira issue and return the refreshed issue payload.",
    commandHint: "jira issue assign ISSUE-KEY ASSIGNEE",
    instructions: "Use this tool to change issue ownership when you know the exact assignee string Jira expects.",
    payloadSchema: objectPayloadSchema(
      {
        project: PROJECT_PROPERTY,
        issueKey: ISSUE_KEY_PROPERTY,
        assignee: stringProperty("Assignee email or exact display name."),
      },
      { required: ["issueKey", "assignee"] },
    ),
    examples: [
      example(
        "Assign an issue",
        "Assigns an issue to a specific person.",
        { issueKey: "OPS-123", assignee: "alice@example.com" },
        jsonEnvelopeExample("issue.assign", "Assigned Jira issue OPS-123."),
      ),
    ],
    maxOutputBytes: JIRA_CLI_MEDIUM_OUTPUT_BYTES,
  }),
  defineTool({
    id: "jira.issue.move",
    operation: "issue.move",
    displayName: "Jira Issue Move",
    description: "Transition a Jira issue to a new state and return the refreshed issue payload.",
    commandHint: "jira issue move ISSUE-KEY STATE",
    instructions: "Use this tool to transition an issue to a new workflow state, optionally with a comment, assignee, or resolution.",
    payloadSchema: objectPayloadSchema(
      {
        project: PROJECT_PROPERTY,
        issueKey: ISSUE_KEY_PROPERTY,
        state: stringProperty("Target workflow state, for example `In Progress` or `Done`."),
        comment: stringProperty("Optional transition comment."),
        assignee: ASSIGNEE_PROPERTY,
        resolution: stringProperty("Optional Jira resolution."),
      },
      { required: ["issueKey", "state"] },
    ),
    examples: [
      example(
        "Move an issue to In Progress",
        "Transitions the issue and adds a short note.",
        { issueKey: "OPS-123", state: "In Progress", comment: "Started implementation." },
        jsonEnvelopeExample("issue.move", "Moved Jira issue OPS-123 to In Progress."),
      ),
    ],
    maxOutputBytes: JIRA_CLI_MEDIUM_OUTPUT_BYTES,
  }),
  defineTool({
    id: "jira.issue.comment.add",
    operation: "issue.comment.add",
    displayName: "Jira Comment Add",
    description: "Add a Jira issue comment and return the refreshed issue payload.",
    commandHint: "jira issue comment add ISSUE-KEY COMMENT",
    instructions: "Use this tool to add a comment to an issue when the comment text is ready to send.",
    payloadSchema: objectPayloadSchema(
      {
        project: PROJECT_PROPERTY,
        issueKey: ISSUE_KEY_PROPERTY,
        body: stringProperty("Comment body."),
        internal: booleanProperty("Whether the comment should be internal."),
      },
      { required: ["issueKey", "body"] },
    ),
    examples: [
      example(
        "Add a progress comment",
        "Adds one comment to an issue.",
        { issueKey: "OPS-123", body: "The Jira connector wrapper is implemented and under test." },
        jsonEnvelopeExample("issue.comment.add", "Added a comment to Jira issue OPS-123."),
      ),
    ],
    maxOutputBytes: JIRA_CLI_MEDIUM_OUTPUT_BYTES,
  }),
  defineTool({
    id: "jira.issue.link",
    operation: "issue.link",
    displayName: "Jira Issue Link",
    description: "Link two Jira issues and return the refreshed source issue payload.",
    commandHint: "jira issue link INWARD_ISSUE_KEY OUTWARD_ISSUE_KEY ISSUE_LINK_TYPE",
    instructions: "Use this tool to create a standard Jira issue link such as Blocks or Relates.",
    payloadSchema: objectPayloadSchema(
      {
        project: PROJECT_PROPERTY,
        inwardIssueKey: stringProperty("Source issue key."),
        outwardIssueKey: stringProperty("Target issue key."),
        linkType: stringProperty("Jira issue link type, for example `Blocks`."),
      },
      { required: ["inwardIssueKey", "outwardIssueKey", "linkType"] },
    ),
    examples: [
      example(
        "Link two issues",
        "Adds a Blocks relationship between two issues.",
        { inwardIssueKey: "OPS-123", outwardIssueKey: "OPS-124", linkType: "Blocks" },
        jsonEnvelopeExample("issue.link", "Linked Jira issues OPS-123 and OPS-124."),
      ),
    ],
    maxOutputBytes: JIRA_CLI_MEDIUM_OUTPUT_BYTES,
  }),
  defineTool({
    id: "jira.issue.link.remote",
    operation: "issue.link.remote",
    displayName: "Jira Remote Link Add",
    description: "Attach a remote web link to a Jira issue and return the refreshed issue payload.",
    commandHint: "jira issue link remote ISSUE-KEY URL TITLE",
    instructions: "Use this tool to attach an external URL to a Jira issue.",
    payloadSchema: objectPayloadSchema(
      {
        project: PROJECT_PROPERTY,
        issueKey: ISSUE_KEY_PROPERTY,
        url: stringProperty("Remote link URL."),
        title: stringProperty("Remote link title."),
      },
      { required: ["issueKey", "url", "title"] },
    ),
    examples: [
      example(
        "Attach a design doc",
        "Adds a remote documentation link to the issue.",
        { issueKey: "OPS-123", url: "https://example.com/design", title: "Design doc" },
        jsonEnvelopeExample("issue.link.remote", "Added a remote link to Jira issue OPS-123."),
      ),
    ],
    maxOutputBytes: JIRA_CLI_MEDIUM_OUTPUT_BYTES,
  }),
  defineTool({
    id: "jira.issue.unlink",
    operation: "issue.unlink",
    displayName: "Jira Issue Unlink",
    description: "Remove the relationship between two Jira issues and return the refreshed source issue payload.",
    commandHint: "jira issue unlink INWARD_ISSUE_KEY OUTWARD_ISSUE_KEY",
    instructions: "Use this tool to remove an existing Jira issue link when the two keys are known.",
    payloadSchema: objectPayloadSchema(
      {
        project: PROJECT_PROPERTY,
        inwardIssueKey: stringProperty("Source issue key."),
        outwardIssueKey: stringProperty("Target issue key."),
      },
      { required: ["inwardIssueKey", "outwardIssueKey"] },
    ),
    examples: [
      example(
        "Remove a link",
        "Disconnects two previously linked issues.",
        { inwardIssueKey: "OPS-123", outwardIssueKey: "OPS-124" },
        jsonEnvelopeExample("issue.unlink", "Unlinked Jira issues OPS-123 and OPS-124."),
      ),
    ],
    maxOutputBytes: JIRA_CLI_MEDIUM_OUTPUT_BYTES,
  }),
  defineTool({
    id: "jira.issue.watch",
    operation: "issue.watch",
    displayName: "Jira Watcher Add",
    description: "Add a watcher to a Jira issue and return the refreshed issue payload.",
    commandHint: "jira issue watch ISSUE-KEY WATCHER",
    instructions: "Use this tool to add a watcher to an issue when you know the exact Jira user string.",
    payloadSchema: objectPayloadSchema(
      {
        project: PROJECT_PROPERTY,
        issueKey: ISSUE_KEY_PROPERTY,
        watcher: stringProperty("Watcher email or exact display name."),
      },
      { required: ["issueKey", "watcher"] },
    ),
    examples: [
      example(
        "Add a watcher",
        "Adds a watcher to an issue.",
        { issueKey: "OPS-123", watcher: "alice@example.com" },
        jsonEnvelopeExample("issue.watch", "Added a watcher to Jira issue OPS-123."),
      ),
    ],
    maxOutputBytes: JIRA_CLI_MEDIUM_OUTPUT_BYTES,
  }),
  defineTool({
    id: "jira.issue.worklog.add",
    operation: "issue.worklog.add",
    displayName: "Jira Worklog Add",
    description: "Add worklog time to a Jira issue and return the refreshed issue payload.",
    commandHint: "jira issue worklog add ISSUE-KEY TIME_SPENT --no-input",
    instructions: "Use this tool to log work against an issue with an optional comment or explicit start time.",
    payloadSchema: objectPayloadSchema(
      {
        project: PROJECT_PROPERTY,
        issueKey: ISSUE_KEY_PROPERTY,
        timeSpent: stringProperty("Time to log, for example `2h 30m`."),
        started: stringProperty("Optional start time. Supports Jira datetime or `YYYY-MM-DD HH:MM:SS`."),
        timezone: stringProperty("Optional IANA timezone for the `started` value."),
        comment: stringProperty("Optional worklog comment."),
        newEstimate: stringProperty("Optional new remaining estimate."),
      },
      { required: ["issueKey", "timeSpent"] },
    ),
    examples: [
      example(
        "Log work",
        "Adds two hours of work to an issue.",
        { issueKey: "OPS-123", timeSpent: "2h", comment: "Implemented the Jira wrapper." },
        jsonEnvelopeExample("issue.worklog.add", "Added worklog to Jira issue OPS-123."),
      ),
    ],
    maxOutputBytes: JIRA_CLI_MEDIUM_OUTPUT_BYTES,
  }),
  defineTool({
    id: "jira.sprint.add",
    operation: "sprint.add",
    displayName: "Jira Sprint Add",
    description: "Add one or more Jira issues to a sprint.",
    commandHint: "jira sprint add SPRINT_ID ISSUE-1 [...ISSUE-N]",
    instructions: "Use this tool to add up to 50 known issues to a sprint.",
    payloadSchema: objectPayloadSchema(
      {
        project: PROJECT_PROPERTY,
        sprintId: SPRINT_ID_PROPERTY,
        issueKeys: stringArrayProperty("Issue keys to add to the sprint.", { minItems: 1 }),
      },
      { required: ["sprintId", "issueKeys"] },
    ),
    examples: [
      example(
        "Add issues to a sprint",
        "Adds two issues to sprint 42.",
        { sprintId: "42", issueKeys: ["OPS-123", "OPS-124"] },
        jsonEnvelopeExample("sprint.add", "Added issues to Jira sprint 42."),
      ),
    ],
    maxOutputBytes: JIRA_CLI_SMALL_OUTPUT_BYTES,
  }),
  defineTool({
    id: "jira.sprint.close",
    operation: "sprint.close",
    displayName: "Jira Sprint Close",
    description: "Close a Jira sprint.",
    commandHint: "jira sprint close SPRINT_ID",
    instructions: "Use this tool only when you intend to close a sprint. This is the destructive Jira tool in the v1 bundle.",
    payloadSchema: objectPayloadSchema(
      {
        project: PROJECT_PROPERTY,
        sprintId: SPRINT_ID_PROPERTY,
      },
      { required: ["sprintId"] },
    ),
    examples: [
      example(
        "Close a sprint",
        "Closes sprint 42 after confirmation.",
        { sprintId: "42" },
        jsonEnvelopeExample("sprint.close", "Closed Jira sprint 42."),
      ),
    ],
    dangerLevel: "destructive",
    maxOutputBytes: JIRA_CLI_SMALL_OUTPUT_BYTES,
  }),
];

export function getJiraToolDefinitionByOperation(operation) {
  const normalized = typeof operation === "string" ? operation.trim() : "";
  return JIRA_TOOL_DEFINITIONS.find((tool) => tool.operation === normalized) ?? null;
}

export function resolveDefaultSpacesJiraWrapperPath() {
  return resolve(SCRIPT_DIR, "spaces-jira.mjs");
}

export function buildJiraCliManifest(tool, input = {}) {
  const wrapperPath = resolveRequiredAbsolutePath(input.wrapperPath ?? resolveDefaultSpacesJiraWrapperPath(), "wrapperPath");
  const fixedCwd = resolveRequiredAbsolutePath(input.fixedCwd ?? dirname(wrapperPath), "fixedCwd");
  const now = input.now ?? new Date().toISOString();
  const enabled = input.enabled ?? true;
  return {
    schemaVersion: JIRA_CLI_TOOL_SCHEMA_VERSION,
    id: tool.id,
    displayName: tool.displayName,
    description: tool.description,
    bundleId: tool.bundleId,
    bundleDisplayName: tool.bundleDisplayName,
    bundleDescription: tool.bundleDescription,
    toolGroupId: tool.toolGroupId,
    toolGroupDisplayName: tool.toolGroupDisplayName,
    executable: wrapperPath,
    resolvedExecutable: wrapperPath,
    argsTemplate: ["--op", tool.operation, "--payload", "{{payload}}"],
    inputSchema: wrapPayloadSchema(tool.payloadSchema),
    instructions: tool.instructions,
    examples: tool.examples,
    timeoutMs: tool.timeoutMs,
    maxOutputBytes: tool.maxOutputBytes,
    cwdMode: "fixed",
    fixedCwd,
    outputMode: "json",
    dangerLevel: tool.dangerLevel,
    enabled,
    createdAt: now,
    updatedAt: now,
  };
}

export function buildJiraCliToolReadme(tool) {
  const payloadProperties = tool.payloadSchema.properties ?? {};
  const required = new Set(tool.payloadSchema.required ?? []);
  const payloadLines = Object.entries(payloadProperties).map(([name, schema]) => {
    const description = typeof schema.description === "string" ? schema.description : "See the manifest schema.";
    const requirement = required.has(name) ? "required" : "optional";
    return `- \`${name}\` (${requirement}): ${description}`;
  });

  return [
    `# ${tool.displayName}`,
    "",
    "## Purpose",
    tool.description,
    "",
    "## Wrapper Operation",
    `- Tool id: \`${tool.id}\``,
    `- Wrapper operation: \`${tool.operation}\``,
    `- Jira CLI mapping: \`${tool.commandHint}\``,
    "",
    "## Host Jira Configuration",
    "- Install `jira-cli` on the external gateway host and verify it works outside Spaces.",
    "- Configure the host once with `jira init`.",
    "- Provide credentials with `JIRA_API_TOKEN` and, when needed, `JIRA_AUTH_TYPE=bearer`.",
    "- If the host should use a non-default Jira profile, set `JIRA_CONFIG_FILE` before starting the gateway.",
    "",
    "## Payload",
    ...(payloadLines.length > 0 ? payloadLines : ["- This tool does not require any payload fields."]),
    "",
    "## Example Payloads",
    "```json",
    JSON.stringify(tool.examples.map((exampleRecord) => exampleRecord.arguments), null, 2),
    "```",
    "",
    "## Output Contract",
    "- The wrapper always emits JSON.",
    "- Success shape: `{ ok, operation, summary, data?, refs? }`.",
    ...(isCompactJiraListOperation(tool.operation)
      ? [
        "- `detail: \"compact\"` is the default for Jira list-style reads and returns bounded summary rows in `data`.",
        "- `limit` defaults to 20 and must be between 1 and 100.",
        "- `detail: \"raw\"` returns normalized upstream Jira JSON in `data` for narrow reads.",
      ]
      : ["- Commands with Jira raw output return normalized raw JSON in `data`."]),
    ...(isUnboundedJiraDiscoveryListOperation(tool.operation)
      ? ["- This discovery read is intentionally not query-bounded; use it sparingly for setup and operator troubleshooting."]
      : []),
    "- Issue mutations do a follow-up `issue view --raw` read when the target issue key is known.",
    "",
    "## Failure Modes",
    "- If the host Jira config is missing or invalid, the wrapper returns a non-zero error.",
    "- If Jira returns invalid JSON for a raw command, the wrapper rejects the call.",
    ...(isCompactJiraListOperation(tool.operation)
      ? [
        "- Non-zero-offset `paginate` values are rejected because `jira-cli` 1.7.x can return duplicate pages.",
        "- JQL values containing `ORDER BY` are rejected; use `orderBy` plus `reverse` instead.",
      ]
      : []),
    "- Commands without raw output still return the stable wrapper JSON envelope.",
    "",
    "## Approval Guidance",
    "- Keep explicit human approval enabled for every Jira tool.",
    "- Treat `jira.sprint.close` as destructive and approve it with extra care.",
    "",
  ].join("\n");
}

function isCompactJiraListOperation(operation) {
  return operation === "issue.list" || operation === "epic.list" || operation === "sprint.list";
}

function isUnboundedJiraDiscoveryListOperation(operation) {
  return operation === "project.list" || operation === "board.list" || operation === "release.list";
}

function defineTool(input) {
  const groupMetadata = defaultJiraGroupMetadataForOperation(input.operation);
  return {
    id: input.id,
    operation: input.operation,
    displayName: input.displayName,
    description: input.description,
    bundleId: input.bundleId ?? JIRA_BUNDLE_METADATA.bundleId,
    bundleDisplayName: input.bundleDisplayName ?? JIRA_BUNDLE_METADATA.bundleDisplayName,
    bundleDescription: input.bundleDescription ?? JIRA_BUNDLE_METADATA.bundleDescription,
    toolGroupId: input.toolGroupId ?? groupMetadata?.toolGroupId,
    toolGroupDisplayName: input.toolGroupDisplayName ?? groupMetadata?.toolGroupDisplayName,
    commandHint: input.commandHint,
    instructions: input.instructions,
    payloadSchema: input.payloadSchema,
    examples: input.examples,
    dangerLevel: input.dangerLevel ?? "standard",
    timeoutMs: input.timeoutMs ?? JIRA_CLI_DEFAULT_TIMEOUT_MS,
    maxOutputBytes: input.maxOutputBytes ?? JIRA_CLI_MEDIUM_OUTPUT_BYTES,
  };
}

function defaultJiraGroupMetadataForOperation(operation) {
  const normalized = typeof operation === "string" ? operation.trim() : "";
  if (!normalized) {
    return undefined;
  }
  if (normalized === "me" || normalized === "serverinfo") {
    return JIRA_GROUP_METADATA.general;
  }
  if (normalized.startsWith("project.")) {
    return JIRA_GROUP_METADATA.projects;
  }
  if (normalized.startsWith("board.")) {
    return JIRA_GROUP_METADATA.boards;
  }
  if (normalized.startsWith("release.")) {
    return JIRA_GROUP_METADATA.releases;
  }
  if (normalized.startsWith("epic.")) {
    return JIRA_GROUP_METADATA.epics;
  }
  if (normalized.startsWith("sprint.")) {
    return JIRA_GROUP_METADATA.sprints;
  }
  if (normalized.startsWith("issue.")) {
    return JIRA_GROUP_METADATA.issues;
  }
  return undefined;
}

function example(name, description, payload, expectedOutput) {
  return {
    name,
    description,
    arguments: { payload },
    expectedOutput,
  };
}

function wrapPayloadSchema(payloadSchema) {
  return {
    type: "object",
    properties: {
      payload: payloadSchema,
    },
    additionalProperties: false,
  };
}

function emptyPayloadSchema() {
  return objectPayloadSchema({});
}

function objectPayloadSchema(properties, options = {}) {
  return {
    type: "object",
    properties,
    additionalProperties: false,
    ...(Array.isArray(options.required) && options.required.length > 0
      ? { required: options.required }
      : {}),
  };
}

function stringProperty(description, extra = {}) {
  return {
    type: "string",
    description,
    ...extra,
  };
}

function booleanProperty(description) {
  return {
    type: "boolean",
    description,
  };
}

function integerProperty(description, extra = {}) {
  return {
    type: "integer",
    description,
    ...extra,
  };
}

function stringArrayProperty(description, extra = {}) {
  return {
    type: "array",
    description,
    items: { type: "string" },
    ...extra,
  };
}

function objectMapProperty(description) {
  return {
    type: "object",
    description,
    additionalProperties: {
      anyOf: [
        { type: "string" },
        { type: "number" },
        { type: "boolean" },
      ],
    },
  };
}

function replacementArrayProperty() {
  return {
    type: "array",
    description: "Optional summary/body replacements for clone. Each entry maps `find` to `replace`.",
    items: {
      type: "object",
      properties: {
        find: stringProperty("Text to find."),
        replace: stringProperty("Replacement text."),
      },
      required: ["find", "replace"],
      additionalProperties: false,
    },
  };
}

function jsonEnvelopeExample(operation, summary) {
  return JSON.stringify(
    {
      ok: true,
      operation,
      summary,
    },
    null,
    2,
  );
}

function resolveRequiredAbsolutePath(value, field) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) {
    throw new Error(`${field} is required.`);
  }
  return resolve(normalized);
}
