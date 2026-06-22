/**
 * 通用能力 trial 矩阵：多 intent × 路径指标（A156）。
 *
 *   npm run dev
 *   npm run trial:capability-matrix
 *
 * 报告：`.agent-state/compare/capability-matrix.json`
 */
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.AGENT_BASE_URL ?? "http://localhost:3000";
const workspacePath =
  process.argv.slice(2).find((a) => !a.startsWith("--")) ?? process.cwd();

const SCENARIOS = [
  {
    id: "readonly-explicit",
    userRequest: "只读看看 package.json 的 name 字段",
    maxTools: 4,
  },
  {
    id: "readonly-metadata",
    userRequest: "这个网站项目的标题是什么",
    maxTools: 5,
  },
  {
    id: "calendar-factual",
    userRequest: "中国今天几号",
    maxTools: 2,
    allowNoGather: true,
  },
];

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

function toolNames(events) {
  return events
    .filter((e) => e.type === "tool.completed")
    .map((e) => e.toolCall?.toolName)
    .filter(Boolean);
}

async function runScenario(scenario) {
  const t0 = Date.now();
  const res = await fetch(`${BASE}/api/agent/loop`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      userRequest: scenario.userRequest,
      maxIterations: 10,
    }),
  });
  if (!res.ok || !res.body) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? `HTTP ${res.status}`);
  }
  const events = await parseSseStream(res);
  const elapsedMs = Date.now() - t0;
  const failed = events.find((e) => e.type === "task.failed");
  const completed = events.find((e) => e.type === "task.completed");
  const tools = toolNames(events);
  const indexCount = tools.filter((n) => n === "project.index").length;
  const hasGather = tools.some((n) =>
    ["file.read", "file.locate", "file.search", "browser.inspect"].includes(n),
  );
  const checks = {
    completed: Boolean(completed) && !failed,
    toolCountOk: tools.length <= scenario.maxTools,
    noRepeatedIndex: indexCount <= 1,
    gatherOrCalendar:
      scenario.allowNoGather === true ? true : hasGather,
    noHtmlError: !String(completed?.summary ?? failed?.error ?? "").includes(
      "<!DOCTYPE",
    ),
  };
  return {
    id: scenario.id,
    userRequest: scenario.userRequest,
    elapsedMs,
    tools,
    toolCount: tools.length,
    checks,
    passed: Object.values(checks).every(Boolean),
    summary: completed?.summary ?? failed?.error ?? null,
  };
}

async function main() {
  console.log("trial-capability-matrix");
  console.log("  workspace:", workspacePath);

  const wsRes = await fetch(`${BASE}/api/agent/workspace`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rootPath: workspacePath }),
  });
  if (!wsRes.ok) throw new Error("workspace bind failed — is dev running?");

  const results = [];
  for (const scenario of SCENARIOS) {
    console.log("  scenario:", scenario.id);
    try {
      results.push(await runScenario(scenario));
    } catch (error) {
      results.push({
        id: scenario.id,
        userRequest: scenario.userRequest,
        passed: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const report = {
    recordedAt: new Date().toISOString(),
    workspacePath,
    results,
    passed: results.every((r) => r.passed),
  };

  const outDir = path.join(workspacePath, ".agent-state", "compare");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "capability-matrix.json");
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

  console.log("  report:", outPath);
  console.log(
    report.passed
      ? "trial-capability-matrix: PASSED"
      : "trial-capability-matrix: FAILED",
  );
  if (!report.passed) process.exit(1);
}

main().catch((error) => {
  console.error("trial-capability-matrix failed:", error);
  process.exit(1);
});
