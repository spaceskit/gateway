# Spaces Jira CLI Tools

This directory contains a checked-in Jira example bundle for the external-gateway CLI tool runtime.

## Files

- `spaces-jira.mjs`: shared wrapper that converts stable JSON payloads into `jira-cli` argv and emits a stable JSON envelope.
- `materialize-jira-cli-tools.mjs`: helper that writes one `manifest.json` and `README.md` bundle per Jira tool into a gateway `cli-tools` directory.
- `catalog.mjs`: shared Jira tool catalog, schemas, manifest generation, and per-tool README generation.

## Requirements

- `jira-cli` installed on the external gateway host
- host Jira auth/config already working via `jira init`, `JIRA_API_TOKEN`, and optional `JIRA_CONFIG_FILE`
- `node` available on the host so the wrapper shebang can execute

## Materialize The Bundle

```sh
node gateway/scripts/jira-cli-tools/materialize-jira-cli-tools.mjs \
  --target /absolute/path/to/gateway/cli-tools
```

To materialize only a subset:

```sh
node gateway/scripts/jira-cli-tools/materialize-jira-cli-tools.mjs \
  --target /absolute/path/to/gateway/cli-tools \
  --tool jira.issue.view \
  --tool sprint.close
```

Each generated tool directory contains:

- `manifest.json`: ready-to-load CLI tool manifest with an absolute wrapper path
- `README.md`: operator guidance, payload examples, and output contract notes

## Notes

- The generated manifests use `cwdMode: "fixed"` because Jira does not need a space workspace root.
- Every generated tool keeps approval enabled through the existing gateway CLI tool runtime.
- `jira.sprint.close` is the only tool marked `destructive` in this first cut.
