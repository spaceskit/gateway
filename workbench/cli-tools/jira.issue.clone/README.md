# Jira Issue Clone

## Purpose
Clone a Jira issue and return the refreshed cloned issue payload when the new key can be derived.

## Wrapper Operation
- Tool id: `jira.issue.clone`
- Wrapper operation: `issue.clone`
- Jira CLI mapping: `jira issue clone ISSUE-KEY`

## Host Jira Configuration
- Install `jira-cli` on the external gateway host and verify it works outside Spaces.
- Configure the host once with `jira init`.
- Provide credentials with `JIRA_API_TOKEN` and, when needed, `JIRA_AUTH_TYPE=bearer`.
- If the host should use a non-default Jira profile, set `JIRA_CONFIG_FILE` before starting the gateway.

## Payload
- `project` (optional): Optional Jira project key or id override for this call.
- `issueKey` (required): Jira issue key, for example `OPS-123`.
- `parent` (optional): Optional parent issue key for the clone.
- `summary` (optional): Optional summary override for the clone.
- `priority` (optional): Optional priority override.
- `assignee` (optional): Optional assignee email or display name.
- `labels` (optional): Optional issue labels.
- `components` (optional): Optional component names.
- `replacements` (optional): Optional summary/body replacements for clone. Each entry maps `find` to `replace`.

## Example Payloads
```json
[
  {
    "payload": {
      "issueKey": "OPS-123",
      "summary": "OPS-123 follow-up",
      "replacements": [
        {
          "find": "Sprint 1",
          "replace": "Sprint 2"
        }
      ]
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

