# Jira Watcher Add

## Purpose
Add a watcher to a Jira issue and return the refreshed issue payload.

## Wrapper Operation
- Tool id: `jira.issue.watch`
- Wrapper operation: `issue.watch`
- Jira CLI mapping: `jira issue watch ISSUE-KEY WATCHER`

## Host Jira Configuration
- Install `jira-cli` on the external gateway host and verify it works outside Spaces.
- Configure the host once with `jira init`.
- Provide credentials with `JIRA_API_TOKEN` and, when needed, `JIRA_AUTH_TYPE=bearer`.
- If the host should use a non-default Jira profile, set `JIRA_CONFIG_FILE` before starting the gateway.

## Payload
- `project` (optional): Optional Jira project key or id override for this call.
- `issueKey` (required): Jira issue key, for example `OPS-123`.
- `watcher` (required): Watcher email or exact display name.

## Example Payloads
```json
[
  {
    "payload": {
      "issueKey": "OPS-123",
      "watcher": "alice@example.com"
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

