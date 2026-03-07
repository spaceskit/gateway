import { describe, test, expect } from "bun:test";
import {
  validateConnectorSelector,
  getSchemaForFamily,
  SELECTOR_SCHEMAS,
} from "../../src/capabilities/selector-schema.js";

describe("getSchemaForFamily", () => {
  test("returns schema for messaging", () => {
    const schema = getSchemaForFamily("messaging");
    expect(schema).toBeDefined();
    expect(schema!.family).toBe("messaging");
  });

  test("returns undefined for unknown family", () => {
    expect(getSchemaForFamily("unknown")).toBeUndefined();
  });

  test("generic family has empty fields", () => {
    const schema = getSchemaForFamily("generic");
    expect(schema).toBeDefined();
    expect(schema!.fields).toHaveLength(0);
  });
});

describe("validateConnectorSelector", () => {
  test("valid messaging selector passes", () => {
    const result = validateConnectorSelector("messaging", {
      accountId: "acct-1",
      chatId: "chat-1",
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test("missing required field fails", () => {
    const result = validateConnectorSelector("messaging", {
      chatId: "chat-1",
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Missing required field: accountId");
  });

  test("unknown key for known family fails", () => {
    const result = validateConnectorSelector("messaging", {
      accountId: "acct-1",
      unknownField: "value",
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("Unknown selector key"))).toBe(true);
  });

  test("unknown family allows anything", () => {
    const result = validateConnectorSelector("custom-family", {
      anyKey: "anyValue",
    });
    expect(result.valid).toBe(true);
  });

  test("generic family allows anything", () => {
    const result = validateConnectorSelector("generic", {
      foo: "bar",
      baz: 123,
    });
    expect(result.valid).toBe(true);
  });

  test("calendar requires accountId", () => {
    const result = validateConnectorSelector("calendar", {});
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Missing required field: accountId");
  });

  test("storage valid selector passes", () => {
    const result = validateConnectorSelector("storage", {
      accountId: "s3-acct",
      bucketId: "my-bucket",
    });
    expect(result.valid).toBe(true);
  });

  test("empty selector for messaging fails (accountId required)", () => {
    const result = validateConnectorSelector("messaging", {});
    expect(result.valid).toBe(false);
  });

  test("multiple errors reported", () => {
    const result = validateConnectorSelector("messaging", {
      unknownA: 1,
      unknownB: 2,
    });
    expect(result.valid).toBe(false);
    // Missing accountId + 2 unknown keys = 3 errors
    expect(result.errors.length).toBeGreaterThanOrEqual(3);
  });
});
