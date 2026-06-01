/**
 * 语义 vs 确定性压缩对比实验（需 dev server + 模型 API）。
 *
 * 用法：
 *   node scripts/semantic-compact-compare.mjs [baseUrl] [workspacePath]
 *   node scripts/semantic-compact-compare.mjs summarize
 *
 * 流程：
 * 1) 默认 dev（语义压缩开）跑一轮 → .agent-state/compare/semantic-on.md
 * 2) .env.local 设 AGENT_LOOP_SEMANTIC_COMPACT=false，重启 dev，再跑 → semantic-off.md
 * 3) node scripts/semantic-compact-compare.mjs summarize
 */
import fs from "node:fs";
import path from "node:path";

const OUT_DIR = path.join(process.cwd(), ".agent-state", "compare");

const TASK = `【压缩对比实验·只读】
依次调用：workspace.inspect → project.index → file.list(src/components) →
对 src/components 下 8 个不同 .tsx 各 file.read 一次 → git.status → git.diff。
不要改文件、不要 prepare 审批。action=final 中文汇总。`;

function readSemanticModeFromEnvFile() {
  try {
    const raw = fs.readFileSync(path.join(process.cwd(), ".env.local"), "utf8");
    if (/AGENT_LOOP_SEMANTIC_COMPACT\s*=\s*false/i.test(raw)) return "off";
  } catch {
    // no .env.local
  }
  return "on";
}

function buildMarkdown(label, meta, memoryContent) {
  const lines = [
    `# 压缩对比 · ${label}`,
    "",
    `- 导出时间: ${new Date().toISOString()}`,
    `- 语义压缩: ${meta.semanticMode === "off" ? "关闭（仅确定性）" : "开启（默认）"}`,
    `- Thread: \`${meta.threadId ?? "—"}\``,
    `- 压缩事件: ${meta.compactions.length} 次`,
    "",
  ];
  for (const c of meta.compactions) {
    lines.push(
      `- 第 ${c.round} 轮 · ${c.method} · ${c.estimatedTokensBefore}→${c.estimatedTokensAfter} tokens · 审批 ${c.pinnedApprovalCount ?? 0}`,
    );
  }
  lines.push("", "---", "", "```", memoryContent ?? "(无 memoryContent)", "```", "");
  return lines.join("\n");
}

