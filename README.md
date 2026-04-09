# Spaceskit

A coordination protocol for multi-agent environments. Spaceskit defines how agents — regardless of what framework built them — coordinate in shared spaces with structured turns, human-in-the-loop feedback, and evolving identity.

> Read the [Manifesto](MANIFESTO.md) for the thinking behind the project.
> See the [Architecture diagram](ARCHITECTURE.mermaid) for how everything connects.
> See [Gateway Core docs](docs/gateway-core.md) for the default-deny embedded/external runtime model.

## What This Is

Spaceskit is a protocol and reference implementation for multi-agent coordination. It answers a specific question that existing tools don't: **how do agents built with different frameworks work together in the same room?**

MCP solved tool access as a protocol. Google's A2A (now merging with IBM's ACP under the Linux Foundation) addresses agent-to-agent messaging. Spaceskit defines the missing layer: structured coordination in shared environments — turn-taking, moderation, shared state, feedback, and evolving agent identity.

The protocol is defined in [protobuf service definitions](proto/). The reference implementation is a TypeScript gateway that runs on Bun.

## The Protocol

Spaceskit defines five protocol surfaces:

| Surface | What It Defines | Proto |
|---------|----------------|-------|
| **Space Lifecycle** | How environments are created, how agents join/leave, how sessions begin and end | `space_service.proto` |
| **Coordination** | How agents take turns — round-robin, moderated, debate, parallel race, priority queue | `coordinator_service.proto` |
| **Identity** | Agent profiles as portable passports — personality, capabilities, security posture, revision history | `profile_service.proto` |
| **Feedback** | Structured human-in-the-loop pauses when agents hit boundaries | `coordinator_service.proto` |
| **Shared State** | Canvas operations and artifact exchange between agents | `space_service.proto` |

### Why a Protocol

Agent frameworks (CrewAI, AutoGen, LangGraph) are good at building and running agents. But each owns the full stack — a CrewAI crew can't coordinate with an AutoGen team. There's no shared surface.

Spaceskit doesn't build agents. It runs the room. Any framework can implement a Spaceskit adapter to let its agents participate in coordinated spaces.

## Reference Implementation

The TypeScript gateway is the canonical implementation of the protocol. It is one part of a larger system:

| Layer | Role | Source |
|-------|------|--------|
| **Protocol** | Protobuf service definitions (the contract) | This repo (MIT) |
| **Reference Gateway** | TypeScript coordination runtime on Bun | This repo (MIT) |
| **Native Adapter** | OS integration (CloudKit, Siri, EventKit, speech) | Closed source |
| **Native App** | User-facing UI (SwiftUI on macOS) | Closed source |

The gateway is fully functional on its own. The native app and adapter provide the Apple-native experience on top.

## Getting Started

