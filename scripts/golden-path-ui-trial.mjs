/**
 * UI 黄金路径在线试用（A082）：triple 布局 + 「去掉首页闭环/Loop」。
 *
 * 与 `validate-golden-path`（离线规则）互补：本脚本调真实 Loop + 模型。
 *
 * 用法：
 *   1) 终端 A：npm run dev
 *   2) 终端 B：npm run trial:golden-path-ui
 *      或：node scripts/golden-path-ui-trial.mjs [workspacePath] [--execute]
 *
 * 默认 **不执行写盘**：校验通过后拒绝 approval，避免改动 composer。
 * 加 `--execute` 才会批准并 execute（仅本地试玩时使用）。
 * 加 `--strict` 则要求模型必须走 file.replace.prepare（不允许仅靠 edit.recovery）。
 *
 * 环境：AGENT_BASE_URL（默认 http://localhost:3000）
 */
const BASE = process.env.AGENT_BASE_URL ?? "http://localhost:3000";
const argv = process.argv.slice(2);
const executeWrite = argv.includes("--execute");
const strictPrepare = argv.includes("--strict");
const workspacePath = argv.find((a) => !a.startsWith("--")) ?? process.cwd();

const COMPOSER = "src/components/agent-composer.tsx";
const PANEL = "src/components/agent-panel.tsx";
const USER_REQUEST =
  "请把 agent-composer 输入框 placeholder 改成「描述要做的改动（@ 附加文件，Enter 发送）」。先用 ui.trace_from_page 或 file.locate 定位 composer，再 file.read 确认当前 placeholder 精确文字，最后用 file.replace.prepare 生成审批，不要直接写盘。完成后用中文总结目标文件路径。";

const UI_CONTEXT = { layout: "triple", activeRoute: "/" };

function normalizePath(filePath) {
  return String(filePath).replaceAll("\\", "/").replace(/^\.\/+/, "");
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
        // ignore malformed chunk
      }
    }
  }
  return events;
}

function collectToolNames(events) {
  const names = [];
  for (const event of events) {
    if (event.type === "tool.completed" && event.toolCall?.toolName) {
      names.push(event.toolCall.toolName);
    }
  }
  return names;
}

function collectFileReadPaths(events) {
  const paths = [];
  for (const event of events) {
    if (event.type !== "tool.completed" || event.toolCall?.toolName !== "file.read") {
      continue;
    }
    const result = event.result;
    if (result && typeof result === "object" && typeof result.path === "string") {
      paths.push(normalizePath(result.path));
    }
  }
  return paths;
}

function resolveApprovalTargetPath(approval) {
  const details = approval?.details;
  if (!details) return null;
  if (details.kind === "file_mutation") {
    return normalizePath(
      details.evidence?.path ?? details.preview?.path ?? "",
    ) || null;
  }
  if (details.kind === "patch_apply") {
    const files = details.preview?.files ?? [];
    const first = files.find((f) => f?.filePath)?.filePath;
    return first ? normalizePath(first) : null;
  }
  return null;
}

function assertCheck(condition, message) {
  if (!condition) throw new Error(message);
}

async function ensureServerReachable() {
  const res = await fetch(`${BASE}/api/agent/workspace`, {
    signal: AbortSignal.timeout(8_000),
  }).catch(() => null);
  if (!res?.ok) {
    throw new Error(
      `无法连接 ${BASE}。请先运行 npm run dev，或设置 AGENT_BASE_URL。`,
    );
  }
}

