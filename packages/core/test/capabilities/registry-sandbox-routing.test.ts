import { describe, expect, test } from "bun:test";
import {
  CapabilityDeniedError,
  CapabilityRegistry,
  type CapabilitySandboxInvocationInput,
} from "../../src/capabilities/registry.js";
import { EventBus } from "../../src/events/event-bus.js";

describe("CapabilityRegistry sandbox routing", () => {
  test("invokes sandbox backend when route resolver selects sandbox", async () => {
    const eventBus = new EventBus();
    const registry = new CapabilityRegistry(eventBus);
    const routedEvents: Array<Record<string, unknown>> = [];
    eventBus.on("capability.execution_routed", (event) => routedEvents.push(event));

    let hostInvocations = 0;
    registry.register(
      {
        id: "shell-local",
        name: "Shell Local",
        source: "builtin",
        capabilityType: "shell",
        operations: ["run"],
        available: true,
      },
      {
        invoke: async () => {
          hostInvocations += 1;
          return { host: true };
        },
      },
    );

    const sandboxCalls: CapabilitySandboxInvocationInput[] = [];
    registry.setExecutionRoutingResolver((input) => (
      input.operationMetadata.requiresShell && input.context?.executionOrigin === "guest"
        ? { backend: "sandbox", reason: "guest_shell_requires_sandbox" }
        : { backend: "host" }
    ));
    registry.setSandboxInvoker(async (input) => {
      sandboxCalls.push(input);
      return input.hostInvoke();
    });

    const result = await registry.invoke(
      {
        capability: "shell",
        operation: "run",
        args: { command: "echo test" },
      },
      { executionOrigin: "guest", principalId: "guest-principal" },
    );

    expect("data" in result && result.data).toEqual({ host: true });
    expect(sandboxCalls.length).toBe(1);
    expect(hostInvocations).toBe(1);
    expect(routedEvents.length).toBe(1);
    expect(routedEvents[0].reason).toBe("guest_shell_requires_sandbox");
  });

  test("throws permission denied when sandbox route is required but backend is missing", async () => {
    const registry = new CapabilityRegistry(new EventBus());
    registry.register(
      {
        id: "shell-local",
        name: "Shell Local",
        source: "builtin",
        capabilityType: "shell",
        operations: ["run"],
        available: true,
      },
      { invoke: async () => ({ host: true }) },
    );
    registry.setExecutionRoutingResolver(() => ({
      backend: "sandbox",
      reason: "guest_shell_requires_sandbox",
    }));

    await expect(
      registry.invoke(
        {
          capability: "shell",
          operation: "run",
          args: { command: "echo test" },
        },
        { executionOrigin: "guest" },
      ),
    ).rejects.toBeInstanceOf(CapabilityDeniedError);
  });

  test("uses host backend when route resolver returns host", async () => {
    const registry = new CapabilityRegistry(new EventBus());
    let hostInvocations = 0;
    registry.register(
      {
        id: "notes-local",
        name: "Notes Local",
        source: "builtin",
        capabilityType: "notes",
        operations: ["list"],
        available: true,
      },
      {
        invoke: async () => {
          hostInvocations += 1;
          return { ok: true };
        },
      },
    );
    registry.setExecutionRoutingResolver(() => ({ backend: "host" }));

    const result = await registry.invoke({
      capability: "notes",
      operation: "list",
      args: {},
    });

    expect("data" in result && result.data).toEqual({ ok: true });
    expect(hostInvocations).toBe(1);
  });
});