**Prerequisites:** [Bun](https://bun.sh) v1.2+

```bash
bun install
bun dev
```

That's it. No build step needed — Bun runs TypeScript natively.

By default, `bun dev` starts an **embedded** gateway on `127.0.0.1:9320`.
`bun run dev:embedded` is equivalent:

```bash
bun run dev:embedded
```

For the strict external profile on `127.0.0.1:9321`, run:

```bash
bun run dev:external:strict:example
```

`dev:external` enforces sandbox routing and requires a sandbox runtime module (`SPACESKIT_SANDBOX_RUNTIME_MODULE`) when `SPACESKIT_ARCH_FREEZE_ENFORCED=true` (default).
The example module at `docs/examples/sandbox-runtime-module.mjs` is a safe deny-by-default template; replace it with your real sandbox runtime implementation.
Equivalent explicit form:

```bash
SPACESKIT_SANDBOX_RUNTIME_MODULE=./docs/examples/sandbox-runtime-module.mjs \
bun run dev:external
```
For local development without a sandbox runtime module, use:

```bash
bun run dev:external:local
```

For production builds (emits `.js` + `.d.ts`):

```bash
bun run build
```

Run full build + type checks in one command:

```bash
bun run check:all
```

### Configuration

| Env Variable | Default | Description |
|---|---|---|
| `SPACESKIT_PORT` | `9320` | WebSocket server port |
| `SPACESKIT_HOST` | `127.0.0.1` | Server bind address |
| `SPACESKIT_DB_PATH` | `./gateway.db` | SQLite database path |
| `SPACESKIT_LOG_LEVEL` | `info` | Minimum log level (`debug`, `info`, `warn`, `error`) |
| `SPACESKIT_HEALTH_DEBUG` | `false` | Include extended diagnostics in `/health` output |
| `SPACESKIT_GATEWAY_PROFILE` | auto (`embedded` on `:9320`, `external` otherwise) | Gateway runtime profile (`embedded` or `external`) |
| `SPACESKIT_ARCH_FREEZE_ENFORCED` | `true` | Enforce sandbox-routed policy gates (required for strict external profile) |
| `SPACESKIT_SANDBOX_RUNTIME_MODULE` | — | Path to sandbox runtime module used by strict external profile |
| `SPACESKIT_GATEWAY_CAPABILITY_GRANTS` | — | Startup grants (comma-separated capability IDs like `calendar.read,lists.write`) |
| `SPACESKIT_GENERATION` | `v2_2026_02_21` | Runtime generation (changing this resets ephemeral data) |
| `SPACESKIT_MODEL_PROVIDER` | — | Default runtime ID (e.g. `openrouter`, `openai`, `codex`) |
| `SPACESKIT_MODEL` | — | Default model ID (e.g. `openrouter/openai/gpt-4.1-mini`) |
| `SPACESKIT_API_KEY` | — | API key for cloud runtimes that require one |
| `MCP_ENDPOINT` | — | MCP server endpoint (optional — enables MCP capabilities) |
| `SPACESKIT_CONFIG_FILE` | — | Path to JSON config file (enables hot-reload via SIGHUP) |
| `SPACESKIT_MAIN_SPACE_ID` | `main-space` | Startup default space ID |
| `SPACESKIT_MAIN_SPACE_NAME` | `Main Space` | Startup default space display name |
| `SPACESKIT_MAIN_RESOURCE_ID` | `resource:main` | Resource ID for the startup default space |
| `SPACESKIT_MAIN_PROFILE_ID` | `main-profile` | Startup default profile ID |
| `SPACESKIT_MAIN_AGENT_ID` | `main-agent` | Startup default agent ID |
| `SPACESKIT_REQUIRE_PREREGISTERED_DEVICE` | `false` | Require device to be pre-registered before auth succeeds |
| `SPACESKIT_REQUIRE_EXPLICIT_DEVICE_AUTH` | `false` | Strict device mode: require explicit `deviceId`, `devicePublicKey`, and `deviceProofSignature` on every auth (disables compatibility fallback) |

For one-off diagnostics without enabling global debug mode, call:

```bash
curl "http://127.0.0.1:9320/health?debug=1"
```

### Workspace Layout

- Managed spaces default to the gateway-managed Documents root.
- Repo-bound spaces keep project metadata in `.space/` inside the bound folder/repo.
- There is no compatibility path for `.spaces/` metadata. Embedded macOS gateways default managed spaces to `~/Documents/Spaces`, while external or non-macOS hosts fall back to their configured `spacesRoot` or a root derived from the DB location when unset.

## Packages

The reference gateway is a monorepo of focused packages:

| Package | Description |
|---------|-------------|
| `@spaceskit/core` | Protocol types — spaces, profiles, feedback, capabilities, events, security |
| `@spaceskit/gateway-core` | Default-deny gateway runtime profile + capability grant engine (`embedded` / `external`) |
| `@spaceskit/server` | WebSocket server via `Bun.serve()` and typed message protocol |
| `@spaceskit/persistence` | SQLite via `bun:sqlite`, migrations, and repositories |
| `@spaceskit/policy` | Entitlement enforcement and budget tracking |
| `@spaceskit/observability` | Structured JSON logging |
| `@spaceskit/contracts` | Generated TypeScript types from protobuf definitions |
| `@spaceskit/provider-runtime` | Native runtime adapters for cloud APIs, CLI executors, and local runtimes |
| `@spaceskit/mcp-ai-sdk` | Isolated MCP bridge backed by `@ai-sdk/mcp` |
| `@spaceskit/bootstrap` | Gateway entry point — wires everything together |

### Gateway Core Profiles

The gateway can run with an App Store-safe embedded profile or an external developer profile. Both are default-deny and only open capabilities after explicit user grants. See [docs/gateway-core.md](docs/gateway-core.md).

Example startup grants:

```bash
SPACESKIT_GATEWAY_CAPABILITY_GRANTS=calendar.read,lists.read,files.read,speech.execute,model.inference \
bun run dev:embedded
```

Runtime grant APIs (WebSocket message types):

- `gateway.list_capability_grants`
- `gateway.grant_capability`
- `gateway.revoke_capability`

Principal/device-scoped grants are enforced for both direct `capability.invoke` calls and authenticated turn execution (`execute_turn`, including speech auto-submit turns started by authenticated clients).

### Why Bun

The reference gateway uses [Bun](https://bun.sh) as its runtime: native TypeScript execution, built-in WebSocket server, built-in SQLite, fast startup. One dependency fewer is one thing fewer that can break.

### Runtime Adapters

The gateway now uses native runtime adapters instead of routing execution through a general AI SDK package. Bootstrap classifies integrations into three families:

- Cloud APIs: `anthropic`, `openai`, `openrouter`, `groq`, `together`, `mistral`
- Executor runtimes: `claude`, `claude-agent-sdk`, `codex`, `gemini`
- Local runtimes: `apple`, `lmstudio`, `ollama`

Important runtime notes:

- OpenAI-compatible runtimes use direct HTTP calls to `/v1/chat/completions` and `/v1/models`.
- CLI executors are launched as native processes, not as provider-model shims.
- `claude-agent-sdk` runs through the bundled Anthropic Agent SDK and consumes gateway tools over the MCP bridge instead of via the native structured-tool loop.
- Gateway admin model discovery now includes `gateway.list_available_models` and local-agent discovery can return detected model IDs (`availableModels`) for model pickers.
- In `embedded` profile, custom runtime endpoints and local profile provisioning are rejected with `FAILED_PRECONDITION` (App Store-safe policy boundary).

### MCP Support

The gateway bridges [MCP servers](https://modelcontextprotocol.io/) into its capability registry via `@ai-sdk/mcp`. Any MCP server's tools become available to agents in any space.

### Connectors

Connectors integrate external services (messaging platforms, native OS frameworks, APIs) into the Spaces runtime. Each connector belongs to a **connector family** and can have instances with bindings that route events to spaces and agents.

- **Capability connectors**: Provide tools to agents (Apple Calendar, Reminders, Contacts)
- **Channel connectors**: Messaging channels for inbound/outbound communication (Discord, WhatsApp)
- **CLI tool bundles**: Gateway-managed CLI tools (Jira, Harvest, 1Password) — see `cli-tools/`

Connector families are defined in `@spaceskit/bootstrap` and enforced via space-level security policies (`connector_family:` selectors). See [`connectors/`](connectors/) for the full guide on creating new connectors.

## Key Concepts

**Spaces** are structured environments where agents coordinate. Each space has a goal, a turn model, assigned agents, and a security policy. Spaces are not chat rooms — they have rules.

**Profiles** define who an agent *is* — personality prompt, default skills/actions, model preferences, and security posture. Profiles are versioned and grow through personality insights generated from experiences. They are the agent's passport across spaces and gateways.

**Experiences** are structured reflections produced when spaces complete. They capture what worked, what didn't, and propose profile changes for the agents involved.

**Skills** are declarative `.md` files injected into agent context. **Actions** are executable procedures with ordered steps.

**Feedback** is the human-in-the-loop protocol. When agents hit boundaries (permissions, budget, security, ambiguity), the protocol defines a structured pause-and-ask flow.

**Capabilities** are abstract actions (lists, calendar, speech, MCP, etc.) with pluggable providers.

**Turn models** control how multiple agents interact: sequential, round-robin, parallel race, debate + synthesis, and more.

## Client SDKs

Client libraries for connecting to the gateway from native apps and services.

| SDK | Location | Platforms |
|-----|----------|-----------|
| **TypeScript** | `packages/core/src/client/` | Node 20+, Bun, browsers |
| **Swift** | `../client-swift/` | macOS 14+, iOS 17+, watchOS 10+, visionOS 1+ |

Both SDKs implement the core WebSocket protocol: connect, Ed25519 challenge-response auth, execute turns, subscribe to spaces, stream events, and auto-reconnect.

The TypeScript SDK also includes an adapter-focused wrapper. In practice, the native adapter is just another authenticated WebSocket client with `clientType: "adapter"`.

### TypeScript Client

```typescript
import { GatewayClient, generateAuthKeyPair } from "@spaceskit/client";

const keyPair = await generateAuthKeyPair();
const client = new GatewayClient({ url: "ws://localhost:9320" });
client.setAuthKeyPair(keyPair);
await client.connect();

const result = await client.executeTurn("my-space", "Hello!");
client.onTurnStream((stream) => process.stdout.write(stream.delta));
```

### TypeScript Adapter Client

```typescript
import { GatewayAdapterClient, generateAuthKeyPair } from "@spaceskit/client";

const keyPair = await generateAuthKeyPair();
const adapter = new GatewayAdapterClient({
  url: "ws://localhost:9320",
  authKeyPair: keyPair,
});

await adapter.registerProvider({
  provider: {
    id: "apple-reminders",
    name: "Apple Reminders",
    source: "adapter",
    capabilityType: "lists",
    operations: ["getItems", "createItem"],
  },
  handlers: {
    async getItems(args) {
      // Bridge to native API (EventKit/Reminders/etc.)
      return [];
    },
    async createItem(args) {
      return { ok: true };
    },
  },
});

await adapter.connect();
```

Adapter message flow (implemented):

1. Adapter sends `capabilities.register` (or `capabilities.deregister`).
2. Gateway invokes provider operations with `capability.invoke`.
3. Adapter responds with `capability.result` or `capability.error`.
4. On adapter disconnect, the gateway deregisters that client's providers.

Runnable TypeScript connection examples live in `../client-ts/examples/`:

```bash
bun run example:client
bun run example:adapter
```

### Swift Client

```swift
import SpaceskitClient

let keyPair = AuthKeyPair()
let client = GatewayClient(options: .init(
    url: URL(string: "ws://localhost:9320")!,
    authKeyPair: keyPair
))

try await client.connect()
let result = try await client.executeTurn(spaceId: "my-space", input: "Hello!")

for await event in client.events {
    if case .turnStream(let stream) = event {
        print(stream.delta, terminator: "")
    }
}
```

Add via Swift Package Manager:

```swift
.package(url: "https://github.com/your-org/spaceskit-gateway", from: "1.0.0")
```

### Protocol Sync (Codegen)

`proto/` is the canonical contract source of truth. `packages/server/src/protocol.ts` remains a handwritten WebSocket transport layer only; the repo no longer generates Swift shim types or fixture suites from it.

```bash
# Regenerate proto-derived TypeScript contracts
cd ../proto && buf generate

# Verify the generated TS contract output is clean
cd ../gateway && bun run contract-gate

# On macOS: run the Swift package tests
cd ../client-swift && swift test
```

**How it works:** `buf` generates the canonical protobuf contracts into `@spaceskit/contracts`. The handwritten TS and Swift WebSocket transports are expected to stay aligned with the gateway/runtime behavior directly; there is no parallel shim-generation pipeline anymore.

**Workflow when changing the protocol:**

1. Edit the canonical protobuf contract in `../proto/proto/spaceskit/v2/*.proto`
2. Run `cd ../proto && buf generate`
3. Update `packages/server/src/protocol.ts`, `client-ts`, or `client-swift` only when the handwritten WebSocket transport must expose or map the new contract shape
4. Run `cd ../gateway && bun run contract-gate`
5. Run `swift test` in `../client-swift` on macOS

## Contracts (Proto)

The `proto/` directory is the canonical protocol contract. It currently contains 16 protobuf definitions (15 services + shared core messages):

- `common.proto` — Core messages, spaces, participants, runtime ledger, integrations, approvals, usage
- `gateway_service.proto` — Gateway administration and integration management
- `profile_service.proto` — Agent identity management (17 RPCs)
- `space_service.proto` — Space lifecycle, collaboration sharing, and agent provisioning (18 RPCs)
- `coordinator_service.proto` — Turn orchestration and feedback (7 RPCs)
- `runtime_service.proto` — Runs, run steps, artifacts, and approval resolution
- `integration_service.proto` — Integration catalog and request intake
- `skill_service.proto` — Skills and actions management (11 RPCs)
- `experience_service.proto` — Experience lifecycle (6 RPCs)
- `capability_service.proto` — Capability registry (5 RPCs)
- `event_stream.proto` — Real-time event streaming (38 event types)
- `health_service.proto` — System health monitoring (2 RPCs)
- `sync_service.proto` — Gateway-to-gateway sync (3 RPCs)
- `scheduler_service.proto` — Scheduled actions and linked spaces
- `speech_service.proto` — Voice routing
- `usage_service.proto` — Usage tracking

Generate TypeScript types with:

```bash
cd ../proto && buf generate
```

## Project Status

MVP-ready. The full coordination runtime, persistence, middleware pipeline, security (Ed25519 auth, secrets detection, budget enforcement), memory providers, and client SDKs are implemented and typechecking clean across all 8 packages. See [`STATUS.md`](STATUS.md) for the full readiness matrix.

Post-MVP modules (load testing, multi-gateway sync, GDPR/data retention, analytics) are stubbed with interfaces preserved for forward compatibility. Framework adapters (CrewAI, AutoGen) are the next milestone.

## Contributing

Contributions are welcome. If the manifesto resonates with how you think about multi-agent coordination, you'll probably feel at home here.

## License

MIT — see [LICENSE](LICENSE).
