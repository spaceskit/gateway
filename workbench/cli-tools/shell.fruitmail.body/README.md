# Read Email Body

## Purpose
Read the full body content of an email by its message ID. Returns plain text content.

## Wrapper Operation
- Tool id: `shell.fruitmail.body`
- Wrapper operation: `body`

## Host Apple Mail Configuration
- Install `apple-mail-search-cli` (`fruitmail`) on the external gateway host.
- Confirm the host user can access the local Mail.app database before starting the gateway.
- Keep Mail.app signed in and fully synced for the account data you expect to query.

## Payload
- `messageId` (required): The message ID (ROWID) from a previous search result.

## Output Contract
- The wrapper always emits JSON.
- Output mode: `json`
- Output hint: Returns JSON output containing the email body text.
