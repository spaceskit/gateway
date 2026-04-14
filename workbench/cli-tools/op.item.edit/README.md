# 1Password Item Edit

## Purpose
Edit a 1Password item.

## Wrapper Operation
- Tool id: `op.item.edit`
- Wrapper operation: `item.edit`
- 1Password CLI mapping: `op item edit <item>`

## Host 1Password Configuration
- Install 1Password CLI on the external gateway host and verify it works outside Spaces.
- Authenticate the host once with the 1Password desktop app integration, a manual account, or a service account before starting the gateway.
- Keep any required `OP_ACCOUNT`, `OP_SESSION`, or service-account environment configuration available to the gateway host user.

## Payload
- `arguments` (required): Ordered positional arguments after the subcommand: item.
- `flags` (optional): Optional 1Password flags. Use raw CLI flag keys such as `vault`, `account`, `expires-in`, or `out-file`.
- `presentFlags` (optional): Optional flag names that should be rendered without values, for example `archive`.
- `stdin` (optional): Optional stdin payload forwarded to the 1Password CLI command.

## Example Payloads
```json
[
  {
    "payload": {
      "arguments": [
        "Database Credentials",
        "title=Updated Title"
      ]
    }
  }
]
```

## Output Contract
- The wrapper always emits JSON.
- Success shape: `{ ok, operation, summary, data?, refs? }`.
- Tools that support `--format json` return parsed 1Password JSON in `data`.
- Secret reads and text-oriented commands return normalized text data in `data.text`.

## Approval Guidance
- Keep explicit human approval enabled for every 1Password tool.
- Treat revoke/delete/forget/suspend operations with extra care.
- Secret-returning tools stay approval-gated and should only be used when the destination and purpose are clear.

