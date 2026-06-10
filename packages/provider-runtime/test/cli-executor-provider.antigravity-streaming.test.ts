import { describe, expect, test } from "bun:test";
import { CliExecutorModelProvider } from "../src/cli-executor-provider.js";
import { collectChunks } from "./cli-executor-provider-test-helpers.js";

describe("CliExecutorModelProvider Antigravity streaming", () => {
  test("streams plain text output with estimated usage", async () => {
    let seenSpec:
      | {
        executable: string;
        args: string[];
        stdin?: string;
        cwd?: string;
      }
      | undefined;

    const provider = new CliExecutorModelProvider({
      id: "antigravity",
      name: "Antigravity CLI",
      model: "antigravity/selected",
      runCommandStream: (spec) => ({
        async *[Symbol.asyncIterator]() {
          seenSpec = spec;
          yield { type: "stdout" as const, chunk: "Hello " };
          yield { type: "stdout" as const, chunk: "world\n" };
          yield { type: "exit" as const, exitCode: 0 };
        },
      }),
    });

    const chunks = await collectChunks(provider.stream("antigravity/selected", {
      messages: [{ role: "user", content: "Greet the workspace." }],
      workingDirectory: "/tmp/antigravity-space",
    }));

    expect(seenSpec).toEqual({
      executable: "agy",
      args: [
        "--print",
        "--sandbox",
        "--add-dir",
        "/tmp/antigravity-space",
        "USER:\nGreet the workspace.",
      ],
      cwd: "/tmp/antigravity-space",
    });
    expect(chunks).toEqual([
      { type: "text_delta", text: "Hello " },
      { type: "text_delta", text: "world\n" },
      {
        type: "finish",
        finishReason: "stop",
        usage: expect.objectContaining({
          tokenAccuracy: "estimated",
          usageSource: "ledger",
        }),
      },
    ]);
  });
});
