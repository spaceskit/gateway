# Fruitmail CLI Tools — Apple Mail Gateway Connector

Gateway-managed CLI tool bundle for Apple Mail access via [fruitmail](https://github.com/gumadeiras/fruitmail-cli).

## Prerequisites

1. Install fruitmail: `npm install -g apple-mail-search-cli`
2. Grant **Full Disk Access** to your terminal (Terminal.app or iTerm) in System Settings > Privacy & Security > Full Disk Access
3. Verify: `fruitmail stats` should show your mail database statistics

## Operations

| Tool | Operation | Description |
|------|-----------|-------------|
| `shell.fruitmail.stats` | stats | Mail database statistics (total, unread, attachments) |
| `shell.fruitmail.recent` | recent | List recent emails (configurable days + limit) |
| `shell.fruitmail.search` | search | Advanced search by subject, sender, recipient, date, attachments |
| `shell.fruitmail.body` | body | Read full email body by message ID |
| `shell.fruitmail.unread` | unread | List unread emails |
| `shell.fruitmail.send` | send | Send email via macOS `mail` command |

## How it works

- **Read operations** (stats, recent, search, body, unread): Query Mail.app's local SQLite database directly via fruitmail. ~50ms for metadata, ~200ms for body content.
- **Send**: Uses macOS built-in `/usr/bin/mail` command. No additional permissions needed.
- **No AppleScript automation required** for read operations.
- **App Store safe**: Only the CLI tool needs Full Disk Access, not the Spaces app itself.
