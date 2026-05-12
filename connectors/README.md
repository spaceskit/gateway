# Connectors

Gateway connectors integrate external services (messaging platforms, APIs, native OS frameworks) into the Spaces runtime. Each connector belongs to a **connector family** and can have one or more **connector instances** with bindings that route events to spaces and agents.

## Architecture

```
Connector Family          (definition: kind, runtime, trust class, capabilities)
  -> Connector Instance   (runtime config: credentials, status, selectors)
       -> Bindings        (routing: inbound events, outbound actions, capability exports)
```

### Connector Families

A family defines _what_ the connector is. Families are registered in `packages/bootstrap/src/services/connector-admin-service.ts` under `DEFAULT_CONNECTOR_FAMILIES` and seeded into the database on startup.

### Connector Instances

An instance is a _running_ connector with credentials and state. Instances belong to a family and are created via the gateway admin API.

### Bindings

Bindings route events between a connector instance and the Spaces runtime:

| Binding Type | Direction | Purpose |
|---|---|---|
| `inbound_route` | External -> Gateway | Route incoming events (messages, webhooks) to an orchestrator |
| `outbound_action` | Gateway -> External | Send messages, media, reactions back to the external service |
| `capability_export` | Bidirectional | Export connector capabilities (calendar, email, etc.) as agent tools |

---

## Connector Family Fields

```typescript
{
  familyId: string;           // Unique ID, e.g. "discord-bot"
  displayName: string;        // Human-readable name
  kind: ConnectorKind;        // "channel" | "capability" | "hybrid"
  runtime: ConnectorRuntime;  // "adapter" | "connector" | "builtin"
  trustClass: ConnectorTrustClass; // "embedded_safe" | "external_only"
  embeddedEnabled: boolean;   // Can run inside App Store sandboxed app?
  capabilityTypes: CapabilityType[]; // What capabilities this provides
  features: Record<string, unknown>; // Arbitrary metadata
}
```

### Field Reference

**`kind`** - What role the connector plays:
- `capability` - Provides tools/capabilities to agents (e.g. calendar, contacts)
- `channel` - Messaging channel for inbound/outbound communication (e.g. Discord, WhatsApp)
- `hybrid` - Both capability provider and communication channel (e.g. Apple Mail)

**`runtime`** - How the connector executes:
- `adapter` - Runs inside the gateway process via a native adapter (Apple frameworks)
- `connector` - External service integration via HTTP/WebSocket APIs
- `builtin` - Core gateway functionality

**`trustClass`** - Security boundary:
- `embedded_safe` - Can run in the embedded (App Store) gateway profile
- `external_only` - Requires an external gateway (subprocess/network access needed)

**`capabilityTypes`** - Which capability types this connector provides. Available types:
`lists`, `calendar`, `notes`, `contacts`, `email`, `messaging`, `speech`, `notifications`, `files`, `clipboard`, `shell`, `shortcuts`, `browser`, `media`, `health`, `mcp`, `secrets`

---

## Selector Schemas

Each connector family defines selector schemas that control how bindings match events. These are registered in `DEFAULT_CONNECTOR_SELECTOR_SCHEMAS` in `connector-admin-service.ts`.

```typescript
"your-connector-id": {
  inbound_route: {
    allowedKeys: ["accountId", "channelId"],
    description: "Keys for matching inbound events to routes.",
  },
  outbound_action: {
    allowedKeys: ["accountId", "channelId"],
    description: "Keys for targeting outbound actions.",
  },
  capability_export: {
    allowedKeys: ["accountId", "channelId", "capabilityType"],
    description: "Keys for scoping capability exports.",
  },
}
```

---

## Binding Targets & Actions

**Targets** - Where inbound events are routed:
- `main_orchestrator` - The gateway's main orchestrator agent
- `space_orchestrator` - A specific space's orchestrator agent

**Actions** - What outbound actions are available:
- `notify` - Send a notification
- `send_message` - Send a text message
- `send_media` - Send media (images, files)
- `send_reaction` - Send a reaction/emoji

---

## How to Add a New Connector

### Step 1: Define the Connector Family

Add an entry to `DEFAULT_CONNECTOR_FAMILIES` in `packages/bootstrap/src/services/connector-admin-service.ts`:

