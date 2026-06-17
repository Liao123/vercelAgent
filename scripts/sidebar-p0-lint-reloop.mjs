/**
 * P0 后半段：写后 lint 失败 → 再 Loop 修复（API）。
 */
import fs from "node:fs/promises";
import path from "node:path";

const BASE = process.env.AGENT_BASE_URL ?? "http://localhost:3000";

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

function buildLintFixLoopRequest(verification) {
  const failed = verification.results?.find((item) => !item.success);
  const outputExcerpt = (failed?.output ?? verification.summary ?? "").slice(
    0,
    2000,
  );
  const paths =
    verification.changedPaths?.length > 0
      ? verification.changedPaths.join("、")
      : "（见 lint 输出）";
  return [
    "上一轮写盘后的 lint/typecheck 未通过，请修复错误并重新 file.replace.prepare 生成审批，不要猜测 search 字符串。",
    `涉及文件：${paths}`,
    failed?.command ? `失败命令：${failed.command}` : "",
    "错误输出：",
    outputExcerpt,
  ]
    .filter(Boolean)
    .join("\n");
}

async function main() {
  const verifyPath = path.join(process.cwd(), ".agent-state/post-execute-verify.json");
  let stored;
  try {
    stored = JSON.parse(await fs.readFile(verifyPath, "utf8"));
  } catch {
    throw new Error("missing post-execute-verify.json — run trial --execute first");
  }

  const verification = stored.verification;
  if (!verification?.triggered) {
    throw new Error("post-execute verification was not triggered");
  }
  if (verification.success) {
    console.log("post-execute-verify already passed — skip reloop");
    process.exit(0);
  }

  const userRequest = buildLintFixLoopRequest(verification);
  console.log("lint-reloop request (head):", userRequest.slice(0, 220));

  const loopRes = await fetch(`${BASE}/api/agent/loop`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      userRequest,
      maxIterations: 10,
      uiContext: { layout: "triple", activeRoute: "/" },
    }),
  });
  if (!loopRes.ok || !loopRes.body) {
    const err = await loopRes.json().catch(() => ({}));
    throw new Error(err.error ?? `loop HTTP ${loopRes.status}`);
  }

  const events = await parseSseStream(loopRes);
  const failed = events.find((e) => e.type === "task.failed");
  if (failed) throw new Error(`task.failed: ${failed.error}`);

  const toolNames = events
    .filter((e) => e.type === "tool.completed")
    .map((e) => e.toolCall?.toolName)
    .filter(Boolean);

  console.log("tools:", [...new Set(toolNames)].join(", "));
  if (!toolNames.includes("file.read")) {
    throw new Error("expected file.read in lint reloop");
  }

  console.log("\nsidebar-p0-lint-reloop: PASSED");
}

main().catch((err) => {
  console.error("\nsidebar-p0-lint-reloop: FAILED");
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
