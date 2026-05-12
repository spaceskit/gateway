import { describe, expect, test } from "bun:test";
import { MessageTypes } from "../src/protocol.js";
import { makeClient, makeMessage, makeRouter } from "./message-router-test-helpers.js";

describe("MessageRouter gateway admin reset / secrets / kb handlers", () => {
  test("returns NOT_AVAILABLE when gateway reset service is not configured", async () => {
    const router = makeRouter({});
    const msg = makeMessage(MessageTypes.GATEWAY_FACTORY_RESET, {
      confirmation: "DELETE resource:main",
    });
    const response = await router.handle(makeClient(), msg);

    expect(response?.type).toBe(MessageTypes.ERROR);
    expect((response?.payload as any).code).toBe("FAILED_PRECONDITION");
  });

  test("validates missing and blank confirmation for gateway.factory_reset", async () => {
    let calls = 0;
    const router = makeRouter(
      {},
      undefined,
      {
        factoryResetGateway: async () => {
          calls += 1;
          return {
            gatewayId: "resource:main",
            gatewayUuid: "11111111-2222-3333-4444-555555555555",
            resetAt: new Date().toISOString(),
            tablesCleared: 1,
            rowsDeleted: 1,
          };
        },
      },
    );

    const invalidMessages = [
      makeMessage(MessageTypes.GATEWAY_FACTORY_RESET, {}),
      makeMessage(MessageTypes.GATEWAY_FACTORY_RESET, { confirmation: "   " }),
    ];

    for (const msg of invalidMessages) {
      const response = await router.handle(makeClient({ publicKey: "principal-1" }), msg);
      expect(response?.type).toBe(MessageTypes.ERROR);
      expect((response?.payload as any).code).toBe("INVALID_ARGUMENT");
    }

    expect(calls).toBe(0);
  });

  test("routes gateway.factory_reset", async () => {
    let received: any = null;
    const router = makeRouter(
      {},
      undefined,
      {
        factoryResetGateway: async (input: any) => {
          received = input;
          return {
            gatewayId: "resource:main",
            gatewayUuid: "11111111-2222-3333-4444-555555555555",
            resetAt: "2026-02-27T10:00:00.000Z",
            tablesCleared: 12,
            rowsDeleted: 77,
          };
        },
      },
    );

    const msg = makeMessage(MessageTypes.GATEWAY_FACTORY_RESET, {
      confirmation: "DELETE resource:main",
      apiVersion: "v1",
    });
    const response = await router.handle(
      makeClient({ publicKey: "principal-1", deviceId: "device-1" }),
      msg,
    );

    expect(response?.type).toBe(MessageTypes.GATEWAY_FACTORY_RESET);
    expect(received).toEqual({
      apiVersion: "v1",
      confirmation: "DELETE resource:main",
      requestedBy: "principal-1",
      requestedDeviceId: "device-1",
    });
    expect((response?.payload as any).gatewayId).toBe("resource:main");
    expect((response?.payload as any).rowsDeleted).toBe(77);
  });

  test("validates localClientId for gateway.provision_local_profile", async () => {
    const router = makeRouter({
      provisionLocalProfile: async () => ({
        profileId: "local-claude-profile",
        profileName: "Claude Agent",
        created: true,
        providerId: "anthropic",
        model: "anthropic/claude-sonnet-4-5",
      }),
    });

    const msg = makeMessage(MessageTypes.GATEWAY_PROVISION_LOCAL_PROFILE, {
      profileId: "local-claude-profile",
    });
    const response = await router.handle(makeClient(), msg);

    expect(response?.type).toBe(MessageTypes.ERROR);
    expect((response?.payload as any).code).toBe("INVALID_ARGUMENT");
  });

  test("routes gateway.provision_local_profile", async () => {
    let received: any = null;
    const router = makeRouter({
      provisionLocalProfile: async (input: any) => {
        received = input;
        return {
          profileId: "local-claude-profile",
          profileName: "Claude Agent",
          created: true,
          providerId: "anthropic",
          model: "anthropic/claude-sonnet-4-5",
          agentId: "claude-agent",
          assignmentCreated: true,
        };
      },
    });

    const msg = makeMessage(MessageTypes.GATEWAY_PROVISION_LOCAL_PROFILE, {
      localClientId: "claude",
      profileId: "local-claude-profile",
      agentId: "claude-agent",
      spaceId: "main-space",
    });
    const response = await router.handle(makeClient(), msg);

    expect(response?.type).toBe(MessageTypes.GATEWAY_PROVISION_LOCAL_PROFILE);
    expect(received.localClientId).toBe("claude");
    expect((response?.payload as any).assignmentCreated).toBe(true);
  });

  test("validates providerId and secret for gateway.put_secret_ref", async () => {
    const router = makeRouter({
      putSecretRef: () => ({
        secretRef: {
          secretRef: "secretref-openai-primary",
          providerId: "openai",
          label: "OpenAI Primary",
          backend: "gateway_encrypted",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        created: true,
      }),
    });

    const msg = makeMessage(MessageTypes.GATEWAY_PUT_SECRET_REF, {
      providerId: "openai",
    });
    const response = await router.handle(makeClient(), msg);

    expect(response?.type).toBe(MessageTypes.ERROR);
    expect((response?.payload as any).code).toBe("INVALID_ARGUMENT");
  });

  test("routes gateway.put_secret_ref", async () => {
    let received: any = null;
    const router = makeRouter({
      putSecretRef: (input: any) => {
        received = input;
        return {
          secretRef: {
            secretRef: "secretref-openai-primary",
            providerId: "openai",
            label: "OpenAI Primary",
            backend: "gateway_encrypted",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          created: true,
        };
      },
    });

    const msg = makeMessage(MessageTypes.GATEWAY_PUT_SECRET_REF, {
      providerId: "openai",
      label: "OpenAI Primary",
      secret: "sk-test",
    });
    const response = await router.handle(makeClient(), msg);

    expect(response?.type).toBe(MessageTypes.GATEWAY_PUT_SECRET_REF);
    expect(received.secret).toBe("sk-test");
    expect((response?.payload as any).created).toBe(true);
    expect((response?.payload as any).secretRef.secretRef).toBe("secretref-openai-primary");
  });

  test("routes gateway.list_secret_refs", async () => {
    let receivedProviderId: string | undefined;
    const router = makeRouter({
      listSecretRefs: (providerId?: string) => {
        receivedProviderId = providerId;
        return [
          {
            secretRef: "secretref-openai-primary",
            providerId: "openai",
            label: "OpenAI Primary",
            backend: "gateway_encrypted",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ];
      },
    });

    const msg = makeMessage(MessageTypes.GATEWAY_LIST_SECRET_REFS, {
      providerId: "openai",
    });
    const response = await router.handle(makeClient(), msg);

    expect(response?.type).toBe(MessageTypes.GATEWAY_LIST_SECRET_REFS);
    expect(receivedProviderId).toBe("openai");
    expect((response?.payload as any).secretRefs.length).toBe(1);
  });

  test("validates secretRef for gateway.delete_secret_ref", async () => {
    const router = makeRouter({
      deleteSecretRef: () => true,
    });

    const msg = makeMessage(MessageTypes.GATEWAY_DELETE_SECRET_REF, {});
    const response = await router.handle(makeClient(), msg);

    expect(response?.type).toBe(MessageTypes.ERROR);
    expect((response?.payload as any).code).toBe("INVALID_ARGUMENT");
  });

  test("routes gateway.delete_secret_ref", async () => {
    const deleted: string[] = [];
    const router = makeRouter({
      deleteSecretRef: (secretRef: string) => {
        deleted.push(secretRef);
        return true;
      },
    });

    const msg = makeMessage(MessageTypes.GATEWAY_DELETE_SECRET_REF, {
      secretRef: "secretref-openai-primary",
    });
    const response = await router.handle(makeClient(), msg);

    expect(response?.type).toBe(MessageTypes.GATEWAY_DELETE_SECRET_REF);
    expect(deleted).toEqual(["secretref-openai-primary"]);
    expect((response?.payload as any).deleted).toBe(true);
  });

  test("returns FAILED_PRECONDITION when knowledge base service is not configured", async () => {
    const router = makeRouter({});
    const msg = makeMessage(MessageTypes.GATEWAY_KB_LIST_ENTRIES, {});
    const response = await router.handle(makeClient(), msg);

    expect(response?.type).toBe(MessageTypes.ERROR);
    expect((response?.payload as any).code).toBe("FAILED_PRECONDITION");
  });

  test("routes gateway.kb_list_entries", async () => {
    let received: any = null;
    const router = makeRouter(
      {},
      {
        listEntries: (input: any) => {
          received = input;
          return [
            {
              entryId: "kb-1",
              name: "Gateway Docs",
              kind: "web",
              uri: "https://example.com/docs",
              tags: ["docs"],
              scopeType: "global",
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          ];
        },
      },
    );

    const msg = makeMessage(MessageTypes.GATEWAY_KB_LIST_ENTRIES, {
      spaceId: "space-1",
      query: "gateway",
      tags: ["docs"],
      kinds: ["web"],
      limit: 25,
    });
    const response = await router.handle(makeClient(), msg);

    expect(response?.type).toBe(MessageTypes.GATEWAY_KB_LIST_ENTRIES);
    expect(received.spaceId).toBe("space-1");
    expect(received.query).toBe("gateway");
    expect(received.limit).toBe(25);
    expect((response?.payload as any).entries.length).toBe(1);
  });

  test("validates required fields for gateway.kb_upsert_entry", async () => {
    const router = makeRouter(
      {},
      {
        upsertEntry: () => ({}),
      },
    );

    const msg = makeMessage(MessageTypes.GATEWAY_KB_UPSERT_ENTRY, {
      name: "Missing fields",
    });
    const response = await router.handle(makeClient(), msg);

    expect(response?.type).toBe(MessageTypes.ERROR);
    expect((response?.payload as any).code).toBe("INVALID_ARGUMENT");
  });

  test("routes gateway.kb_upsert_entry", async () => {
    let received: any = null;
    const router = makeRouter(
      {},
      {
        upsertEntry: (input: any) => {
          received = input;
          return {
            entryId: "kb-2",
            name: input.name,
            kind: input.kind,
            uri: input.uri,
            description: input.description,
            tags: input.tags ?? [],
            scopeType: input.scopeType,
            spaceId: input.spaceId,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
        },
      },
    );

    const msg = makeMessage(MessageTypes.GATEWAY_KB_UPSERT_ENTRY, {
      name: "Space Runbook",
      kind: "file",
      uri: "file:///tmp/runbook.md",
      description: "Runbook",
      tags: ["runbook"],
      scopeType: "space",
      spaceId: "space-a",
    });
    const response = await router.handle(makeClient(), msg);

    expect(response?.type).toBe(MessageTypes.GATEWAY_KB_UPSERT_ENTRY);
    expect(received.scopeType).toBe("space");
    expect(received.spaceId).toBe("space-a");
    expect((response?.payload as any).entry.entryId).toBe("kb-2");
  });

  test("validates entryId for gateway.kb_delete_entry", async () => {
    const router = makeRouter(
      {},
      {
        deleteEntry: () => true,
      },
    );

    const msg = makeMessage(MessageTypes.GATEWAY_KB_DELETE_ENTRY, {});
    const response = await router.handle(makeClient(), msg);

    expect(response?.type).toBe(MessageTypes.ERROR);
    expect((response?.payload as any).code).toBe("INVALID_ARGUMENT");
  });

  test("routes gateway.kb_delete_entry", async () => {
    const deleted: string[] = [];
    const router = makeRouter(
      {},
      {
        deleteEntry: (entryId: string) => {
          deleted.push(entryId);
          return true;
        },
      },
    );

    const msg = makeMessage(MessageTypes.GATEWAY_KB_DELETE_ENTRY, {
      entryId: "kb-3",
    });
    const response = await router.handle(makeClient(), msg);

    expect(response?.type).toBe(MessageTypes.GATEWAY_KB_DELETE_ENTRY);
    expect(deleted).toEqual(["kb-3"]);
    expect((response?.payload as any).deleted).toBe(true);
  });
});