async function main() {
  console.log("golden-path-ui-trial (A082)");
  console.log("  base:", BASE);
  console.log("  workspace:", workspacePath);
  console.log("  uiContext:", JSON.stringify(UI_CONTEXT));
  console.log("  execute write:", executeWrite ? "yes" : "no (dry-run, will reject approval)");
  console.log("  strict prepare:", strictPrepare ? "yes" : "no (recovery allowed if target correct)");

  await ensureServerReachable();

  console.log("\n1) 设置 workspace…");
  const wsRes = await fetch(`${BASE}/api/agent/workspace`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rootPath: workspacePath }),
  });
  const wsData = await wsRes.json();
  if (!wsRes.ok) throw new Error(wsData.error ?? "workspace failed");
  console.log("   ok:", wsData.workspace?.packageName ?? wsData.workspace?.framework);

  console.log("\n2) 运行 Agent Loop（layout=triple）…");
  const loopRes = await fetch(`${BASE}/api/agent/loop`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      userRequest: USER_REQUEST,
      maxIterations: 14,
      uiContext: UI_CONTEXT,
      strictPrepare: strictPrepare,
    }),
  });
  if (!loopRes.ok || !loopRes.body) {
    const err = await loopRes.json().catch(() => ({}));
    throw new Error(err.error ?? `loop HTTP ${loopRes.status}`);
  }

  const events = await parseSseStream(loopRes);
  const failed = events.find((e) => e.type === "task.failed");
  const completed = events.find((e) => e.type === "task.completed");
  if (failed) throw new Error(`task.failed: ${failed.error}`);
  assertCheck(completed, "task did not complete — check model / API key");

  const toolNames = collectToolNames(events);
  const filesRead = collectFileReadPaths(events);
  const approvalEvents = events.filter((e) => e.type === "approval.required");
  const approval = approvalEvents.at(-1)?.approval;

  console.log("   summary:", completed.summary?.slice(0, 160));
  console.log("   tools:", [...new Set(toolNames)].join(", ") || "(none)");
  console.log("   filesRead:", filesRead.join(", ") || "(none)");

  assertCheck(
    toolNames.includes("ui.trace_from_page") || toolNames.includes("file.locate"),
    `expected ui.trace_from_page or file.locate in tool chain, got: ${toolNames.join(", ")}`,
  );

  const usedPrepare = toolNames.some(
    (name) =>
      name === "file.replace.prepare" ||
      name === "file.mutation.prepare" ||
      name === "patch.prepare",
  );
  const usedRecovery = toolNames.includes("edit.recovery");

  if (strictPrepare) {
    assertCheck(
      usedPrepare,
      `expected model prepare tool (not only edit.recovery). tools: ${[...new Set(toolNames)].join(", ")}`,
    );
    assertCheck(
      !usedRecovery,
      "edit.recovery fallback should not run in --strict mode",
    );
  } else if (usedRecovery && !usedPrepare) {
    console.log(
      "   ⚠ 模型未调用 prepare，由 edit.recovery 兜底（文件定位仍算通过；加 --strict 可强制要求 prepare）",
    );
  }
  assertCheck(approval?.id, "no approval.required — model did not prepare a change");
  assertCheck(
    filesRead.includes(COMPOSER),
    `file.read should include ${COMPOSER}, got: ${filesRead.join(", ")}`,
  );

  const targetPath = resolveApprovalTargetPath(approval);
  assertCheck(targetPath, "approval missing target path in details");
  assertCheck(
    targetPath === COMPOSER,
    `approval should target ${COMPOSER}, got ${targetPath}`,
  );
  assertCheck(
    !targetPath.startsWith("src/agent/core/"),
    `should not target agent runtime: ${targetPath}`,
  );
  assertCheck(
    targetPath !== PANEL,
    `triple layout should not prepare ${PANEL} for composer placeholder UI`,
  );

  const evidence = approval.details?.evidence;
  if (evidence?.path) {
    assertCheck(
      normalizePath(evidence.path) === COMPOSER,
      `evidence path should be composer, got ${evidence.path}`,
    );
  }

  console.log("\n3) 审批校验通过:", approval.id);
  console.log("   title:", approval.title);
  console.log("   target:", targetPath);
  if (evidence?.matchedSnippet) {
    console.log("   evidence L", evidence.startLine, "-", evidence.endLine);
  }

  if (executeWrite) {
    console.log("\n4) --execute：批准并写盘…");
    const approveRes = await fetch(`${BASE}/api/agent/approvals`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ approvalId: approval.id, status: "approved" }),
    });
    const approveData = await approveRes.json();
    if (!approveRes.ok) throw new Error(approveData.error ?? "approve failed");

    const execRes = await fetch(`${BASE}/api/agent/approvals/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ approvalId: approval.id }),
    });
    const execData = await execRes.json();
    if (!execRes.ok) throw new Error(execData.error ?? "execute failed");
    console.log("   execution:", execData.approval?.execution?.status ?? "ok");
  } else {
    console.log("\n4) dry-run：拒绝 approval（不写盘）…");
    const rejectRes = await fetch(`${BASE}/api/agent/approvals`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ approvalId: approval.id, status: "rejected" }),
    });
    const rejectData = await rejectRes.json();
    if (!rejectRes.ok) throw new Error(rejectData.error ?? "reject failed");
    console.log("   rejected:", approval.id);
  }

  console.log("\ngolden-path-ui-trial: PASSED");
  console.log("   layout: triple");
  console.log("   approval:", approval.id);
  console.log("   target:", targetPath);
}

main().catch((err) => {
  console.error("\ngolden-path-ui-trial: FAILED");
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
