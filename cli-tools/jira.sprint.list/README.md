# Jira Sprint List

## Purpose
List Jira sprints, or list issues in a sprint, with compact summary rows by default and raw Jira JSON optionally.

## Wrapper Operation
- Tool id: `jira.sprint.list`
- Wrapper operation: `sprint.list`
- Jira CLI mapping: `jira sprint list`

## Host Jira Configuration
- Install `jira-cli` on the external gateway host and verify it works outside Spaces.
- Configure the host once with `jira init`.
- Provide credentials with `JIRA_API_TOKEN` and, when needed, `JIRA_AUTH_TYPE=bearer`.
- If the host should use a non-default Jira profile, set `JIRA_CONFIG_FILE` before starting the gateway.

## Payload
- `project` (optional): Optional Jira project key or id override for this call.
- `query` (optional): Optional free-text search query.
- `jql` (optional): Optional raw JQL query.
- `type` (optional): Optional Jira issue type filter.
- `status` (optional): Optional issue status filters.
- `priority` (optional): Optional issue priority filter.
- `reporter` (optional): Optional reporter email or display name.
- `assignee` (optional): Optional assignee email or display name.
- `component` (optional): Optional component filter.
- `labels` (optional): Optional issue labels.
- `parent` (optional): Optional parent issue key.
- `history` (optional): Whether to limit results to recently accessed issues.
- `watching` (optional): Whether to limit results to watched issues.
- `created` (optional): Optional created date filter, for example `today`, `-7d`, or `2026-03-01`.
- `updated` (optional): Optional updated date filter.
- `createdAfter` (optional): Optional lower bound for created date.
- `updatedAfter` (optional): Optional lower bound for updated date.
- `createdBefore` (optional): Optional upper bound for created date.
- `updatedBefore` (optional): Optional upper bound for updated date.
- `limit` (optional): Maximum number of results to return. Defaults to 20 and must be between 1 and 100.
- `detail` (optional): Result detail level. `compact` returns summary rows only and is the default; `raw` returns upstream Jira JSON for narrow queries.
- `orderBy` (optional): Optional field used to order results.
- `reverse` (optional): Whether to reverse the default order.
- `paginate` (optional): Legacy zero-offset pagination string such as `0:50`. Offsets other than zero are rejected because `jira-cli` 1.7.x returns duplicate pages.
- `comments` (optional): Optional number of recent comments to include for `detail: "raw"` reads.
- `sprintId` (optional): Jira sprint id.
- `current` (optional): Whether to list issues in the current sprint.
- `previous` (optional): Whether to list issues in the previous sprint.
- `next` (optional): Whether to list issues in the next sprint.
- `state` (optional): Optional sprint states. Valid values are `future`, `active`, and `closed`.
- `showAllIssues` (optional): Whether to show sprint issues from all projects.

## Example Payloads
```json
[
  {
    "payload": {
      "project": "OPS",
      "state": [
        "active",
        "closed"
      ],
      "limit": 20
    }
  },
  {
    "payload": {
      "project": "OPS",
      "current": true,
      "assignee": "alice@example.com",
      "limit": 20
    }
  }
]
```

## Output Contract
- The wrapper always emits JSON.
- Success shape: `{ ok, operation, summary, data?, refs? }`.
- `detail: "compact"` is the default for Jira list-style reads and returns bounded summary rows in `data`.
- `limit` defaults to 20 and must be between 1 and 100.
- `detail: "raw"` returns normalized upstream Jira JSON in `data` for narrow reads.
- Issue mutations do a follow-up `issue view --raw` read when the target issue key is known.

## Failure Modes
- If the host Jira config is missing or invalid, the wrapper returns a non-zero error.
- If Jira returns invalid JSON for a raw command, the wrapper rejects the call.
- Non-zero-offset `paginate` values are rejected because `jira-cli` 1.7.x can return duplicate pages.
- JQL values containing `ORDER BY` are rejected; use `orderBy` plus `reverse` instead.
- Commands without raw output still return the stable wrapper JSON envelope.

## Approval Guidance
- Keep explicit human approval enabled for every Jira tool.
- Treat `jira.sprint.close` as destructive and approve it with extra care.

