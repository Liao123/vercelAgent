/**
 * 阶段 C：内核自举 trial（离线 wiring + 可选在线只读 check）。
 *
 *   npm run validate:kernel-bootstrap
 *   npm run dev
 *   npm run trial:kernel-bootstrap
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  appendKernelBootstrapRestartAfterValidate,
  isKernelBootstrapValidateCommand,
  tagKernelBootstrapValidateApproval,
} from "../src/lib/kernel-bootstrap-restart.ts";
import {
  buildKernelBootstrapPlan,
  isKernelBootstrapPath,
} from "../src/agent/core/kernel-bootstrap-policy.ts";

const BASE = process.env.AGENT_BASE_URL ?? "http://localhost:3000";

const LIVE_REQUEST =
  "调用 agent.bootstrap.check，检查若要修改 src/agent/core/kernel-bootstrap-policy.ts 需要跑哪些 validate，只读不要改任何文件。";

type AgentEvent = {
  type: string;
  taskId?: string;
  toolCall?: { toolName?: string };
  paths?: string[];
  requiresDevRestart?: boolean;
  summary?: string;
  error?: string;
};

async function parseSseStream(response: Response): Promise<AgentEvent[]> {
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

async function serverReady(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/api/agent/workspace`, {
      signal: AbortSignal.timeout(4_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function offlineChecks(): void {
  assert.ok(isKernelBootstrapValidateCommand("npm run validate:kernel-bootstrap"));
  assert.ok(!isKernelBootstrapValidateCommand("npm run dev"));

  const tagged = tagKernelBootstrapValidateApproval(
    { reason: "x", id: "a" } as { reason: string; id: string },
    "npm run validate:agent",
  );
  assert.ok(tagged.reason?.includes("kernel-bootstrap-validate"));

  const plan = buildKernelBootstrapPlan([
    "src/agent/core/agent-loop-tools.ts",
  ]);
  assert.ok(plan.validateScripts.length > 0);

  const events = appendKernelBootstrapRestartAfterValidate(
    [
      {
        type: "kernel.bootstrap.validate",
        taskId: "task_trial",
        paths: ["src/agent/core/agent-loop.ts"],
        validateScripts: ["npm run validate:agent"],
        validateCommand: "npm run validate:agent",
        requiresDevRestart: true,
      },
    ] as unknown as import("../src/agent/types.ts").AgentEvent[],
    {
      taskId: "task_trial",
      command: "npm run validate:agent",
      success: true,
    },
  );
  assert.ok(events.some((event) => event.type === "kernel.bootstrap.restart"));
  const restartEvent = events.find(
    (event) => event.type === "kernel.bootstrap.restart",
  ) as { restartCommand?: string } | undefined;
  assert.ok(restartEvent?.restartCommand?.includes("dev"));

  const panel = fs.readFileSync(
    "src/components/agent-review-panel.tsx",
    "utf8",
  );
  assert.ok(panel.includes("restartRecommended"));
  assert.ok(panel.includes("复制重启命令"));
  assert.ok(isKernelBootstrapPath("src/agent/mcp/registry.ts"));
}

async function liveBootstrapCheck(): Promise<void> {
  if (process.env.AGENT_TRIAL_SKIP_LIVE === "1") {
    console.log("trial:kernel-bootstrap: skipped live (AGENT_TRIAL_SKIP_LIVE=1)");
    return;
  }
  if (!(await serverReady())) {
    console.log(
      `trial:kernel-bootstrap: skipped live (${BASE} offline, start npm run dev)`,
    );
    return;
  }

  const t0 = Date.now();
  const res = await fetch(`${BASE}/api/agent/loop`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      userRequest: LIVE_REQUEST,
      maxIterations: 8,
    }),
  });
  if (!res.ok || !res.body) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      (err as { error?: string }).error ?? `loop HTTP ${res.status}`,
    );
  }

  const events = await parseSseStream(res);
  const elapsedMs = Date.now() - t0;
  const tools = events
    .filter((event) => event.type === "tool.completed")
    .map((event) => event.toolCall?.toolName)
    .filter(Boolean);

  const failed = events.find((event) => event.type === "task.failed");
  const completed = events.find((event) => event.type === "task.completed");

  assert.ok(!failed, failed?.error ?? "task failed");
  assert.ok(completed, "task should complete");
  assert.ok(
    tools.includes("agent.bootstrap.check"),
    `expected agent.bootstrap.check, got: ${tools.join(", ")}`,
  );

  const outDir = ".agent-state/compare";
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    `${outDir}/kernel-bootstrap-trial.json`,
    JSON.stringify(
      {
        elapsedMs,
        tools,
        completed: Boolean(completed),
        summary: completed?.summary?.slice(0, 500) ?? null,
      },
      null,
      2,
    ),
  );

  console.log(
    `trial:kernel-bootstrap: live ok (${elapsedMs}ms, tools=${tools.join(",")})`,
  );
}

async function main(): Promise<void> {
  offlineChecks();
  await liveBootstrapCheck();
  console.log("trial:kernel-bootstrap: passed");
}

main().catch((error) => {
  console.error("trial:kernel-bootstrap failed:", error);
  process.exit(1);
});
