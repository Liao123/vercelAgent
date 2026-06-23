/**
 * 阶段 D：Harness 验收 trial（离线 + 可选在线）。
 *
 *   npm run validate:harness-protocol
 *   npm run dev          # 可选
 *   npm run agent-server # 可选（在线 health/trace）
 *   npm run trial:harness-acceptance
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  HARNESS_PROTOCOL_VERSION,
  buildHarnessHealthPayload,
} from "../src/agent/protocol/harness.ts";
import { buildTaskFailureEvents } from "../src/agent/trace/trace-failure.ts";
import { buildTraceCheckpointEvent } from "../src/agent/trace/trace-checkpoint.ts";

const NEXT_BASE = process.env.AGENT_BASE_URL ?? "http://127.0.0.1:3000";
const AGENT_SERVER = process.env.AGENT_SERVER_URL ?? "http://127.0.0.1:3920";
const LIVE_REQUEST =
  "只读：调用 agent.bootstrap.check，检查 kernel 自举策略，不要改任何文件。";

type AgentEvent = {
  type: string;
  taskId?: string;
  traceId?: string;
  checkpoint?: { kind?: string };
  error?: string;
};

async function parseSse(response: Response): Promise<AgentEvent[]> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const events: AgentEvent[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      const line = part.split("\n").find((l) => l.startsWith("data: "));
      if (!line) continue;
      try {
        events.push(JSON.parse(line.slice(6)) as AgentEvent);
      } catch {
        /* ignore */
      }
    }
  }
  return events;
}

async function serverReady(url: string, path: string): Promise<boolean> {
  try {
    const res = await fetch(`${url}${path}`, {
      signal: AbortSignal.timeout(4_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function offlineChecks(): void {
  const health = buildHarnessHealthPayload({
    pid: 1,
    uptimeMs: 1,
    ptyEnabled: true,
    mcp: { enabled: true, connectedServers: 1, toolCount: 1 },
  });
  assert.equal(health.harness.version, HARNESS_PROTOCOL_VERSION);

  const cp = buildTraceCheckpointEvent({
    taskId: "t1",
    traceId: "tr1",
    checkpoint: { kind: "task_started", label: "" },
  });
  assert.equal(cp.type, "trace.checkpoint");

  const failed = buildTaskFailureEvents({
    taskId: "t1",
    traceId: "tr1",
    error: "boom",
  });
  assert.equal(failed.length, 2);
  assert.equal(failed[0]?.type, "trace.checkpoint");
  assert.equal(failed[1]?.type, "task.failed");

  const httpServer = fs.readFileSync("src/agent-server/http-server.ts", "utf8");
  assert.ok(httpServer.includes("buildHarnessHealthPayload"));
  assert.ok(httpServer.includes('@/agent/protocol/harness"'));

  const tracesRoute = fs.readFileSync(
    "src/app/api/agent/traces/route.ts",
    "utf8",
  );
  assert.ok(tracesRoute.includes("proxyTraceGet"));
}

async function liveChecks(): Promise<Record<string, unknown>> {
  if (process.env.AGENT_TRIAL_SKIP_LIVE === "1") {
    console.log("trial:harness-acceptance: skipped live (AGENT_TRIAL_SKIP_LIVE=1)");
    return { skipped: true };
  }

  const nextUp = await serverReady(NEXT_BASE, "/api/agent/workspace");
  const agentUp = await serverReady(AGENT_SERVER, "/health");

  if (!nextUp && !agentUp) {
    console.log(
      `trial:harness-acceptance: skipped live (${NEXT_BASE} / ${AGENT_SERVER} offline)`,
    );
    return { skipped: true };
  }

  const report: Record<string, unknown> = { nextUp, agentUp };

  if (agentUp) {
    const health = (await fetch(`${AGENT_SERVER}/health`).then((r) =>
      r.json(),
    )) as { harness?: { version?: string }; ok?: boolean };
    assert.equal(health.harness?.version, HARNESS_PROTOCOL_VERSION);
    assert.equal(health.ok, true);
    report.harnessVersion = health.harness?.version;

    const list = (await fetch(`${AGENT_SERVER}/trace`).then((r) =>
      r.json(),
    )) as { traces?: unknown[] };
    assert.ok(Array.isArray(list.traces));
    report.agentTraceCount = list.traces?.length ?? 0;
  }

  if (!nextUp) {
    return report;
  }

  const t0 = Date.now();
  const res = await fetch(`${NEXT_BASE}/api/agent/loop`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userRequest: LIVE_REQUEST, maxIterations: 8 }),
  });
  if (!res.ok || !res.body) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      (err as { error?: string }).error ?? `loop HTTP ${res.status}`,
    );
  }

  const events = await parseSse(res);
  report.elapsedMs = Date.now() - t0;
  report.eventCount = events.length;

  assert.ok(
    events.some(
      (e) =>
        e.type === "trace.checkpoint" && e.checkpoint?.kind === "task_started",
    ),
    "missing trace.checkpoint task_started",
  );
  assert.ok(events.some((e) => e.type === "task.completed"), "task not completed");

  const taskId = events.find((e) => e.type === "task.created")?.taskId;
  if (taskId) {
    const local = (await fetch(
      `${NEXT_BASE}/api/agent/traces?taskId=${encodeURIComponent(taskId)}`,
    ).then((r) => r.json())) as {
      trace?: { events?: AgentEvent[] };
    };
    const kinds =
      local.trace?.events
        ?.filter((e) => e.type === "trace.checkpoint")
        .map((e) => e.checkpoint?.kind) ?? [];
    assert.ok(kinds.length >= 1, "trace file missing checkpoints");
    report.checkpointKinds = kinds;

    if (process.env.AGENT_LOOP_REMOTE === "1" && agentUp) {
      const remote = (await fetch(
        `${AGENT_SERVER}/trace?taskId=${encodeURIComponent(taskId)}`,
      ).then((r) => r.json())) as { trace?: { id?: string } };
      const proxied = (await fetch(
        `${NEXT_BASE}/api/agent/traces?taskId=${encodeURIComponent(taskId)}`,
      ).then((r) => r.json())) as { trace?: { id?: string } };
      assert.equal(proxied.trace?.id, remote.trace?.id);
      report.remoteTraceProxy = true;
    }
  }

  console.log(
    `trial:harness-acceptance: live ok (${report.elapsedMs}ms, checkpoints=${(report.checkpointKinds as string[] | undefined)?.join(",") ?? "?"})`,
  );
  return report;
}

async function main(): Promise<void> {
  offlineChecks();
  const live = await liveChecks();

  const outDir = ".agent-state/compare";
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    `${outDir}/harness-acceptance-trial.json`,
    JSON.stringify(
      {
        at: new Date().toISOString(),
        harnessVersion: HARNESS_PROTOCOL_VERSION,
        live,
      },
      null,
      2,
    ),
  );

  console.log("trial:harness-acceptance: passed");
}

main().catch((error) => {
  console.error("trial:harness-acceptance failed:", error);
  process.exit(1);
});
