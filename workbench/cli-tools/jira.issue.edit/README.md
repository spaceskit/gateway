# Jira Issue Edit

## Purpose
Edit an existing Jira issue and return the refreshed issue payload.

## Wrapper Operation
- Tool id: `jira.issue.edit`
- Wrapper operation: `issue.edit`
- Jira CLI mapping: `jira issue edit ISSUE-KEY --no-input`

## Host Jira Configuration
- Install `jira-cli` on the external gateway host and verify it works outside Spaces.
- Configure the host once with `jira init`.
- Provide credentials with `JIRA_API_TOKEN` and, when needed, `JIRA_AUTH_TYPE=bearer`.
- If the host should use a non-default Jira profile, set `JIRA_CONFIG_FILE` before starting the gateway.

## Payload
- `project` (optional): Optional Jira project key or id override for this call.
- `issueKey` (required): Jira issue key, for example `OPS-123`.
- `summary` (optional): Optional updated summary.
- `body` (optional): Optional updated description.
- `parent` (optional): Optional parent issue key.
- `priority` (optional): Optional priority.
- `assignee` (optional): Optional assignee email or display name.
- `labels` (optional): Optional labels to append or remove. Prefix a label with `-` to remove it.
- `components` (optional): Optional components to replace or remove. Prefix with `-` to remove one.
- `fixVersions` (optional): Optional fixVersion updates.
- `affectsVersions` (optional): Optional affectsVersion updates.
- `customFields` (optional): Optional Jira custom fields keyed by field handle.
- `skipNotify` (optional): Whether to skip watcher notifications.

## Example Payloads
```json
[
  {
    "payload": {
      "issueKey": "OPS-123",
      "summary": "Refined issue summary"
    }
  }
]
```

## Output Contract
- The wrapper always emits JSON.
- Success shape: `{ ok, operation, summary, data?, refs? }`.
- Commands with Jira raw output return normalized raw JSON in `data`.
- Issue mutations do a follow-up `issue view --raw` read when the target issue key is known.

## Failure Modes
- If the host Jira config is missing or invalid, the wrapper returns a non-zero error.
- If Jira returns invalid JSON for a raw command, the wrapper rejects the call.
- Commands without raw output still return the stable wrapper JSON envelope.

## Approval Guidance
- Keep explicit human approval enabled for every Jira tool.
- Treat `jira.sprint.close` as destructive and approve it with extra care.