async function detectBaseUrl(preferred) {
  for (const url of [preferred, "http://localhost:3000", "http://localhost:3001"]) {
    try {
      const res = await fetch(`${url}/api/agent/workspace`);
      if (res.ok) return url;
    } catch {
      // next
    }
  }
  throw new Error("dev server not reachable on 3000/3001");
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

async function runTrial(base, workspacePath) {
  const semanticMode = readSemanticModeFromEnvFile();
  const label = semanticMode === "off" ? "semantic-off" : "semantic-on";

  console.log("Base URL:", base);
  console.log("Workspace:", workspacePath);
  console.log("当前 .env.local 语义压缩:", semanticMode === "off" ? "关闭" : "开启");
  console.log("输出标签:", label);

  const wsRes = await fetch(`${base}/api/agent/workspace`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rootPath: workspacePath }),
  });
  if (!wsRes.ok) {
    const err = await wsRes.json().catch(() => ({}));
    throw new Error(err.error ?? "workspace failed");
  }

  console.log("\n>>> 运行长任务（约 1–2 分钟）…");
  const loopRes = await fetch(`${base}/api/agent/loop`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userRequest: TASK, maxIterations: 16 }),
  });
  if (!loopRes.ok || !loopRes.body) {
    const err = await loopRes.json().catch(() => ({}));
    throw new Error(err.error ?? `loop HTTP ${loopRes.status}`);
  }

  const events = await parseSseStream(loopRes);
  const failed = events.find((e) => e.type === "task.failed");
  if (failed) throw new Error(failed.error);

  const threadId = events.find((e) => e.type === "thread.created")?.threadId;
  const compactions = events.filter((e) => e.type === "context.compacted");
  const lastCompact = compactions.at(-1);

  let memoryContent = lastCompact?.memoryContent ?? null;
  if (threadId) {
    const memRes = await fetch(
      `${base}/api/agent/thread-memory?threadId=${encodeURIComponent(threadId)}`,
    );
    if (memRes.ok) {
      const memData = await memRes.json();
      memoryContent = memData.memory?.memoryContent ?? memoryContent;
    }
  }

  const meta = {
    label,
    semanticMode,
    threadId,
    taskRequest: TASK,
    compactions: compactions.map((c) => ({
      round: c.round,
      method: c.method,
      estimatedTokensBefore: c.estimatedTokensBefore,
      estimatedTokensAfter: c.estimatedTokensAfter,
      pinnedApprovalCount: c.pinnedApprovalCount,
      summaryPreview: c.summaryPreview?.slice(0, 200),
    })),
    exportedAt: new Date().toISOString(),
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const jsonPath = path.join(OUT_DIR, `${label}.json`);
  const mdPath = path.join(OUT_DIR, `${label}.md`);
  fs.writeFileSync(jsonPath, JSON.stringify(meta, null, 2), "utf8");
  fs.writeFileSync(mdPath, buildMarkdown(label, meta, memoryContent), "utf8");

  console.log("\n── 结果 ──");
  console.log("压缩次数:", compactions.length);
  for (const c of meta.compactions) {
    console.log(
      `  第 ${c.round} 轮 ${c.method}: ${c.estimatedTokensBefore}→${c.estimatedTokensAfter}`,
    );
  }
  console.log("已写入:", mdPath);

  const other = label === "semantic-on" ? "semantic-off" : "semantic-on";
  const otherPath = path.join(OUT_DIR, `${other}.md`);
  if (fs.existsSync(otherPath)) {
    console.log("\n两组数据齐全，运行: node scripts/semantic-compact-compare.mjs summarize");
  } else {
    console.log(`\n下一步: 切换 AGENT_LOOP_SEMANTIC_COMPACT 并重启 dev，再跑本脚本生成 ${other}.md`);
  }
}

function summarize() {
  const onPath = path.join(OUT_DIR, "semantic-on.json");
  const offPath = path.join(OUT_DIR, "semantic-off.json");
  if (!fs.existsSync(onPath) || !fs.existsSync(offPath)) {
    console.error("需要 semantic-on.json 与 semantic-off.json，请先各跑一轮 compare。");
    process.exit(1);
  }
  const on = JSON.parse(fs.readFileSync(onPath, "utf8"));
  const off = JSON.parse(fs.readFileSync(offPath, "utf8"));

  console.log("=== 语义压缩对比摘要 ===\n");
  console.log("| 指标 | 语义开 | 语义关 |");
  console.log("| --- | --- | --- |");
  console.log(
    `| 压缩次数 | ${on.compactions.length} | ${off.compactions.length} |`,
  );
  const onLast = on.compactions.at(-1);
  const offLast = off.compactions.at(-1);
  if (onLast && offLast) {
    console.log(
      `| 末轮 tokens | ${onLast.estimatedTokensAfter} | ${offLast.estimatedTokensAfter} |`,
    );
    console.log(
      `| 末轮方式 | ${onLast.method} | ${offLast.method} |`,
    );
  }
  console.log("\n详细记忆见:");
  console.log(" ", path.join(OUT_DIR, "semantic-on.md"));
  console.log(" ", path.join(OUT_DIR, "semantic-off.md"));
}

async function main() {
  if (process.argv[2] === "summarize") {
    summarize();
    return;
  }
  const base = await detectBaseUrl(
    process.argv[2] ?? process.env.AGENT_BASE_URL ?? "http://localhost:3000",
  );
  const workspacePath = process.argv[3] ?? process.cwd();
  await runTrial(base, workspacePath);
}

main().catch((error) => {
  console.error("semantic-compact-compare failed:", error);
  process.exit(1);
});
