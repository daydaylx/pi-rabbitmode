import assert from "node:assert/strict";
import { test } from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createRabbitRunController } from "../src/orchestration/run-controller.ts";
import { createWorkflowSessionHolder } from "../src/orchestration/workflow-session-holder.ts";
import { registerRabbitSupervisorTools } from "../src/orchestration/supervisor-tools.ts";
import { createRabbitState } from "../src/rabbit/state.ts";
import {
  createFakeCommandContext,
  createFakeDynamicRoleRegistry,
  createFakeExtensionApi,
  createFakeSubagentRpcClient,
  fakeModelSupportingMax,
} from "./support/fakes.ts";

type ToolResult = {
  content: Array<{ type: string; text: string }>;
  details: unknown;
};
type InvokableTool = {
  execute(
    toolCallId: string,
    params: unknown,
    signal: AbortSignal | undefined,
    onUpdate: unknown,
    context: unknown,
  ): Promise<ToolResult>;
};

function setup() {
  const api = createFakeExtensionApi();
  const runController = createRabbitRunController();
  const state = createRabbitState(
    api as unknown as ExtensionAPI,
    runController,
  );
  const rpc = createFakeSubagentRpcClient();
  const dynamicRoles = createFakeDynamicRoleRegistry();
  const workflowSessions = createWorkflowSessionHolder();
  registerRabbitSupervisorTools(api as unknown as ExtensionAPI, {
    state,
    rpc: rpc as never,
    dynamicRoles: dynamicRoles as never,
    workflowSessions,
    runController,
  });
  const { ctx } = createFakeCommandContext({ model: fakeModelSupportingMax() });
  state.activate(ctx as never);
  return {
    api,
    state,
    rpc,
    dynamicRoles,
    workflowSessions,
    runController,
    ctx,
  };
}

function tool(
  api: ReturnType<typeof createFakeExtensionApi>,
  name: string,
): InvokableTool {
  const registered = api.tools.get(name);
  assert.ok(registered, `${name} should be registered`);
  return registered as InvokableTool;
}

const initialSteps = [
  { id: "inspect", role: "verifier", task: "Inspect the relevant code." },
  { id: "audit", role: "recovery-auditor", task: "Independently check failure modes." },
  {
    id: "synthesis",
    role: "verifier",
    task: "Synthesize the verified findings and uncertainties.",
    dependsOn: ["inspect", "audit"],
    kind: "synthesis",
  },
];

test("registers the three Main Agent supervisor tools and runs a MAX-pinned synthesis DAG", async () => {
  const { api, rpc, runController, ctx } = setup();
  assert.deepEqual([...api.tools.keys()].sort(), [
    "rabbit_define_role",
    "rabbit_replan",
    "rabbit_workflow",
  ]);

  const result = await tool(api, "rabbit_workflow").execute(
    "call-1",
    { steps: initialSteps },
    undefined,
    undefined,
    ctx,
  );

  assert.match(
    result.content[0]?.text ?? "",
    /Rabbit workflow outcome: complete/,
  );
  assert.equal(runController.snapshot().phase, "completed");
  const spawns = rpc.spawnCalls as Array<{ model?: string }>;
  assert.equal(spawns.length, 3);
  assert.ok(spawns.every((spawn) => spawn.model === "test/supports-max:max"));
});

test("aborting the Main Agent workflow stops its active child and settles the run", async () => {
  const api = createFakeExtensionApi();
  const runController = createRabbitRunController();
  const state = createRabbitState(
    api as unknown as ExtensionAPI,
    runController,
  );
  const dynamicRoles = createFakeDynamicRoleRegistry();
  const workflowSessions = createWorkflowSessionHolder();
  let notifyStatusRequested!: () => void;
  let resolveStatus:
    | ((reply: {
        version: 1;
        requestId: string;
        success: true;
        data: object;
      }) => void)
    | undefined;
  let stopCalls = 0;
  const statusRequested = new Promise<void>((resolve) => {
    notifyStatusRequested = resolve;
  });
  const rpc = {
    call: async (method: string) => {
      if (method === "spawn") {
        return {
          version: 1,
          requestId: "spawn",
          success: true,
          data: { text: "started", details: { runId: "abort-child" } },
        };
      }
      if (method === "status") {
        notifyStatusRequested();
        return new Promise((resolve) => {
          resolveStatus = resolve;
        });
      }
      if (method === "stop") {
        stopCalls += 1;
        resolveStatus?.({
          version: 1,
          requestId: "status",
          success: true,
          data: { state: "stopped" },
        });
        return { version: 1, requestId: "stop", success: true, data: {} };
      }
      throw new Error(`unexpected RPC method ${method}`);
    },
    ping: async () => ({
      version: 1,
      requestId: "ping",
      success: true,
      data: {},
    }),
  };
  registerRabbitSupervisorTools(api as unknown as ExtensionAPI, {
    state,
    rpc: rpc as never,
    dynamicRoles: dynamicRoles as never,
    workflowSessions,
    runController,
  });
  const { ctx } = createFakeCommandContext({ model: fakeModelSupportingMax() });
  state.activate(ctx as never);
  const abortController = new AbortController();
  const run = tool(api, "rabbit_workflow").execute(
    "call-abort",
    {
      steps: [
        { id: "inspect", role: "verifier", task: "Inspect." },
        {
          id: "synthesis",
          role: "verifier",
          task: "Synthesize.",
          dependsOn: ["inspect"],
          kind: "synthesis",
        },
      ],
    },
    abortController.signal,
    undefined,
    ctx,
  );
  await statusRequested;
  abortController.abort();
  const result = await run;

  assert.match(
    result.content[0]?.text ?? "",
    /Rabbit workflow outcome: cancelled/,
  );
  assert.equal(stopCalls, 1);
  assert.equal(runController.isActive(), false);
});

