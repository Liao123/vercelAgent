import assert from "node:assert/strict";
import fs from "node:fs/promises";
import {
  formatAgentLoopSseFrame,
  formatPtyStreamSseFrame,
  HARNESS_LOOP_EVENT_TYPES,
  HARNESS_PROTOCOL_VERSION,
  buildHarnessHealthPayload,
} from "../src/agent/protocol/harness.ts";
import type { AgentEvent } from "../src/agent/types.ts";

async function main(): Promise<void> {
  const typesSource = await fs.readFile("src/agent/types.ts", "utf8");
  for (const eventType of HARNESS_LOOP_EVENT_TYPES) {
    assert.ok(
      typesSource.includes(`type: "${eventType}"`),
      `AgentEvent missing type: ${eventType}`,
    );
  }

  const checkpoint = await import("../src/agent/trace/trace-checkpoint.ts");
  const cp = checkpoint.buildTraceCheckpointEvent({
    taskId: "t1",
    traceId: "tr1",
    checkpoint: {
      kind: "shell_paused",
      label: "",
      resumable: true,
      approvalId: "ap1",
    },
  });
  assert.equal(cp.type, "trace.checkpoint");
  assert.equal(cp.checkpoint.kind, "shell_paused");

  const loopFrame = formatAgentLoopSseFrame({
    type: "task.created",
    taskId: "task_test",
    task: {
      id: "task_test",
      threadId: "thread_test",
      workspaceId: "ws_test",
      userRequest: "hi",
      status: "created",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  } as AgentEvent);
  assert.ok(loopFrame.startsWith("event: task.created\n"));
  assert.ok(loopFrame.includes('"type":"task.created"'));

  const ptyFrame = formatPtyStreamSseFrame({
    type: "output",
    data: "hello",
  });
  assert.equal(ptyFrame, 'data: {"type":"output","data":"hello"}\n\n');
  assert.ok(!ptyFrame.includes("event:"));

  const health = buildHarnessHealthPayload({
    pid: 1,
    uptimeMs: 100,
    ptyEnabled: true,
    mcp: { enabled: true, connectedServers: 1, toolCount: 2 },
  });
  assert.equal(health.harness.version, HARNESS_PROTOCOL_VERSION);
  assert.equal(health.loop.stream, "agent-loop");
  assert.equal(health.pty.stream, "pty");

  const stream = await fs.readFile("src/agent/protocol/stream.ts", "utf8");
  const sse = await fs.readFile("src/agent-server/sse.ts", "utf8");
  const ptyRoute = await fs.readFile(
    "src/app/api/agent/pty/[sessionId]/stream/route.ts",
    "utf8",
  );
  const httpServer = await fs.readFile("src/agent-server/http-server.ts", "utf8");
  assert.ok(stream.includes("formatAgentLoopSseFrame"));
  assert.ok(sse.includes("formatAgentLoopSseFrame"));
  assert.ok(ptyRoute.includes("formatPtyStreamSseFrame"));
  assert.ok(httpServer.includes("handleTraceGet"));

  const failure = await import("../src/agent/trace/trace-failure.ts");
  const failedEvents = failure.buildTaskFailureEvents({
    taskId: "t1",
    traceId: "tr1",
    error: "boom",
  });
  assert.equal(failedEvents.length, 2);
  assert.equal(failedEvents[0]?.type, "trace.checkpoint");
  assert.equal(
    (failedEvents[0] as { checkpoint?: { kind?: string } }).checkpoint?.kind,
    "task_failed",
  );
  assert.equal(failedEvents[1]?.type, "task.failed");

  const tracesRoute = await fs.readFile(
    "src/app/api/agent/traces/route.ts",
    "utf8",
  );
  assert.ok(tracesRoute.includes("proxyTraceGet"));
  assert.ok(tracesRoute.includes("isRemoteTraceEnabled"));

  const loopRoute = await fs.readFile("src/app/api/agent/loop/route.ts", "utf8");
  assert.ok(loopRoute.includes("emitTaskFailureWithTrace"));

  const loopHandler = await fs.readFile(
    "src/agent-server/loop-handler.ts",
    "utf8",
  );
  assert.ok(loopHandler.includes("emitTaskFailureWithTrace"));

  const doc = await fs.readFile("docs/agent-harness-protocol.md", "utf8");
  assert.ok(doc.includes(HARNESS_PROTOCOL_VERSION));
  assert.ok(doc.includes("trace.checkpoint"));

  const trial = await fs.readFile("scripts/harness-acceptance-trial.ts", "utf8");
  assert.ok(trial.includes("HARNESS_PROTOCOL_VERSION"));

  console.log("validate-harness-protocol: passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
