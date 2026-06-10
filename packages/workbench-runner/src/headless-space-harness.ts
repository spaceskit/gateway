import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { GatewayClient } from "@spaceskit/client";
import { parseHeadlessHarnessArgs } from "./headless-harness-cli.js";
import {
  createAdapterClient,
  createAuthedClient,
  deriveHttpUrlFromWsUrl,
  resolveProvisioningStrategy,
  resolveRuntime,
} from "./headless-harness-runtime.js";
import type {
  HarnessOptions,
  HarnessRunReport,
  HarnessRuntime,
  ProvisioningStrategy,
} from "./headless-harness-types.js";
import { ensureDir, expectString, isRecord, sleep, writeArtifact } from "./headless-harness-utils.js";
import {
  TurnObservationCollector,
  waitForTurnTerminal,
} from "./headless-turn-observation.js";
export {
  deriveHttpUrlFromWsUrl,
  resolveProvisioningStrategy,
  TurnObservationCollector,
};
export type {
  HarnessFlow,
  HarnessMode,
  HarnessOptions,
  HarnessRunReport,
  ProvisioningStrategy,
  TurnObservation,
  TurnStatus,
} from "./headless-harness-types.js";

const REPO_ROOT = resolve(import.meta.dir, "../../../..");
const REMOTE_AGENT_ID = "workbench-remote-agent";
const REMOTE_AGENT_DISPLAY_NAME = "Workbench Remote Agent";
const REMOTE_AGENT_SCRIPT = resolve(
  REPO_ROOT,
  "gateway/packages/workbench-runner/src/mcp-space-agent-server.ts",
);

async function callSpacesAdmin(
  httpUrl: string,
  authorization: string,
  requestBody: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const response = await fetch(`${httpUrl}/mcp/spaces-admin`, {
    method: "POST",
    headers: {
      Authorization: authorization,
      "content-type": "application/json",
    },
    body: JSON.stringify(requestBody),
  });

  const body = await response.json() as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(`spaces-admin request failed (${response.status}): ${JSON.stringify(body)}`);
  }
  return body;
}

function extractToolCallPayload(body: Record<string, unknown>): Record<string, unknown> {
  const result = isRecord(body.result) ? body.result : {};
  const content = Array.isArray(result.content) ? result.content : [];
  const firstText = content
    .filter((entry): entry is Record<string, unknown> => isRecord(entry))
    .map((entry) => entry.text)
    .find((entry): entry is string => typeof entry === "string");

  if (!firstText) {
    throw new Error(`spaces-admin tool response missing text content: ${JSON.stringify(body)}`);
  }

  try {
    return JSON.parse(firstText) as Record<string, unknown>;
  } catch (error) {
    throw new Error(`spaces-admin tool response was not valid JSON: ${String(error)}`);
  }
}

async function createSpaceViaBuiltInAdmin(
  client: GatewayClient,
  httpUrl: string,
  promptSeed: string,
): Promise<Record<string, unknown>> {
  const issued = await client.issueHttpPrincipalToken({ ttlSeconds: 300 });
  const authorization = `${issued.tokenType} ${issued.token}`;

  const listed = await callSpacesAdmin(httpUrl, authorization, {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/list",
  });
  const listTools = isRecord(listed.result) ? listed.result : {};
  const tools = Array.isArray(listTools.tools) ? listTools.tools : [];
  if (!tools.some((tool) => isRecord(tool) && tool.name === "spaces.admin.create_space")) {
    throw new Error("spaces-admin tools/list did not advertise spaces.admin.create_space");
  }

  const toolBody = await callSpacesAdmin(httpUrl, authorization, {
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: {
      name: "spaces.admin.create_space",
      arguments: {
        resourceId: `resource:headless-admin-${crypto.randomUUID().slice(0, 8)}`,
        name: `Headless Admin ${promptSeed}`,
        goal: "Headless built-in MCP admin provisioning",
        spaceId: `headless-admin-space-${crypto.randomUUID().slice(0, 8)}`,
      },
    },
  });

  const payload = extractToolCallPayload(toolBody);
  const nestedResult = isRecord(payload.result) ? payload.result : {};
  const space = isRecord(nestedResult.space) ? nestedResult.space : null;
  if (!space || typeof space.id !== "string") {
    throw new Error(`spaces-admin create_space did not return a space: ${JSON.stringify(payload)}`);
  }
  return space;
}

async function createSpaceViaClientApi(client: GatewayClient, promptSeed: string): Promise<Record<string, unknown>> {
  return await client.createSpace({
    name: `Headless ${promptSeed}`,
    resourceId: `resource:headless-${crypto.randomUUID().slice(0, 8)}`,
    goal: "Headless workbench interaction test",
  }) as unknown as Record<string, unknown>;
}

async function provisionSpace(
  client: GatewayClient,
  httpUrl: string,
  provisioning: ProvisioningStrategy,
  promptSeed: string,
): Promise<Record<string, unknown>> {
  if (provisioning === "built-in-mcp-admin") {
    return createSpaceViaBuiltInAdmin(client, httpUrl, promptSeed);
  }
  return createSpaceViaClientApi(client, promptSeed);
}

