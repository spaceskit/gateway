# Jira Sprint Add

## Purpose
Add one or more Jira issues to a sprint.

## Wrapper Operation
- Tool id: `jira.sprint.add`
- Wrapper operation: `sprint.add`
- Jira CLI mapping: `jira sprint add SPRINT_ID ISSUE-1 [...ISSUE-N]`

## Host Jira Configuration
- Install `jira-cli` on the external gateway host and verify it works outside Spaces.
- Configure the host once with `jira init`.
- Provide credentials with `JIRA_API_TOKEN` and, when needed, `JIRA_AUTH_TYPE=bearer`.
- If the host should use a non-default Jira profile, set `JIRA_CONFIG_FILE` before starting the gateway.

## Payload
- `project` (optional): Optional Jira project key or id override for this call.
- `sprintId` (required): Jira sprint id.
- `issueKeys` (required): Issue keys to add to the sprint.

## Example Payloads
```json
[
  {
    "payload": {
      "sprintId": "42",
      "issueKeys": [
        "OPS-123",
        "OPS-124"
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