```typescript
{
  familyId: "your-service-id",
  displayName: "Your Service Name",
  kind: "channel",           // or "capability" / "hybrid"
  runtime: "connector",      // "connector" for external APIs
  trustClass: "external_only",
  embeddedEnabled: false,
  capabilityTypes: ["messaging"],
  features: { channel: "your-service" },
},
```

### Step 2: Add Selector Schemas

Add an entry to `DEFAULT_CONNECTOR_SELECTOR_SCHEMAS` in the same file:

```typescript
"your-service-id": {
  inbound_route: {
    allowedKeys: ["accountId", "channelId"],
    description: "Match keys for inbound webhooks.",
  },
  outbound_action: {
    allowedKeys: ["accountId", "channelId"],
    description: "Target keys for outbound messages.",
  },
  capability_export: {
    allowedKeys: ["accountId", "capabilityType"],
    description: "Scope keys for capability exports.",
  },
},
```

### Step 3: Add a Feature Flag (optional)

In `packages/bootstrap/src/config.ts`, gate the connector behind an environment variable:

```typescript
const enableYourServiceConnectorFamily = parseBooleanEnv(
  Bun.env.SPACESKIT_ENABLE_YOUR_SERVICE_CONNECTOR_FAMILY,
  externalByDefault,
);
```

Then check it in `isFamilyEnabledByFlag()` in `connector-admin-service.ts`.

### Step 4: Implement the Connector Runtime

Create a service in `packages/bootstrap/src/services/` that:

1. **Handles inbound events** - Receive webhooks/messages from the external service and submit them via `connector.submit_inbound_event`
2. **Handles outbound actions** - Listen for outbound action requests and call the external service API
3. **Registers as a capability provider** (if `kind` is `capability` or `hybrid`) - Register tools with the gateway's capability registry

### Step 5: Add Policy Selectors

The connector family is automatically available as a policy selector (`connector_family:your-service-id`) in the space security tab. No additional wiring needed.

### Step 6: Create a Stub Directory

Add a directory under `connectors/` with a README documenting:
- What the connector does
- Required credentials/configuration
- API endpoints used
- Current implementation status

---

## Existing Connectors

### Working

| Family ID | Display Name | Kind | Runtime | Embedded |
|---|---|---|---|---|
| `apple-calendar-eventkit` | Apple Calendar (EventKit) | capability | adapter | Yes |
| `apple-reminders-eventkit` | Apple Reminders (EventKit) | capability | adapter | Yes |
| `apple-mail-mailkit` | Apple Mail (MailKit) | hybrid | adapter | Yes |

### Placeholder (not yet implemented)

| Family ID | Display Name | Kind | Runtime | Embedded |
|---|---|---|---|---|
| `apple-contacts-contactsframework` | Apple Contacts | capability | adapter | Yes |
| `apple-notifications-usernotifications` | Apple Notifications | hybrid | adapter | Yes |
| `discord-bot` | Discord Bot API | channel | connector | No |
| `whatsapp-cloud` | WhatsApp Cloud API | channel | connector | No |

### CLI Tool Bundles (separate system, see `workbench/cli-tools/`)

| Bundle ID | Display Name |
|---|---|
| `jira-cli` | Jira CLI |
| `hrvst-cli` | Harvest CLI |
| `onepassword-cli` | 1Password CLI |

---

## Key Source Files

| File | Purpose |
|---|---|
| `packages/bootstrap/src/services/connector-admin-service.ts` | Family definitions, selector schemas, instance management |
| `packages/bootstrap/src/services/space-tool-policy-service.ts` | Connector policy enforcement per space |
| `packages/bootstrap/src/services/tool-access-policy-service.ts` | Gateway-level tool access policy with connector selectors |
| `packages/persistence/src/repositories/connector-families.ts` | Database persistence for connector families |
| `packages/persistence/src/repositories/connector-bindings.ts` | Database persistence for connector bindings |
| `packages/server/src/handlers/gateway-connector-handlers.ts` | API handlers for connector management |
| `packages/server/src/protocol/connectors.ts` | Protocol types for connector payloads |
| `packages/core/src/capabilities/types.ts` | Core capability and connector type definitions |
