# Jira Worklog Add

## Purpose
Add worklog time to a Jira issue and return the refreshed issue payload.

## Wrapper Operation
- Tool id: `jira.issue.worklog.add`
- Wrapper operation: `issue.worklog.add`
- Jira CLI mapping: `jira issue worklog add ISSUE-KEY TIME_SPENT --no-input`

## Host Jira Configuration
- Install `jira-cli` on the external gateway host and verify it works outside Spaces.
- Configure the host once with `jira init`.
- Provide credentials with `JIRA_API_TOKEN` and, when needed, `JIRA_AUTH_TYPE=bearer`.
- If the host should use a non-default Jira profile, set `JIRA_CONFIG_FILE` before starting the gateway.

## Payload
- `project` (optional): Optional Jira project key or id override for this call.
- `issueKey` (required): Jira issue key, for example `OPS-123`.
- `timeSpent` (required): Time to log, for example `2h 30m`.
- `started` (optional): Optional start time. Supports Jira datetime or `YYYY-MM-DD HH:MM:SS`.
- `timezone` (optional): Optional IANA timezone for the `started` value.
- `comment` (optional): Optional worklog comment.
- `newEstimate` (optional): Optional new remaining estimate.

## Example Payloads
```json
[
  {
    "payload": {
      "issueKey": "OPS-123",
      "timeSpent": "2h",
      "comment": "Implemented the Jira wrapper."
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