async function runChatFlow(
  client: GatewayClient,
  runtime: HarnessRuntime,
  options: HarnessOptions,
): Promise<Record<string, unknown>> {
  const promptSeed = `${options.mode}-${options.provisioning}`;
  const space = await provisionSpace(
    client,
    runtime.httpUrl,
    options.provisioning,
    promptSeed,
  );
  const spaceId = expectString(space.id, "space.id");
  const spaceUid = (typeof space.spaceUid === "string" && space.spaceUid) || spaceId;

  await client.setSpaceMcpEndpoint({
    spaceId,
    transport: "stdio",
    endpoint: "bun",
    args: ["run", REMOTE_AGENT_SCRIPT],
  });

  const configuredEndpoint = await client.getSpaceMcpEndpoint(spaceId);
  const approved = await client.approveSpaceMcpAgent({
    spaceId,
    remoteAgentId: REMOTE_AGENT_ID,
    displayName: REMOTE_AGENT_DISPLAY_NAME,
  });

  const assignments = await client.listAgentAssignments(spaceId);
  const externalAssignment = assignments.find((assignment) => assignment.agentId === approved.assignment.agentId);
  if (!externalAssignment || externalAssignment.runtimeKind !== "external_mcp") {
    throw new Error(`Expected external_mcp assignment after approval: ${JSON.stringify(assignments)}`);
  }

  await client.subscribe([spaceUid]);
  const collector = new TurnObservationCollector(spaceId);
  const unsubEvent = client.onTurnEvent((event) => collector.ingestEvent(event));
  const unsubStream = client.onTurnStream((event) => collector.ingestStream(event));

  try {
    const ack = await client.executeTurn({
      spaceUid,
      input: options.prompt,
      targetAgentId: approved.assignment.agentId,
    });
    collector.bindTurn(ack.turnId);
    const turn = await waitForTurnTerminal(collector, options.timeoutMs);

    if (turn.status !== "completed") {
      throw new Error(`Chat flow ended without completion: ${JSON.stringify(turn)}`);
    }
    if (!turn.finalMessage || !turn.finalMessage.includes(options.prompt)) {
      throw new Error(`Chat flow final message did not echo the prompt: ${JSON.stringify(turn)}`);
    }

    return {
      spaceId,
      spaceUid,
      approvedAgentId: approved.assignment.agentId,
      endpointId: approved.binding.endpointId,
      configuredEndpoint: configuredEndpoint.endpoint ?? null,
      turn,
    };
  } finally {
    unsubEvent();
    unsubStream();
    await client.clearSpaceMcpEndpoint(spaceId).catch(() => undefined);
  }
}

async function runMcpFlow(
  runtime: HarnessRuntime,
  options: HarnessOptions,
): Promise<Record<string, unknown>> {
  const adapter = await createAdapterClient(runtime.wsUrl);
  const client = await createAuthedClient(runtime.wsUrl, "mcp");

  try {
    await sleep(250);

    const echoResult = await client.invokeCapability(
      "lists",
      "echo",
      {
        message: `headless-${options.mode}`,
      },
      "headless.echo",
    );
    const delayResult = await client.invokeCapability(
      "lists",
      "delay",
      {
        ms: 15,
      },
      "headless.echo",
    );

    const echoData = extractCapabilityData(echoResult);
    const delayData = extractCapabilityData(delayResult);

    if (!isRecord(echoData.echoed) || echoData.echoed.message !== `headless-${options.mode}`) {
      throw new Error(`Unexpected echo capability response: ${JSON.stringify(echoResult)}`);
    }
    if (delayData.delayed !== 15) {
      throw new Error(`Unexpected delay capability response: ${JSON.stringify(delayResult)}`);
    }

    return {
      providerId: "headless.echo",
      echoResult,
      delayResult,
    };
  } finally {
    await client.disconnect().catch(() => undefined);
    await adapter.disconnect().catch(() => undefined);
  }
}

function extractCapabilityData(result: unknown): Record<string, unknown> {
  if (isRecord(result) && isRecord(result.data)) {
    return result.data;
  }
  if (isRecord(result)) {
    return result;
  }
  throw new Error(`Capability result was not an object: ${JSON.stringify(result)}`);
}

export async function runHeadlessSpaceHarness(
  options: HarnessOptions,
): Promise<HarnessRunReport> {
  const runtime = await resolveRuntime(options);
  const report: HarnessRunReport = {
    mode: options.mode,
    flow: options.flow,
    provisioning: options.provisioning,
    startedAt: new Date().toISOString(),
    finishedAt: "",
    gateway: {
      wsUrl: runtime.wsUrl,
      httpUrl: runtime.httpUrl,
    },
  };

  let baseClient: GatewayClient | null = null;

  try {
    baseClient = await createAuthedClient(runtime.wsUrl, "base");

    if (options.flow === "chat" || options.flow === "combined") {
      report.chat = await runChatFlow(baseClient, runtime, options);
    }

    if (options.flow === "mcp" || options.flow === "combined") {
      report.mcp = await runMcpFlow(runtime, options);
    }

    report.finishedAt = new Date().toISOString();
    writeArtifact(options.artifactPath, REPO_ROOT, report);
    return report;
  } catch (error) {
    report.finishedAt = new Date().toISOString();
    writeArtifact(options.artifactPath, REPO_ROOT, {
      ...report,
      chat: report.chat,
      mcp: report.mcp,
      error: error instanceof Error ? error.message : String(error),
    } as HarnessRunReport & { error: string });
    throw error;
  } finally {
    await baseClient?.disconnect().catch(() => undefined);
    await runtime.cleanup();
  }
}

export async function runHeadlessSpaceHarnessCli(argv: string[]): Promise<void> {
  const options = parseHeadlessHarnessArgs(argv);
  const report = await runHeadlessSpaceHarness(options);
  console.log(JSON.stringify(report, null, 2));
}
