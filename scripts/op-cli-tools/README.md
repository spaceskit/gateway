# Spaces 1Password CLI Tools

This directory contains the checked-in 1Password CLI bundle for the external-gateway CLI tool runtime.

## Files

- `spaces-op.mjs`: shared wrapper that converts stable JSON payloads into `op` argv and emits a stable JSON envelope.
- `materialize-op-cli-tools.mjs`: helper that writes one `manifest.json` and `README.md` directory per 1Password tool into a gateway `cli-tools` directory.
- `catalog.mjs`: shared 1Password tool catalog, schemas, manifest generation, and per-tool README generation.

## Requirements

- 1Password CLI installed on the external gateway host
- host 1Password auth already working through desktop-app integration, a manual account, or a service account
- `node` available on the host so the wrapper shebang can execute

## Materialize The Bundle

```sh
node gateway/scripts/op-cli-tools/materialize-op-cli-tools.mjs \
  --target /absolute/path/to/gateway/cli-tools
```

To materialize only a subset:

```sh
node gateway/scripts/op-cli-tools/materialize-op-cli-tools.mjs \
  --target /absolute/path/to/gateway/cli-tools \
  --tool op.vault.list \
  --tool op.read
```

Each generated tool directory contains:

- `manifest.json`: ready-to-load CLI tool manifest with an absolute wrapper path
- `README.md`: operator guidance, payload examples, and output contract notes

## Notes

- The generated manifests use `cwdMode: "fixed"` because 1Password CLI does not need a space workspace root.
- Every generated tool keeps approval enabled through the existing gateway CLI tool runtime.
- Revoke/delete/forget/suspend tools are marked `destructive`.
