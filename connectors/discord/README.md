# Discord Bot Connector

**Status:** Placeholder (family defined, no runtime implementation)

## Overview

Integrates a Discord bot with Spaces, allowing agents to receive and respond to Discord messages, manage channels, and send notifications.

## Family Definition

```typescript
{
  familyId: "discord-bot",
  displayName: "Discord Bot API",
  kind: "channel",
  runtime: "connector",
  trustClass: "external_only",
  embeddedEnabled: false,
  capabilityTypes: ["messaging", "notifications"],
  features: { channel: "discord" },
}
```

## Selector Schema

```typescript
{
  inbound_route: { allowedKeys: ["guildId", "channelId", "threadId"] },
  outbound_action: { allowedKeys: ["guildId", "channelId", "threadId"] },
  capability_export: { allowedKeys: ["guildId", "channelId", "capabilityType"] },
}
```

## What Exists

- [x] Connector family registered in `connector-admin-service.ts`
- [x] Selector schemas defined
- [x] Feature flag: `SPACESKIT_ENABLE_DISCORD_CONNECTOR_FAMILY`
- [x] Policy integration (toggle in space security tab)
- [x] Binding validation (admin tests pass)

## What Needs Implementation

- [ ] Discord Bot API client (discord.js or raw REST/WebSocket)
- [ ] Bot token configuration and credential storage
- [ ] Inbound event handler: receive Discord messages via WebSocket gateway
- [ ] Outbound action handler: send messages, media, reactions to Discord channels
- [ ] Webhook receiver for Discord interactions (slash commands, buttons)
- [ ] Guild/channel discovery for binding configuration
- [ ] Rate limiting (Discord API limits: 50 requests/second per bot)
- [ ] Functional tests with Discord API mocks

## Required Credentials

| Credential | Source | Description |
|---|---|---|
| Bot Token | Discord Developer Portal | Bot authentication token |
| Application ID | Discord Developer Portal | OAuth2 application ID |
| Public Key | Discord Developer Portal | For webhook signature verification |

## Discord API Reference

- REST API: `https://discord.com/api/v10`
- WebSocket Gateway: `wss://gateway.discord.gg`
- [Developer Documentation](https://discord.com/developers/docs)
- [Bot Permissions Calculator](https://discord.com/developers/docs/topics/permissions)

## Binding Examples

### Inbound: Route messages from a channel to a space

```json
{
  "bindingType": "inbound_route",
  "target": "space_orchestrator",
  "selectors": {
    "guildId": "123456789",
    "channelId": "987654321"
  }
}
```

### Outbound: Send messages to a channel

```json
{
  "bindingType": "outbound_action",
  "action": "send_message",
  "selectors": {
    "guildId": "123456789",
    "channelId": "987654321"
  }
}
```
