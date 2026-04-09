# Jira Issue List

## Purpose
Search Jira issues with filters or JQL, returning compact summary rows by default and raw Jira JSON optionally.

## Wrapper Operation
- Tool id: `jira.issue.list`
- Wrapper operation: `issue.list`
- Jira CLI mapping: `jira issue list`

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

## Example Payloads
```json
[
  {
    "payload": {
      "project": "OPS",
      "assignee": "alice@example.com",
      "status": [
        "In Progress"
      ],
      "limit": 20
    }
  },
  {
    "payload": {
      "project": "OPS",
      "jql": "summary ~ \"connector\"",
      "orderBy": "updated",
      "reverse": true,
      "limit": 10,
      "detail": "raw"
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

