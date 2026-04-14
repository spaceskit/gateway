# Unread Emails

## Purpose
List all unread emails from Apple Mail.

## Wrapper Operation
- Tool id: `shell.fruitmail.unread`
- Wrapper operation: `unread`

## Host Apple Mail Configuration
- Install `apple-mail-search-cli` (`fruitmail`) on the external gateway host.
- Confirm the host user can access the local Mail.app database before starting the gateway.
- Keep Mail.app signed in and fully synced for the account data you expect to query.

## Payload
- `limit` (optional): Maximum number of results. Defaults to 20.

## Output Contract
- The wrapper always emits JSON.
- Output mode: `json`
- Output hint: Returns JSON output.
