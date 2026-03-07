# Gateway Core (Default-Deny Runtime)

`@spaceskit/gateway-core` defines a locked-down runtime policy for the gateway.
It starts from deny-all and only opens capabilities after explicit grant.

## Profiles

Two built-in profiles are provided:

- `embedded`: App Store-safe baseline for Apple app bundles.
- `external`: advanced baseline for website-installed developer gateways.

Both profiles start with `defaultAction = "deny"` and require explicit grants for capability use.

## Capability Flow

1. Build a runtime state with `createGatewayCoreState`.
2. Evaluate each requested action with `evaluateCapabilityRequest`.
3. If decision is `prompt`, request user consent.
4. Store grant with `grantCapability`.
5. Revoke or expire grants with `revokeCapability` / `pruneExpiredCapabilityGrants`.

The bootstrap runtime maps capability invocations (for example `calendar.getEvents`) into canonical grant IDs (`calendar.read`, `calendar.write`, or `calendar.execute`) before evaluation.

## Example

```ts
import {
  createGatewayCoreState,
  evaluateCapabilityRequest,
  grantCapability,
} from "@spaceskit/gateway-core";

let core = createGatewayCoreState({ profileId: "embedded" });

const decision = evaluateCapabilityRequest(core, {
  capabilityId: "calendar.read",
  level: "read",
});

if (decision.decision === "prompt") {
  const approved = true; // from native consent UI
  if (approved) {
    core = grantCapability(core, {
      capabilityId: "calendar.read",
      level: "read",
      grantedBy: "user",
    });
  }
}
```

## Design Notes

- Embedded profile hard-blocks capabilities that conflict with App Store-safe operation (`shell.execute`, dynamic plugin loading, multi-gateway, and similar).
- External profile keeps the same default-deny model, but does not hard-block developer capabilities.
- Capability IDs are string-based so native adapters can map platform-specific permissions (`EventKit`, `Mail`, file access, voice, etc.) without changing protocol types.

## Startup Grants

You can seed grants at startup with:

```bash
SPACESKIT_GATEWAY_CAPABILITY_GRANTS=calendar.read,lists.read,files.read,speech.execute
```

Alias forms are accepted for convenience:

- `email.send` => `email.write`
- `voice.stream` => `speech.execute`
- `reminders.read` => `lists.read`

## Runtime Grant API

The gateway message router exposes runtime grant management for authenticated clients:

- `gateway.list_capability_grants`
- `gateway.grant_capability`
- `gateway.revoke_capability`

These operations are scoped to the authenticated principal (`client.publicKey`) and optional device (`client.deviceId`).

Current enforcement scope:

- Direct capability invocations (`capability.invoke`) evaluate principal/device grants.
- Agent tool loops for authenticated `execute_turn` requests also evaluate principal/device grants.
- Speech auto-submit turns inherit the principal/device from the authenticated `speech.start` request.
- Background/system turns without caller identity continue to evaluate global grants.