test("rejects a workflow without a dependent terminal synthesis before any spawn", async () => {
  const { api, rpc, ctx } = setup();
  await assert.rejects(
    tool(api, "rabbit_workflow").execute(
      "call-2",
      { steps: [{ id: "inspect", role: "verifier", task: "Inspect." }] },
      undefined,
      undefined,
      ctx,
    ),
    /exactly one|genau einen|synthesis/,
  );
  assert.equal((rpc.spawnCalls as unknown[]).length, 0);
});

test("a session-local dynamic role can be defined and then used in a workflow", async () => {
  const { api, dynamicRoles, rpc, ctx } = setup();
  const defined = await tool(api, "rabbit_define_role").execute(
    "call-define",
    {
      id: "api-checker",
      purpose: "Check API behavior",
      instructions: "Read code and report evidence.",
      tools: ["read"],
    },
    undefined,
    undefined,
    ctx,
  );
  assert.match(defined.content[0]?.text ?? "", /rabbit-dynamic\.api-checker/);

  const result = await tool(api, "rabbit_workflow").execute(
    "call-dynamic-workflow",
    {
      steps: [
        {
          id: "check",
          role: "rabbit-dynamic.api-checker",
          task: "Check the public contract.",
        },
        {
          id: "synthesis",
          role: "verifier",
          task: "Summarize the contract check.",
          dependsOn: ["check"],
          kind: "synthesis",
        },
      ],
    },
    undefined,
    undefined,
    ctx,
  );
  assert.match(
    result.content[0]?.text ?? "",
    /Rabbit workflow outcome: complete/,
  );
  assert.equal(dynamicRoles.size(), 1);
  assert.equal(
    (rpc.spawnCalls as Array<{ agent?: string }>)[0]?.agent,
    "rabbit-dynamic.api-checker",
  );
});

test("replanning requires a concrete reason and a new synthesis step", async () => {
  const { api, ctx } = setup();
  await tool(api, "rabbit_workflow").execute(
    "call-start",
    { steps: initialSteps },
    undefined,
    undefined,
    ctx,
  );
  await assert.rejects(
    tool(api, "rabbit_replan").execute(
      "call-replan",
      {
        reason: "New evidence requires a targeted check.",
        steps: [
          { id: "new-check", role: "recovery-auditor", task: "Check the new finding." },
        ],
      },
      undefined,
      undefined,
      ctx,
    ),
    /synthesis|Synthese/,
  );
});

test("replanning caps the session at three revisions", async () => {
  const { api, ctx, workflowSessions } = setup();
  await tool(api, "rabbit_workflow").execute(
    "call-start",
    { steps: initialSteps },
    undefined,
    undefined,
    ctx,
  );
  const validRevision = (suffix: number) => [
    { id: `check-${suffix}`, role: "recovery-auditor", task: "Check a new finding." },
    {
      id: `synthesis-${suffix}`,
      role: "verifier",
      task: "Revise the overall synthesis.",
      dependsOn: ["inspect", `check-${suffix}`],
      kind: "synthesis",
    },
  ];
  await tool(api, "rabbit_replan").execute(
    "call-replan-2",
    { reason: "First new finding.", steps: validRevision(2) },
    undefined,
    undefined,
    ctx,
  );
  await tool(api, "rabbit_replan").execute(
    "call-replan-3",
    { reason: "Second new finding.", steps: validRevision(3) },
    undefined,
    undefined,
    ctx,
  );
  assert.equal(workflowSessions.current()?.currentRevision(), 3);
  const capped = await tool(api, "rabbit_replan").execute(
    "call-replan-4",
    { reason: "Third new finding.", steps: validRevision(4) },
    undefined,
    undefined,
    ctx,
  );
  assert.match(capped.content[0]?.text ?? "", /maximal 3 Revisionen/);
});
