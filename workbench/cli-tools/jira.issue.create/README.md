# Jira Issue Create

## Purpose
Create a Jira issue and return the refreshed issue payload when Jira exposes the new key.

## Wrapper Operation
- Tool id: `jira.issue.create`
- Wrapper operation: `issue.create`
- Jira CLI mapping: `jira issue create --raw --no-input`

## Host Jira Configuration
- Install `jira-cli` on the external gateway host and verify it works outside Spaces.
- Configure the host once with `jira init`.
- Provide credentials with `JIRA_API_TOKEN` and, when needed, `JIRA_AUTH_TYPE=bearer`.
- If the host should use a non-default Jira profile, set `JIRA_CONFIG_FILE` before starting the gateway.

## Payload
- `project` (optional): Optional Jira project key or id override for this call.
- `issueType` (required): Jira issue type, for example `Task` or `Bug`.
- `summary` (required): Issue summary.
- `body` (optional): Issue description body.
- `parent` (optional): Optional parent or epic issue key.
- `priority` (optional): Optional priority.
- `reporter` (optional): Optional reporter email or display name.
- `assignee` (optional): Optional assignee email or display name.
- `labels` (optional): Optional issue labels.
- `components` (optional): Optional component names.
- `fixVersions` (optional): Optional fixVersion names.
- `affectsVersions` (optional): Optional affectsVersion names.
- `originalEstimate` (optional): Optional original estimate, for example `4h`.
- `customFields` (optional): Optional Jira custom fields keyed by field handle.

## Example Payloads
```json
[
  {
    "payload": {
      "project": "OPS",
      "issueType": "Task",
      "summary": "Register the Jira CLI bundle",
      "body": "Add the repo-shipped Jira bundle and smoke it on one external gateway."
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

