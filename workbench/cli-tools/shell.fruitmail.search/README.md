# Search Emails

## Purpose
Search Apple Mail with filters: subject, sender, recipient, unread, attachments, date range.

## Wrapper Operation
- Tool id: `shell.fruitmail.search`
- Wrapper operation: `search`

## Host Apple Mail Configuration
- Install `apple-mail-search-cli` (`fruitmail`) on the external gateway host.
- Confirm the host user can access the local Mail.app database before starting the gateway.
- Keep Mail.app signed in and fully synced for the account data you expect to query.

## Payload
- `subject` (optional): Search by subject text.
- `sender` (optional): Search by sender email address.
- `to` (optional): Search by recipient email address.
- `fromName` (optional): Search by sender display name.
- `unread` (optional): Only show unread emails.
- `read` (optional): Only show read emails.
- `days` (optional): Days lookback window. Defaults to 7.
- `hasAttachment` (optional): Only show emails with attachments.
- `attachmentType` (optional): Filter by attachment file extension (e.g., pdf, xlsx).
- `limit` (optional): Maximum number of results. Defaults to 20.

## Output Contract
- The wrapper always emits JSON.
- Output mode: `json`
- Output hint: Returns JSON output.
