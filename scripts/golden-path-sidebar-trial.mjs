/**
 * 侧栏加号在线试用（A106 / handoff P0）：triple + 「去掉项目行 ＋」。
 *
 * 与 `validate-golden-path`（离线）互补：调真实 Loop + 模型。
 *
 * 用法：
 *   1) npm run dev
 *   2) npm run trial:golden-path-sidebar
 *      或：node scripts/golden-path-sidebar-trial.mjs [workspacePath] [--strict] [--execute]
 *
 * 默认 dry-run 拒绝 approval；--execute 才写盘。
 */
const BASE = process.env.AGENT_BASE_URL ?? "http://localhost:3000";
const argv = process.argv.slice(2);
const executeWrite = argv.includes("--execute");
const strictPrepare = argv.includes("--strict");
const workspacePath = argv.find((a) => !a.startsWith("--")) ?? process.cwd();

const SIDEBAR = "src/components/agent-session-sidebar.tsx";
const PANEL = "src/components/agent-panel.tsx";
const USER_REQUEST =
  "去掉项目行右侧的加号新建会话按钮，侧栏不要显示加号。先用 file.locate 定位侧栏相关文件，再 file.read agent-session-sidebar.tsx 确认 plus 按钮那一行的精确文字，最后用 file.replace.prepare 生成审批，不要直接写盘。完成后用中文总结目标文件路径。";

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
        // ignore
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
    return (
      normalizePath(details.evidence?.path ?? details.preview?.path ?? "") || null
    );
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
  console.log("golden-path-sidebar-trial (A106)");
  console.log("  base:", BASE);
  console.log("  workspace:", workspacePath);
  console.log("  execute write:", executeWrite ? "yes" : "no (dry-run)");
  console.log("  strict prepare:", strictPrepare ? "yes" : "no");

  await ensureServerReachable();

  const wsRes = await fetch(`${BASE}/api/agent/workspace`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rootPath: workspacePath }),
  });
  const wsData = await wsRes.json();
  if (!wsRes.ok) throw new Error(wsData.error ?? "workspace failed");

  const loopRes = await fetch(`${BASE}/api/agent/loop`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      userRequest: USER_REQUEST,
      maxIterations: 14,
      uiContext: UI_CONTEXT,
      strictPrepare,
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
  const approval = events.filter((e) => e.type === "approval.required").at(-1)
    ?.approval;

  console.log("   tools:", [...new Set(toolNames)].join(", ") || "(none)");
  console.log("   filesRead:", filesRead.join(", ") || "(none)");

  assertCheck(
    toolNames.includes("file.locate") ||
      toolNames.includes("ui.trace_from_page") ||
      toolNames.includes("jsx.find_text"),
    `expected locate/trace/jsx in tool chain, got: ${toolNames.join(", ")}`,
  );

  const usedPrepare = toolNames.some((name) =>
    ["file.replace.prepare", "file.mutation.prepare", "patch.prepare"].includes(
      name,
    ),
  );
  const usedRecovery = toolNames.includes("edit.recovery");

  if (strictPrepare) {
    assertCheck(usedPrepare, "expected model prepare in --strict mode");
    assertCheck(!usedRecovery, "edit.recovery should not run in --strict mode");
  } else if (usedRecovery && !usedPrepare) {
    console.log("   ⚠ 模型未 prepare，由 edit.recovery 兜底");
  }

  assertCheck(approval?.id, "no approval.required");
  assertCheck(
    filesRead.includes(SIDEBAR),
    `file.read should include ${SIDEBAR}, got: ${filesRead.join(", ")}`,
  );

  const targetPath = resolveApprovalTargetPath(approval);
  assertCheck(targetPath === SIDEBAR, `approval should target ${SIDEBAR}, got ${targetPath}`);
  assertCheck(targetPath !== PANEL, `should not target panel status string: ${targetPath}`);

  if (executeWrite) {
    await fetch(`${BASE}/api/agent/approvals`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ approvalId: approval.id, status: "approved" }),
    });
    const execRes = await fetch(`${BASE}/api/agent/approvals/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ approvalId: approval.id }),
    });
    const execData = await execRes.json();
    if (!execRes.ok) throw new Error(execData.error ?? "execute failed");
    const pev = execData.postExecuteVerification;
    if (pev?.triggered) {
      console.log("   postExecuteVerification:", pev.success ? "passed" : "failed");
      console.log("   postExecute summary:", pev.summary?.slice(0, 120));
    }
  } else {
    await fetch(`${BASE}/api/agent/approvals`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ approvalId: approval.id, status: "rejected" }),
    });
  }

  console.log("\ngolden-path-sidebar-trial: PASSED");
  console.log("   target:", targetPath);
}

main().catch((err) => {
  console.error("\ngolden-path-sidebar-trial: FAILED");
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
