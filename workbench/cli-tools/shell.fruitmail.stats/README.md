# Mail Stats

## Purpose
Get Apple Mail database statistics: total messages, unread, deleted, and attachment counts.

## Wrapper Operation
- Tool id: `shell.fruitmail.stats`
- Wrapper operation: `stats`

## Host Apple Mail Configuration
- Install `apple-mail-search-cli` (`fruitmail`) on the external gateway host.
- Confirm the host user can access the local Mail.app database before starting the gateway.
- Keep Mail.app signed in and fully synced for the account data you expect to query.

## Payload
- This tool does not require any payload fields.

## Output Contract
- The wrapper always emits JSON.
- Output mode: `json`
- Output hint: Returns JSON output.
