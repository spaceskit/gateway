# Send Email

## Purpose
Send an email via the macOS mail command. No additional permissions required.

## Wrapper Operation
- Tool id: `shell.fruitmail.send`
- Wrapper operation: `send`

## Host Apple Mail Configuration
- Install `apple-mail-search-cli` (`fruitmail`) on the external gateway host.
- Confirm the host user can access the local Mail.app database before starting the gateway.
- Keep Mail.app signed in and fully synced for the account data you expect to query.

## Payload
- `to` (required): Recipient email address.
- `subject` (required): Email subject line.
- `body` (required): Email body text.
- `cc` (optional): Optional CC recipient email address.

## Output Contract
- The wrapper always emits JSON.
- Output mode: `json`
- Output hint: Returns JSON send confirmation.
