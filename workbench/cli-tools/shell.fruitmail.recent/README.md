# Recent Emails

## Purpose
List recent emails from Apple Mail. Returns subject, sender, date, and mailbox for each message.

## Wrapper Operation
- Tool id: `shell.fruitmail.recent`
- Wrapper operation: `recent`

## Host Apple Mail Configuration
- Install `apple-mail-search-cli` (`fruitmail`) on the external gateway host.
- Confirm the host user can access the local Mail.app database before starting the gateway.
- Keep Mail.app signed in and fully synced for the account data you expect to query.

## Payload
- `days` (optional): Number of days to look back. Defaults to 7.
- `limit` (optional): Maximum number of results. Defaults to 20.

## Output Contract
- The wrapper always emits JSON.
- Output mode: `json`
- Output hint: Returns JSON output.
