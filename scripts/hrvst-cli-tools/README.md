# Spaces Harvest CLI Tools

This directory contains the checked-in Harvest bundle for the external-gateway CLI tool runtime.

## Files

- `spaces-hrvst.mjs`: shared wrapper that converts stable JSON payloads into `hrvst` argv and emits a stable JSON envelope.
- `materialize-hrvst-cli-tools.mjs`: helper that writes one `manifest.json` and `README.md` directory per Harvest tool into a gateway `cli-tools` directory.
- `catalog.mjs`: shared Harvest tool catalog, schemas, manifest generation, and per-tool README generation.

## Requirements

- `hrvst-cli` installed on the external gateway host
- Harvest host authentication already working through `hrvst login`
- `node` available on the host so the wrapper shebang can execute

## Materialize The Bundle

```sh
node gateway/scripts/hrvst-cli-tools/materialize-hrvst-cli-tools.mjs \
  --target /absolute/path/to/gateway/cli-tools
```

To materialize only a subset:

```sh
node gateway/scripts/hrvst-cli-tools/materialize-hrvst-cli-tools.mjs \
  --target /absolute/path/to/gateway/cli-tools \
  --tool hrvst.projects.list \
  --tool hrvst.time_entries.create
```

Each generated tool directory contains:

- `manifest.json`: ready-to-load CLI tool manifest with an absolute wrapper path
- `README.md`: operator guidance, payload examples, and output contract notes

## Notes

- The generated manifests use `cwdMode: "fixed"` because Harvest CLI does not need a space workspace root.
- Every generated tool keeps approval enabled through the existing gateway CLI tool runtime.
- Delete-style tools are marked `destructive`.
