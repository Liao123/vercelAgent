/**
 * 通用只读 QA trial：按路径/行为度量，不断言具体答案字符串。
 *
 *   npm run dev   # 终端 A
 *   npm run trial:readonly-qa
 *   npm run trial:readonly-qa -- "只读看看 package.json 的 name"
 *
 * 报告：`.agent-state/compare/readonly-qa-trial.json`
 */
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.AGENT_BASE_URL ?? "http://localhost:3000";
const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const workspacePath = args[1] ?? args[0] ?? process.cwd();
const USER_REQUEST =
  args.length >= 2
    ? args[0]
    : process.env.READONLY_QA_REQUEST ?? "只读看看 package.json 里的 name 字段";

const MAX_TOOLS = Number(process.env.READONLY_QA_MAX_TOOLS ?? "4");
const MAX_INDEX = Number(process.env.READONLY_QA_MAX_INDEX ?? "1");

async function parseSseStream(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const events = [];

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
        events.push(JSON.parse(line.slice(6)));
      } catch {
        // ignore
      }
    }
  }
  return events;
}

function toolSteps(events) {
  const steps = [];
  for (const event of events) {
    if (event.type === "tool.completed" && event.toolCall?.toolName) {
      steps.push({
        tool: event.toolCall.toolName,
        at: event.timestamp ?? null,
      });
    }
  }
  return steps;
}

function reflections(events) {
  return events
    .filter((e) => e.type === "reflection.updated")
    .map((e) => ({
      source: e.reflection?.source,
      understanding: e.reflection?.understanding?.slice(0, 200),
      plannedNext: e.reflection?.plannedNext?.slice(0, 160),
    }));
}

const GATHER_TOOLS = new Set([
  "file.read",
  "file.locate",
  "file.search",
  "file.list",
  "project.index",
  "browser.inspect",
  "browser.snapshot",
]);

async function ensureServer() {
  const res = await fetch(`${BASE}/api/agent/workspace`, {
    signal: AbortSignal.timeout(8_000),
  }).catch(() => null);
  if (!res?.ok) {
    throw new Error(`无法连接 ${BASE}，请先 npm run dev`);
  }
}

async function main() {
  console.log("trial-readonly-qa");
  console.log("  base:", BASE);
  console.log("  workspace:", workspacePath);
  console.log("  request:", USER_REQUEST);

  await ensureServer();

  const wsRes = await fetch(`${BASE}/api/agent/workspace`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rootPath: workspacePath }),
  });
  const wsData = await wsRes.json();
  if (!wsRes.ok) throw new Error(wsData.error ?? "workspace failed");

  const t0 = Date.now();
  const loopRes = await fetch(`${BASE}/api/agent/loop`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      userRequest: USER_REQUEST,
      maxIterations: 10,
    }),
  });
  if (!loopRes.ok || !loopRes.body) {
    const err = await loopRes.json().catch(() => ({}));
    throw new Error(err.error ?? `loop HTTP ${loopRes.status}`);
  }

  const events = await parseSseStream(loopRes);
  const elapsedMs = Date.now() - t0;

  const failed = events.find((e) => e.type === "task.failed");
  const completed = events.find((e) => e.type === "task.completed");
  if (failed) throw new Error(`task.failed: ${failed.error}`);
  if (!completed) throw new Error("task did not complete");

  const tools = toolSteps(events);
  const toolNames = tools.map((t) => t.tool);
  const indexCount = toolNames.filter((n) => n === "project.index").length;
  const hasGather = toolNames.some((n) => GATHER_TOOLS.has(n));
  const hasWrite = toolNames.some((n) =>
    /replace|mutation|patch|write|shell\.run/.test(n),
  );
  const summary = completed.summary ?? "";

  const checks = {
    completed: Boolean(completed),
    toolCountWithinLimit: tools.length <= MAX_TOOLS,
    noRepeatedIndex: indexCount <= MAX_INDEX,
    hasGatherBeforeFinal: hasGather,
    noWriteTools: !hasWrite,
    summaryNonEmpty: summary.trim().length > 0,
  };

  const passed = Object.values(checks).every(Boolean);

  const report = {
    recordedAt: new Date().toISOString(),
    baseUrl: BASE,
    userRequest: USER_REQUEST,
    workspacePath,
    elapsedMs,
    toolSteps: tools,
    toolCount: tools.length,
    projectIndexCount: indexCount,
    reflections: reflections(events),
    summary,
    thresholds: { maxTools: MAX_TOOLS, maxIndex: MAX_INDEX },
    checks,
    passed,
  };

  const outDir = path.join(workspacePath, ".agent-state", "compare");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "readonly-qa-trial.json");
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");

  console.log("\n--- trace ---");
  console.log("  elapsed:", `${(elapsedMs / 1000).toFixed(1)}s`);
  console.log("  tools:", toolNames.join(" → ") || "(none)");
  console.log("  project.index count:", indexCount);
  console.log("  summary:", summary.slice(0, 280));
  console.log("  checks:", checks);
  console.log("  report:", outPath);
  console.log(passed ? "\ntrial-readonly-qa: PASSED" : "\ntrial-readonly-qa: FAILED");

  if (!passed) process.exit(1);
}

main().catch((error) => {
  console.error("\ntrial-readonly-qa: FAILED", error);
  process.exit(1);
});
