/**
 * Apifox / 外链 API 文档解析 — 在线黄金路径（对齐 Cursor：open → inspect → final）。
 *
 * 用法（dev:desktop + 右栏浏览器可用）：
 *   npm run trial:browser-doc
 *   node scripts/browser-doc-trial.mjs [baseUrl] [apifoxUrl]
 *
 * 报告：`.agent-state/compare/browser-doc-trial.json`
 *
 * 与 Cursor 对比：在 Cursor 跑同一句需求后，把工具步骤粘贴进
 * `.agent-state/compare/cursor-browser-doc-notes.json`（见模板字段）。
 */
import fs from "node:fs";
import path from "node:path";

const DEFAULT_URL =
  "https://s.apifox.cn/aed7ded5-e044-4fc8-8c17-811dd6b0f909/469140751e0";

const argv = process.argv.slice(2);
let BASE = process.env.AGENT_BASE_URL ?? "http://localhost:3000";
let docUrl = DEFAULT_URL;
for (const a of argv) {
  if (a.includes("apifox.cn") || (a.startsWith("http") && a.includes("apifox"))) {
    docUrl = a;
  } else if (a.startsWith("http://") || a.startsWith("https://")) {
    BASE = a.replace(/\/$/, "");
  }
}
const workspacePath = process.cwd();

const USER_REQUEST = `帮我解析 ${docUrl} 这个链接的接口参数，整理成中文列表（方法、路径、Query/Body 参数名、类型、是否必填、说明）。只读，不要改代码。`;

async function detectBaseUrl(preferred) {
  for (const url of [preferred, "http://localhost:3000", "http://localhost:3001"]) {
    try {
      const res = await fetch(`${url}/api/agent/workspace`, { method: "GET" });
      if (res.ok) return url;
    } catch {
      // next
    }
  }
  throw new Error("dev server not reachable — 请先 npm run dev 或 dev:desktop");
}

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

function toolSequence(events) {
  const steps = [];
  for (const event of events) {
    if (event.type === "tool.completed" && event.toolCall?.toolName) {
      steps.push({
        tool: event.toolCall.toolName,
        ok: !event.toolCall?.error,
        error: event.toolCall?.error ?? null,
      });
    }
  }
  return steps;
}

function finalSummary(events) {
  for (const event of events) {
    if (event.type === "task.completed" && event.summary) {
      return event.summary;
    }
  }
  return null;
}

async function main() {
  const base = await detectBaseUrl(BASE);
  console.log("browser-doc-trial");
  console.log("  base:", base);
  console.log("  url:", docUrl);

  const res = await fetch(`${base}/api/agent/loop`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      workspacePath,
      userRequest: USER_REQUEST,
      uiContext: { layout: "triple", activeRoute: "/" },
    }),
  });

  if (!res.ok || !res.body) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? `loop HTTP ${res.status}`);
  }

  const events = await parseSseStream(res);
  const tools = toolSequence(events);
  const summary = finalSummary(events) ?? "";
  const networkCalls = tools.filter((t) =>
    t.tool.includes("network"),
  ).length;
  const hasInspect = tools.some((t) => t.tool === "browser.inspect");
  const hasOpen = tools.some((t) => t.tool === "browser.open");
  const noFinalHang =
    !summary.includes("Agent loop stopped without a final answer");
  const toolCountOk = tools.length <= 8;
  const pathOk = hasOpen && hasInspect && networkCalls <= 1;
  const passed = noFinalHang && toolCountOk && pathOk && summary.length > 80;

  const report = {
    recordedAt: new Date().toISOString(),
    baseUrl: base,
    docUrl,
    userRequest: USER_REQUEST,
    toolSteps: tools,
    toolCount: tools.length,
    networkToolCalls: networkCalls,
    summaryPreview: summary.slice(0, 800),
    checks: {
      hasBrowserOpen: hasOpen,
      hasBrowserInspect: hasInspect,
      networkCallsLe1: networkCalls <= 1,
      toolCountLe8: toolCountOk,
      hasFinalAnswer: noFinalHang,
      summaryMinLength: summary.length > 80,
    },
    passed,
    cursorCompareHint:
      "在 Cursor 跑同一句需求后，将工具序列写入 .agent-state/compare/cursor-browser-doc-notes.json",
  };

  const outDir = path.join(workspacePath, ".agent-state", "compare");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "browser-doc-trial.json");
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");

  console.log("\n工具序列:", tools.map((t) => t.tool).join(" → "));
  console.log("summary 长度:", summary.length);
  console.log("passed:", passed);
  console.log("报告:", outPath);

  if (!passed) {
    console.error("\nbrowser-doc-trial: FAILED");
    process.exit(1);
  }
  console.log("\nbrowser-doc-trial: PASSED");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
