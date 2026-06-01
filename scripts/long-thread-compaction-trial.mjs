/**
 * 长任务 + 延续会话压缩 实机试用（需 dev server + 模型 API）。
 *
 * 用法：
 *   npx tsx scripts/long-thread-compaction-trial.mjs [baseUrl] [workspacePath]
 */
const BASE =
  process.argv[2] ??
  process.env.AGENT_BASE_URL ??
  "http://localhost:3000";
const workspacePath = process.argv[3] ?? process.cwd();

const TASK1 = `【长任务压缩验证·Task1·只读】
必须依次调用工具（不要跳步）：
1) workspace.inspect
2) project.index
3) file.list path=src/components
4) 对 src/components 下至少 10 个不同 .tsx 文件各调用一次 file.read（每次只读一个）
5) git.status
6) git.diff
不要修改文件，不要 prepare 审批。每读一个文件再读下一个。最后 action=final 中文汇总读了多少个文件。`;

const TASK2 = `【长任务压缩验证·Task2·延续】
这是同一会话的第二个任务。请根据滚动/会话记忆回答：
- 上一轮读了哪些路径（如有）
- 当前 thread 里是否还有 pinned 审批 ID（如有）
然后再 file.read 3 个 src/agent 下的 .ts 文件。只读，不改文件。action=final 中文总结。`;

async function detectBaseUrl(preferred) {
  for (const url of [preferred, "http://localhost:3000", "http://localhost:3001"]) {
    try {
      const res = await fetch(`${url}/api/agent/workspace`, { method: "GET" });
      if (res.ok) return url;
    } catch {
      // try next
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

async function runLoop(base, body) {
  const res = await fetch(`${base}/api/agent/loop`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? `loop HTTP ${res.status}`);
  }
  return parseSseStream(res);
}

function summarizeRun(label, events) {
  const thread = events.find((e) => e.type === "thread.created");
  const compactions = events.filter((e) => e.type === "context.compacted");
  const failed = events.find((e) => e.type === "task.failed");
  const completed = events.find((e) => e.type === "task.completed");
  const tools = events
    .filter((e) => e.type === "tool.completed")
    .map((e) => e.toolCall?.toolName)
    .filter(Boolean);

  console.log(`\n── ${label} ──`);
  if (failed) {
    console.log("  FAILED:", failed.error);
    return { ok: false, threadId: thread?.threadId, compactions };
  }
  if (!completed) console.log("  WARN: no task.completed");
  else console.log("  summary:", completed.summary?.slice(0, 160));

  console.log("  threadId:", thread?.threadId ?? "(none)");
  console.log("  tools:", tools.length, tools.slice(0, 12).join(" → "));
  console.log("  compactions:", compactions.length);
  for (const c of compactions) {
    console.log(
      `    · 第 ${c.round} 轮 ${c.method} | ${c.estimatedTokensBefore}→${c.estimatedTokensAfter} tokens | 审批 ${c.pinnedApprovalCount ?? 0}`,
    );
  }

  return {
    ok: !failed,
    threadId: thread?.threadId,
    compactions,
    completed,
  };
}

async function main() {
  const base = await detectBaseUrl(BASE);
  console.log("Base URL:", base);
  console.log("Workspace:", workspacePath);

  const wsRes = await fetch(`${base}/api/agent/workspace`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rootPath: workspacePath }),
  });
  const wsData = await wsRes.json();
  if (!wsRes.ok) throw new Error(wsData.error ?? "workspace failed");
  console.log("Framework:", wsData.workspace?.framework ?? wsData.workspace?.packageName);

  console.log("\n>>> Task 1 开始（可能需 1–3 分钟）…");
  const events1 = await runLoop(base, {
    userRequest: TASK1,
    maxIterations: 16,
  });
  const run1 = summarizeRun("Task 1", events1);
  if (!run1.ok) process.exit(1);

  const threadId = run1.threadId;
  if (!threadId) {
    console.warn("No threadId from task1 — task2 will start new thread");
  }

  if (run1.compactions.length === 0) {
    console.warn(
      "WARN: Task1 未触发 context.compacted（消息/ token 可能未达阈值，可加大 file.read 次数或调 AGENT_LOOP_MIDDLE_* 后重启 dev）",
    );
  }

  console.log("\n>>> Task 2 开始（延续会话）…");
  const events2 = await runLoop(base, {
    userRequest: TASK2,
    maxIterations: 14,
    threadId,
  });
  const run2 = summarizeRun("Task 2", events2);
  if (!run2.ok) process.exit(1);

  const totalCompact = run1.compactions.length + run2.compactions.length;
  console.log("\n=== 结果 ===");
  console.log("总压缩事件:", totalCompact);
  console.log("Task1 压缩:", run1.compactions.length);
  console.log("Task2 压缩:", run2.compactions.length);
  console.log("Thread:", threadId);
  console.log("\n浏览器打开:", `${base.replace(/\/$/, "")}/`);
  console.log("侧栏选同 thread → 查看「任务记忆」与活动流「上下文已压缩」");

  if (totalCompact === 0) {
    console.log("\n结论: API 跑通但未触发压缩，请用更低阈值重启 dev 后重试。");
    process.exit(2);
  }

  console.log("\n结论: 长任务 + 延续会话压缩实机通过。");
}

main().catch((error) => {
  console.error("long-thread-compaction-trial failed:", error);
  process.exit(1);
});
