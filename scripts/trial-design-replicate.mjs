/**
 * A024 design-replicate 实机 trial：量路径，不断言页面内容字符串。
 *
 *   npm run dev
 *   npm run trial:design-replicate
 *
 * 报告：`.agent-state/compare/design-replicate-trial.json`
 */
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.AGENT_BASE_URL ?? "http://localhost:3000";
const workspacePath =
  process.argv.slice(2).find((a) => !a.startsWith("--")) ?? process.cwd();
const USER_REQUEST =
  process.env.DESIGN_REPLICATE_REQUEST ??
  "照着 https://example.com 复刻一个 landing 页面到 src/app/demo-replicate/page.tsx";
const MAX_TOOLS = Number(process.env.DESIGN_REPLICATE_MAX_TOOLS ?? "14");
const TARGET_PAGE = "src/app/demo-replicate/page.tsx";

const BROWSER_TOOLS = new Set([
  "browser.open",
  "browser.wait_and_inspect",
  "browser.inspect",
]);
const DESIGN_SPEC_TOOLS = new Set([
  "devtools.extract_design_spec",
  "devtools.get_persisted_design_spec",
]);
const WRITE_TOOLS = new Set([
  "file.replace",
  "file.replace.prepare",
  "file.mutation",
  "file.mutation.prepare",
  "patch.apply",
  "patch.prepare",
]);

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

function playbookId(events) {
  const matched = events.find((e) => e.type === "playbook.matched");
  return matched?.playbookId ?? null;
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
  console.log("trial-design-replicate");
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
      maxIterations: 14,
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
  const awaiting = events.find((e) => e.type === "task.awaiting_approval");
  const approvalRequired = events.some((e) => e.type === "approval.required");

  if (failed) throw new Error(`task.failed: ${failed.error}`);

  const tools = toolNames(events);
  const extractCount = tools.filter(
    (n) => n === "devtools.extract_design_spec",
  ).length;
  const readTarget = events
    .filter((e) => e.type === "tool.completed" && e.toolCall?.toolName === "file.read")
    .some((e) => {
      const args = e.toolCall?.args;
      const p =
        typeof args === "object" && args && "path" in args
          ? String(args.path)
          : "";
      return p.includes("demo-replicate");
    });

  const checks = {
    playbookDesignReplicate: playbookId(events) === "design-replicate",
    hasBrowserGather: tools.some((n) => BROWSER_TOOLS.has(n)),
    hasDesignSpec: tools.some((n) => DESIGN_SPEC_TOOLS.has(n)),
    hasFileRead: tools.includes("file.read"),
    readTargetPage: readTarget,
    hasWriteOrPrepare: tools.some((n) => WRITE_TOOLS.has(n)),
    terminalOk: Boolean(completed || awaiting || approvalRequired),
    toolCountOk: tools.length <= MAX_TOOLS,
    noRepeatedExtract: extractCount <= 2,
    summaryNonEmpty: String(completed?.summary ?? "").trim().length > 0,
  };

  const corePath =
    checks.playbookDesignReplicate &&
    checks.hasBrowserGather &&
    checks.hasDesignSpec &&
    checks.hasFileRead &&
    checks.terminalOk &&
    checks.toolCountOk &&
    checks.noRepeatedExtract;

  const passed = corePath;

  const report = {
    recordedAt: new Date().toISOString(),
    baseUrl: BASE,
    userRequest: USER_REQUEST,
    workspacePath,
    targetPage: TARGET_PAGE,
    elapsedMs,
    playbookId: playbookId(events),
    toolSteps: tools,
    toolCount: tools.length,
    extractCount,
    checks,
    passed,
    summary: completed?.summary ?? null,
    thresholds: { maxTools: MAX_TOOLS },
  };

  const outDir = path.join(workspacePath, ".agent-state", "compare");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "design-replicate-trial.json");
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");

  console.log("\n--- trace ---");
  console.log("  elapsed:", `${(elapsedMs / 1000).toFixed(1)}s`);
  console.log("  playbook:", report.playbookId);
  console.log("  tools:", tools.join(" → ") || "(none)");
  console.log("  checks:", checks);
  console.log("  report:", outPath);
  console.log(
    passed ? "\ntrial-design-replicate: PASSED" : "\ntrial-design-replicate: FAILED",
  );

  if (!passed) process.exit(1);
}

main().catch((error) => {
  console.error("\ntrial-design-replicate: FAILED", error);
  process.exit(1);
});
