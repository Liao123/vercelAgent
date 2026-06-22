/**
 * A141-follow 在线试用：dev 命令失败后续跑是否 prepare recovery 命令。
 *
 * 用法：
 *   1) npm run dev
 *   2) npm run trial:shell-recovery
 *      或：npx tsx scripts/shell-recovery-trial.ts "D:\path\to\workspace"
 */
import fs from "node:fs";
import { buildApprovalLoopContinuationRequest } from "../src/lib/approval-loop-continuation.ts";

const BASE = process.env.AGENT_BASE_URL ?? "http://localhost:3000";

function resolveWorkspacePath(): string {
  const fromEnv = process.env.AGENT_TRIAL_WORKSPACE?.trim();
  if (fromEnv && fs.existsSync(fromEnv) && fs.statSync(fromEnv).isDirectory()) {
    return fromEnv;
  }
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith("--")) continue;
    if (!fs.existsSync(arg)) continue;
    if (!fs.statSync(arg).isDirectory()) continue;
    return arg;
  }
  return process.cwd();
}

const workspacePath = resolveWorkspacePath();
const USER_REQUEST = "跑一下 dev 看看项目能不能启动，不能的话想办法换端口";

type AgentEvent = {
  type: string;
  toolCall?: { toolName?: string };
  result?: Record<string, unknown>;
  approval?: { title?: string; id?: string; details?: { preview?: { command?: string } } };
};

type ApprovalRow = {
  id: string;
  status: string;
  title: string;
  details?: { kind?: string; preview?: { command?: string } };
  execution?: { status?: string; result?: unknown };
};

async function parseSseStream(response: Response): Promise<AgentEvent[]> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const events: AgentEvent[] = [];
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
        events.push(JSON.parse(line.slice(6)) as AgentEvent);
      } catch {
        /* ignore */
      }
    }
  }
  return events;
}

function collectShellPrepares(events: AgentEvent[]) {
  const rows: Array<{ name: string; command: string }> = [];
  for (const event of events) {
    if (event.type !== "tool.completed") continue;
    const name = event.toolCall?.toolName ?? "";
    if (name !== "shell.run.prepare" && name !== "shell.command.prepare") continue;
    const result = event.result ?? {};
    const preview = result.preview as { command?: string } | undefined;
    const approval = result.approval as { title?: string } | undefined;
    const cmd = preview?.command ?? approval?.title ?? "";
    rows.push({ name, command: String(cmd) });
  }
  return rows;
}

async function setWorkspace(rootPath: string) {
  const res = await fetch(`${BASE}/api/agent/workspace`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rootPath }),
  });
  if (!res.ok) throw new Error(`workspace: ${await res.text()}`);
}

async function runLoop(userRequest: string) {
  const res = await fetch(`${BASE}/api/agent/loop`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userRequest }),
  });
  if (!res.ok) throw new Error(`loop: ${await res.text()}`);
  return parseSseStream(res);
}

async function findPendingShellApproval(): Promise<ApprovalRow | undefined> {
  const res = await fetch(`${BASE}/api/agent/approvals?limit=20`);
  const data = (await res.json()) as { approvals?: ApprovalRow[] };
  const list = data.approvals ?? [];
  return list.find(
    (a) =>
      a.status === "pending" &&
      a.details?.kind === "shell_command" &&
      /dev/i.test(`${a.title}${a.details?.preview?.command ?? ""}`),
  );
}

async function approveAndExecute(approvalId: string) {
  const patch = await fetch(`${BASE}/api/agent/approvals`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ approvalId, status: "approved" }),
  });
  if (!patch.ok) throw new Error(`approve: ${await patch.text()}`);
  const exec = await fetch(`${BASE}/api/agent/approvals/execute`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ approvalId }),
  });
  const payload = (await exec.json()) as { approval?: ApprovalRow; error?: string; result?: unknown };
  return { ok: exec.ok, payload };
}

async function main() {
  console.log("shell-recovery-trial (A141-follow)");
  console.log("workspace:", workspacePath);
  console.log("base:", BASE);

  await setWorkspace(workspacePath);

  console.log("\n[1/3] 首轮 Loop");
  const phase1 = await runLoop(USER_REQUEST);
  const prepares1 = collectShellPrepares(phase1);
  console.log("  shell prepares:", prepares1.length);
  if (prepares1.length === 0 && !phase1.some((e) => e.type === "approval.required")) {
    throw new Error("首轮未产生 shell prepare 或 approval.required");
  }

  const approval = await findPendingShellApproval();
  if (!approval) throw new Error("未找到 pending 的 dev shell 审批");

  console.log("\n[2/3] 批准并执行:", approval.title);
  const { ok, payload } = await approveAndExecute(approval.id);
  console.log("  execute ok:", ok, payload.approval?.execution?.status ?? payload.error);

  const executed = payload.approval ?? approval;
  const continuation = buildApprovalLoopContinuationRequest(
    executed,
    payload,
    USER_REQUEST,
  );

  console.log("\n[3/3] 续跑 Loop");
  const phase2 = await runLoop(continuation);
  const prepares2 = collectShellPrepares(phase2);
  const blob = JSON.stringify(phase2);
  const hasRecovery =
    prepares2.some((p) => /--port\s*\d+|5175|netstat|findstr/i.test(p.command)) ||
    /--port\s*\d+|5175|netstat|findstr/i.test(blob);

  console.log("  phase2 prepares:", prepares2);
  if (!hasRecovery) {
    throw new Error("续跑未 prepare 换端口/诊断命令");
  }

  console.log("\nshell-recovery-trial: PASSED");
}

main().catch((err) => {
  console.error("\nshell-recovery-trial: FAILED");
  console.error(err);
  process.exit(1);
});
