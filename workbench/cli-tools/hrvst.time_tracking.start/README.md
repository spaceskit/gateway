# Harvest Start Timer

## Purpose
Start a Harvest timer for a project/task selection.

## Wrapper Operation
- Tool id: `hrvst.time_tracking.start`
- Wrapper operation: `time_tracking.start`
- Harvest CLI mapping: `hrvst start [alias]`

## Host Harvest Configuration
- Install `hrvst-cli` on the external gateway host and verify it works outside Spaces.
- Authenticate the host once with `hrvst login` before starting the gateway.
- Keep any required Harvest OAuth/session state available to the gateway host user.

## Payload
- `arguments` (optional): Ordered positional arguments after the subcommand: alias.
- `flags` (optional): Optional Harvest flags. Use raw CLI flag keys such as `project_id`, `page`, or `external_reference[id]`.
- `presentFlags` (optional): Optional flag names that should be rendered without values, for example `editor`.

## Example Payloads
```json
[
  {
    "payload": {
      "flags": {
        "project_id": "2001",
        "task_id": "3001",
        "notes": "Investigating bundle auth"
      }
    }
  }
]
```

## Output Contract
- The wrapper always emits JSON.
- Success shape: `{ ok, operation, summary, data?, refs? }`.
- Tools that support `--output json` return parsed Harvest JSON in `data`.
- Text-oriented commands return normalized text data in `data.text`.

## Approval Guidance
- Keep explicit human approval enabled for every Harvest tool.
- Treat delete-style tools with extra care because they can remove Harvest data.

