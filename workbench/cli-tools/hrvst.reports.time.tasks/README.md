# Harvest Tasks Time Report

## Purpose
Return the Harvest tasks time report for a time window.

## Wrapper Operation
- Tool id: `hrvst.reports.time.tasks`
- Wrapper operation: `reports.time.tasks`
- Harvest CLI mapping: `hrvst reports time-reports tasks-time-report`

## Host Harvest Configuration
- Install `hrvst-cli` on the external gateway host and verify it works outside Spaces.
- Authenticate the host once with `hrvst login` before starting the gateway.
- Keep any required Harvest OAuth/session state available to the gateway host user.

## Payload
- `arguments` (optional): Optional extra positional arguments to append after the subcommand.
- `flags` (optional): Optional Harvest flags. Use raw CLI flag keys such as `project_id`, `page`, or `external_reference[id]`.
- `presentFlags` (optional): Optional flag names that should be rendered without values, for example `editor`.

## Example Payloads
```json
[
  {
    "payload": {
      "flags": {
        "from": "2026-03-01",
        "to": "2026-03-21",
        "page": "all"
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

