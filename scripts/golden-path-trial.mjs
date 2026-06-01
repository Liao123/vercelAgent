/**
 * 黄金路径试用：设置 workspace → Agent Loop → 批准 → 执行。
 * 用法：npx tsx scripts/golden-path-trial.mjs [workspacePath]
 *
 * UI 准确度黄金路径（triple + 闭环/Loop）见：npm run trial:golden-path-ui
 */
const BASE = process.env.AGENT_BASE_URL ?? "http://localhost:3000";
const workspacePath = process.argv[2] ?? "D:\\案例\\aiproject";

const userRequest =
  "请读取 index.html，把 <h1> 里的「欢迎来到演示站」改成「你好，这是 AI 改的项目」。使用 file.replace.prepare 生成审批，不要直接写文件。最后 action=final 说明 approval id。";

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
      const line = part
        .split("\n")
        .find((l) => l.startsWith("data: "));
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

async function main() {
  console.log("1) 设置 workspace:", workspacePath);
  const wsRes = await fetch(`${BASE}/api/agent/workspace`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rootPath: workspacePath }),
  });
  const wsData = await wsRes.json();
  if (!wsRes.ok) throw new Error(wsData.error ?? "workspace failed");
  console.log("   framework:", wsData.workspace?.framework ?? wsData.workspace?.packageName);

  console.log("2) 运行 Agent Loop…");
  const loopRes = await fetch(`${BASE}/api/agent/loop`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userRequest, maxIterations: 12 }),
  });
  if (!loopRes.ok || !loopRes.body) {
    const err = await loopRes.json().catch(() => ({}));
    throw new Error(err.error ?? `loop HTTP ${loopRes.status}`);
  }

  const events = await parseSseStream(loopRes);
  const approvalEvents = events.filter((e) => e.type === "approval.required");
  const completed = events.find((e) => e.type === "task.completed");
  const failed = events.find((e) => e.type === "task.failed");

  if (failed) throw new Error(`task.failed: ${failed.error}`);
  if (!completed) throw new Error("task did not complete");

  console.log("   summary:", completed.summary?.slice(0, 200));

  const approval = approvalEvents.at(-1)?.approval;
  if (!approval?.id) {
    throw new Error("no approval.required event — golden path blocked");
  }
  console.log("3) 待审批:", approval.id, approval.title);

  console.log("4) 批准…");
  const approveRes = await fetch(`${BASE}/api/agent/approvals`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ approvalId: approval.id, status: "approved" }),
  });
  const approveData = await approveRes.json();
  if (!approveRes.ok) throw new Error(approveData.error ?? "approve failed");

  console.log("5) 执行写盘…");
  const execRes = await fetch(`${BASE}/api/agent/approvals/execute`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ approvalId: approval.id }),
  });
  const execData = await execRes.json();
  if (!execRes.ok) throw new Error(execData.error ?? "execute failed");

  console.log("6) 验证 index.html …");
  const fs = await import("node:fs/promises");
  const html = await fs.readFile(`${workspacePath}\\index.html`, "utf8");
  const ok = html.includes("你好，这是 AI 改的项目") && !html.includes("欢迎来到演示站");
  if (!ok) {
    console.error(html);
    throw new Error("file content verification failed");
  }

  console.log("\ngolden-path-trial: PASSED");
  console.log("   approval:", approval.id);
  console.log("   execution:", execData.approval?.execution?.status ?? "ok");
}

main().catch((err) => {
  console.error("\ngolden-path-trial: FAILED");
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
