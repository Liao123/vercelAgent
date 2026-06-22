/**
 * 实机试用：窄只读 QA「网站/项目标题」路径与耗时。
 *
 *   npm run dev   # 终端 A
 *   npm run trial:site-title-qa
 *
 * 报告：`.agent-state/compare/site-title-qa-trial.json`
 */
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.AGENT_BASE_URL ?? "http://localhost:3000";
const workspacePath =
  process.argv.slice(2).find((a) => !a.startsWith("--")) ?? process.cwd();

const USER_REQUEST = "网站项目的标题是什么";
const UI_CONTEXT = {
  layout: "triple",
  activeRoute: "/",
  browserActiveTab: { url: "https://www.baidu.com/", title: "百度" },
};

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

async function ensureServer() {
  const res = await fetch(`${BASE}/api/agent/workspace`, {
    signal: AbortSignal.timeout(8_000),
  }).catch(() => null);
  if (!res?.ok) {
    throw new Error(`无法连接 ${BASE}，请先 npm run dev`);
  }
}

async function main() {
  console.log("site-title-qa-trial");
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
  console.log(
    "  package:",
    wsData.workspace?.packageName ?? wsData.workspace?.framework,
  );

  const t0 = Date.now();
  const loopRes = await fetch(`${BASE}/api/agent/loop`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      userRequest: USER_REQUEST,
      maxIterations: 10,
      uiContext: UI_CONTEXT,
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
  const hasFileRead = toolNames.includes("file.read");
  const hasLocate = toolNames.includes("file.locate");
  const summary = completed.summary ?? "";

  const expectedPackage = wsData.workspace?.packageName ?? "vec-next";
  const mentionsPackage =
    summary.includes(expectedPackage) || summary.includes("vec-next");
  const mentionsLayoutTitle =
    summary.includes("Agent Workspace") || summary.includes("metadata");

  const checks = {
    completed: Boolean(completed),
    elapsedLe30s: elapsedMs <= 30_000,
    toolCountLe3: tools.length <= 3,
    noBrowser: !toolNames.some((n) => n.startsWith("browser.")),
    noRepeatedIndex: indexCount <= 1,
    noFileList: !toolNames.includes("file.list"),
    hasGather: hasFileRead || hasLocate,
    mentionsEvidence:
      mentionsPackage || mentionsLayoutTitle || summary.includes("package.json"),
    disambiguationInSummary:
      summary.includes("package") ||
      summary.includes("vec-next") ||
      summary.includes("layout"),
  };

  const toolPathPassed =
    checks.toolCountLe3 &&
    checks.noBrowser &&
    checks.noRepeatedIndex &&
    checks.noFileList &&
    checks.hasGather &&
    checks.mentionsEvidence;

  const passed = checks.completed && toolPathPassed;

  const report = {
    recordedAt: new Date().toISOString(),
    baseUrl: BASE,
    userRequest: USER_REQUEST,
    uiContext: UI_CONTEXT,
    elapsedMs,
    toolSteps: tools,
    toolCount: tools.length,
    projectIndexCount: indexCount,
    reflections: reflections(events),
    summary,
    expectedGroundTruth: {
      packageName: expectedPackage,
      layoutMetadataTitle: "Agent Workspace",
    },
    checks,
    toolPathPassed,
    latencyAdvisory: checks.elapsedLe30s ? "ok" : "slow (LLM variance)",
    passed,
  };

  const outDir = path.join(workspacePath, ".agent-state", "compare");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "site-title-qa-trial.json");
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");

  console.log("\n--- trace ---");
  console.log("  elapsed:", `${(elapsedMs / 1000).toFixed(1)}s`);
  console.log("  tools:", toolNames.join(" → ") || "(none)");
  console.log("  project.index count:", indexCount);
  console.log("  summary:", summary.slice(0, 280));
  console.log("  checks:", checks);
  console.log("  tool path:", toolPathPassed ? "PASS" : "FAIL");
  console.log("  latency:", checks.elapsedLe30s ? "ok" : "slow (advisory)");
  console.log("  report:", outPath);
  console.log(passed ? "\nsite-title-qa-trial: PASSED" : "\nsite-title-qa-trial: FAILED");

  if (!passed) process.exit(1);
}

main().catch((error) => {
  console.error("\nsite-title-qa-trial: FAILED", error);
  process.exit(1);
});
