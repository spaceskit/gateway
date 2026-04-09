# WhatsApp Cloud API Connector

**Status:** Placeholder (family defined, no runtime implementation)

## Overview

Integrates WhatsApp Business messaging with Spaces via the Meta Cloud API, allowing agents to receive and respond to WhatsApp messages, send notifications, and manage conversations.

## Family Definition

```typescript
{
  familyId: "whatsapp-cloud",
  displayName: "WhatsApp Cloud API",
  kind: "channel",
  runtime: "connector",
  trustClass: "external_only",
  embeddedEnabled: false,
  capabilityTypes: ["messaging", "notifications"],
  features: { channel: "whatsapp", provider: "meta" },
}
```

## Selector Schema

```typescript
{
  inbound_route: { allowedKeys: ["accountId", "chatId", "phoneNumberId", "waBusinessAccountId"] },
  outbound_action: { allowedKeys: ["accountId", "chatId", "phoneNumberId", "waBusinessAccountId"] },
  capability_export: { allowedKeys: ["accountId", "phoneNumberId", "capabilityType"] },
}
```

## What Exists

- [x] Connector family registered in `connector-admin-service.ts`
- [x] Selector schemas defined
- [x] Feature flag: `SPACESKIT_ENABLE_WHATSAPP_CONNECTOR_FAMILY`
- [x] Policy integration (toggle in space security tab)
- [x] Binding validation (admin tests pass)

## What Needs Implementation

- [ ] WhatsApp Cloud API HTTP client
- [ ] Access token configuration and credential storage
- [ ] Webhook receiver for inbound messages (`/webhook` endpoint with verification)
- [ ] Outbound message handler: text, media, templates, reactions
- [ ] Phone number registration and verification flow
- [ ] Message status tracking (sent, delivered, read)
- [ ] Rate limiting (WhatsApp: 80 messages/second per phone number for business-initiated)
- [ ] Template message support (required for business-initiated conversations)
- [ ] Functional tests with WhatsApp API mocks

## Required Credentials

| Credential | Source | Description |
|---|---|---|
| Access Token | Meta Developer Portal | Permanent or temporary access token |
| Phone Number ID | Meta Business Suite | WhatsApp business phone number ID |
| WA Business Account ID | Meta Business Suite | WhatsApp Business Account identifier |
| App Secret | Meta Developer Portal | For webhook signature verification (`X-Hub-Signature-256`) |
| Verify Token | Self-defined | Webhook verification challenge token |

## WhatsApp Cloud API Reference

- Base URL: `https://graph.facebook.com/v21.0`
- [Getting Started](https://developers.facebook.com/docs/whatsapp/cloud-api/get-started)
- [Webhooks](https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks)
- [Message Types](https://developers.facebook.com/docs/whatsapp/cloud-api/messages)

## Binding Examples

### Inbound: Route messages from a phone number to a space

```json
{
  "bindingType": "inbound_route",
  "target": "space_orchestrator",
  "selectors": {
    "phoneNumberId": "123456789",
    "waBusinessAccountId": "987654321"
  }
}
```

### Outbound: Send messages from a phone number

```json
{
  "bindingType": "outbound_action",
  "action": "send_message",
  "selectors": {
    "phoneNumberId": "123456789",
    "chatId": "+1234567890"
  }
}
```
