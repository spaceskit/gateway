# Spaces Peekaboo CLI Tools

This directory defines the gateway-managed Peekaboo CLI bundle.

## Files

- `catalog.mjs`: source-of-truth bundle metadata and tool definitions.
- `spaces-peekaboo.mjs`: JSON-envelope wrapper used by gateway shell tool manifests.
- `materialize-peekaboo-cli-tools.mjs`: helper that writes one `manifest.json` and `README.md` directory per Peekaboo tool into a gateway `cli-tools` directory.

## Host Setup

Install Peekaboo on the external gateway host:

```bash
brew install steipete/tap/peekaboo
```

Grant Screen Recording and Accessibility permissions to the host process that launches Peekaboo, then verify:

```bash
peekaboo permissions status --json
```

If the binary is not discoverable from PATH, set `SPACES_PEEKABOO_EXECUTABLE` to an absolute executable path before starting the gateway.

## Materialize

```bash
node gateway/scripts/peekaboo-cli-tools/materialize-peekaboo-cli-tools.mjs \
  --target gateway/workbench/cli-tools
```
