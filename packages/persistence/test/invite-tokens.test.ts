import { afterEach, describe, expect, test } from "bun:test";
import { initDatabase } from "../src/database.js";
import { InviteTokenRepository } from "../src/repositories/invite-tokens.js";

const dbManagers: ReturnType<typeof initDatabase>[] = [];

afterEach(() => {
  while (dbManagers.length > 0) {
    dbManagers.pop()?.close();
  }
});

function createInMemory() {
  const db = initDatabase({
    path: ":memory:",
    runtimeGeneration: `test-invite-tokens-${crypto.randomUUID()}`,
  });
  dbManagers.push(db);
  return db;
}

describe("InviteTokenRepository", () => {
  test("creates and retrieves a token by id and signed token", () => {
    const db = createInMemory();
    const repo = new InviteTokenRepository(db.db);

    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    const created = repo.create({
      tokenId: "tok-1",
      spaceId: "space-1",
      signedToken: "signed-1",
      mode: "collaborator",
      signingKid: "invite-kid-1",
      expiresAt,
      issuedByPrincipalId: "principal-a",
    });

    expect(created.token_id).toBe("tok-1");
    expect(created.consumed_at).toBeNull();
    expect(created.expires_at).toBe(expiresAt);

    const byId = repo.getByTokenId("tok-1");
    expect(byId?.signed_token).toBe("signed-1");
    expect(byId?.issued_by_principal_id).toBe("principal-a");

    const bySigned = repo.getBySignedToken("signed-1");
    expect(bySigned?.token_id).toBe("tok-1");
  });

  test("consumeOnce is atomic — second attempt returns false", () => {
    const db = createInMemory();
    const repo = new InviteTokenRepository(db.db);

    repo.create({
      tokenId: "tok-2",
      spaceId: "space-2",
      signedToken: "signed-2",
      mode: "read_only",
      signingKid: "invite-kid-1",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });

    const first = repo.consumeOnce("tok-2");
    expect(first).toBe(true);

    const row = repo.getByTokenId("tok-2");
    expect(row?.consumed_at).not.toBeNull();

    const second = repo.consumeOnce("tok-2");
    expect(second).toBe(false);

    const missing = repo.consumeOnce("tok-does-not-exist");
    expect(missing).toBe(false);
  });

  test("listBySpace returns invites ordered most-recent-first", () => {
    const db = createInMemory();
    const repo = new InviteTokenRepository(db.db);

    repo.create({
      tokenId: "tok-A",
      spaceId: "space-3",
      signedToken: "signed-A",
      mode: "read_only",
      signingKid: "invite-kid-1",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    repo.create({
      tokenId: "tok-B",
      spaceId: "space-3",
      signedToken: "signed-B",
      mode: "collaborator",
      signingKid: "invite-kid-1",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    repo.create({
      tokenId: "tok-C",
      spaceId: "space-other",
      signedToken: "signed-C",
      mode: "read_only",
      signingKid: "invite-kid-1",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });

    const rows = repo.listBySpace("space-3");
    expect(rows.length).toBe(2);
    expect(rows.map((r) => r.token_id).sort()).toEqual(["tok-A", "tok-B"]);
  });

  test("deleteExpired removes only expired and unconsumed tokens", () => {
    const db = createInMemory();
    const repo = new InviteTokenRepository(db.db);

    const expired = new Date(Date.now() - 60_000).toISOString();
    const future = new Date(Date.now() + 60_000).toISOString();

    repo.create({
      tokenId: "tok-expired",
      spaceId: "space-x",
      signedToken: "signed-expired",
      mode: "read_only",
      signingKid: "invite-kid-1",
      expiresAt: expired,
    });
    repo.create({
      tokenId: "tok-future",
      spaceId: "space-x",
      signedToken: "signed-future",
      mode: "read_only",
      signingKid: "invite-kid-1",
      expiresAt: future,
    });
    repo.create({
      tokenId: "tok-consumed-expired",
      spaceId: "space-x",
      signedToken: "signed-cx",
      mode: "read_only",
      signingKid: "invite-kid-1",
      expiresAt: expired,
    });
    repo.consumeOnce("tok-consumed-expired");

    const deleted = repo.deleteExpired();
    expect(deleted).toBe(1);
    expect(repo.getByTokenId("tok-expired")).toBeUndefined();
    expect(repo.getByTokenId("tok-future")).toBeDefined();
    expect(repo.getByTokenId("tok-consumed-expired")).toBeDefined();
  });
});
