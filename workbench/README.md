# Workbench

The workbench is the local gateway-backed evaluation bench for Spaces.

It boots an embedded gateway, seeds fixtures, registers a small adapter surface, runs selected workbench layers, and exposes a browser UI with:

- a persisted `Jobs` queue
- a persisted `Analyst` queue
- live run updates over WebSocket
- saved `Reports`
- run detail with normalized runner events and filtered gateway events
- analyst sessions that start from a failed run or an existing `spaceId`

## Start

From the gateway workspace:

```bash
cd /Users/caruso/code/spaces/gateway
```

### Interactive live runner

Starts the UI immediately and auto-enqueues the initial run from the CLI filters.

```bash
bun run workbench/run.ts --interactive
```

Open:

```text
http://127.0.0.1:19321
```

Runtime endpoints:

- gateway HTTP: `http://127.0.0.1:19320`
- gateway WS: `ws://127.0.0.1:19320`
- dashboard: `http://127.0.0.1:19321`

### UI only

Starts the gateway, runner service, and UI without auto-starting a run.

```bash
bun run workbench/run.ts --serve-only
```

### Headless single run

Runs the selected layers once, writes a JSON report, prints the console report, and exits with pass/fail.

```bash
bun run workbench/run.ts
```

## Useful filters

### Run selected layers

```bash
bun run workbench/run.ts --interactive --layers chat-roundtrip,provider-tool-parity
```

### Run selected providers

```bash
bun run workbench/run.ts --interactive --layers provider-tool-parity --providers claude,codex
```

### Custom database or reports directory

```bash
bun run workbench/run.ts --interactive \
  --db-path /tmp/workbench.db \
  --reports-dir /tmp/workbench-reports
```

## Layers

Current built-in layers are defined in [runtime.ts](/Users/caruso/code/spaces/gateway/workbench/runtime.ts):

- `chat-roundtrip`
- `mcp-tools`
- `provider-tool-parity`
- `orchestration`
- `template-handoff`

`template-handoff` exercises the staged Workbench template flow: create a
mid-complex `workbench/plan-discussion` plan, persist it as a space artifact,
mirror it into `workbench/code-implementation`, then ask the code team to
produce an implementation breakdown without mutating files.

## UI model

The browser has three top-level tabs:

### Jobs

The default operational surface.

It supports:

- preset CRUD
- ad hoc runs
- `Queue`
- `Run now`
- `Retry`
- `Cancel`
- live layer/scenario progress
- provider parity updates
- scheduler eval payloads
- runner events
- filtered raw gateway events

Queue semantics:

- one active worker at a time
- FIFO waiting queue
- `Run now` starts immediately if idle, otherwise jumps to the front of the waiting queue
- queued runs are persisted in `workbench.db`
- nonterminal runs become `interrupted` on process restart

### Reports

Historical file-backed report viewer for completed runs.

Completed runs still write JSON reports into `workbench/reports` or the configured `--reports-dir`.

### Analyst

Manual autonomous analysis surface for creating read-only fix proposals.

It supports:

- `Analyze` from a completed or failed job
- manual `Start from run`
- manual `Start from space`
- queued analyst sessions with the same single-worker gate as `Jobs`
- persisted evidence, verification commands, and gateway/service events
- final fix proposals with summary, root cause, proposed edits, and optional draft patch

Analyst sessions are:

- enabled in `--interactive` and `--serve-only`
- absent in headless single-run mode
- proposal-only in v1; they do not edit files

## Persistence

Default paths:

- DB: [workbench.db](/Users/caruso/code/spaces/gateway/workbench/workbench.db)
- reports: [reports](/Users/caruso/code/spaces/gateway/workbench/reports)

The live runner persists:

- presets
- queued/running/completed runs
- queued/running/completed analyst sessions
- normalized runner events
- filtered gateway events
- fix proposals

These models are implemented in:

- [runner-protocol.ts](/Users/caruso/code/spaces/gateway/workbench/runner-protocol.ts)
- [runner-service.ts](/Users/caruso/code/spaces/gateway/workbench/runner-service.ts)
- [analyst-service.ts](/Users/caruso/code/spaces/gateway/workbench/analyst-service.ts)
- [analyst-runtime.ts](/Users/caruso/code/spaces/gateway/workbench/analyst-runtime.ts)

## Main files

- entrypoint: [run.ts](/Users/caruso/code/spaces/gateway/workbench/run.ts)
- UI server: [dashboard.ts](/Users/caruso/code/spaces/gateway/workbench/dashboard.ts)
- run execution: [runtime.ts](/Users/caruso/code/spaces/gateway/workbench/runtime.ts)
- reports: [report.ts](/Users/caruso/code/spaces/gateway/workbench/report.ts)
- scenarios: [scenarios](/Users/caruso/code/spaces/gateway/workbench/scenarios)

## Focused verification

Runner and dashboard:

```bash
bun test workbench/runner-service.test.ts workbench/analyst-service.test.ts workbench/analyst-runtime.test.ts workbench/dashboard.test.ts
```

Provider parity helpers:

```bash
bun test workbench/scenarios/provider-tool-parity.test.ts
```

Workspace typecheck:

```bash
bun run typecheck
```

## Troubleshooting

### Port already in use

If an older workbench instance is still running:

```bash
lsof -nP -iTCP:19320 -sTCP:LISTEN
lsof -nP -iTCP:19321 -sTCP:LISTEN
kill <pid>
```

Then start the workbench again.

### Report exists but does not appear in Jobs

That is expected.

- `Jobs` is the persisted live runner queue/history
- `Reports` is the file-backed historical view

### Analyst tab is missing

That is expected in headless mode.

- `--interactive` enables `Jobs`, `Analyst`, and `Reports`
- `--serve-only` enables `Jobs`, `Analyst`, and `Reports`
- plain `bun run workbench/run.ts` runs once and exits without the live UI

### No initial run in the UI

`--interactive` auto-enqueues a run.

`--serve-only` does not.
