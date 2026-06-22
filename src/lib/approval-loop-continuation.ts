/**
 * 用户批准并执行命令/操作后，构造 Loop 续跑请求（对齐 Cursor 授权后继续）。
 */
import { classifyShellRecoveryPlan } from "@/agent/core/shell-strategy";

type ApprovalLike = {
  id: string;
  title: string;
  taskId?: string | null;
  details?: { kind?: string } | null;
  execution?: {
    status?: string;
    summary?: string;
    error?: string;
    result?: unknown;
  } | null;
};

function truncate(text: string, max = 2400): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n…[输出已截断]`;
}

function formatShellOutput(result: unknown): string | null {
  if (!result || typeof result !== "object") return null;

  const unwrap = (value: unknown): Record<string, unknown> | null => {
    if (!value || typeof value !== "object") return null;
    const row = value as Record<string, unknown>;
    if (
      row.result &&
      typeof row.result === "object" &&
      !("kind" in row) &&
      !("output" in row) &&
      !("command" in row)
    ) {
      return row.result as Record<string, unknown>;
    }
    return row;
  };

  const row = unwrap(result);
  if (!row) return null;

  if (row.kind === "shell_command" || row.output != null || row.command) {
    const parts: string[] = [];
    if (typeof row.command === "string") parts.push(`命令：${row.command}`);
    if (typeof row.success === "boolean") {
      parts.push(`成功：${row.success ? "是" : "否"}`);
    }
    if (typeof row.output === "string" && row.output.trim()) {
      parts.push(`输出：\n${truncate(row.output.trim())}`);
    }
    return parts.join("\n");
  }
  return null;
}

export function buildShellFailureRecoveryHint(
  approval: ApprovalLike,
  executedApproval: ApprovalLike,
  shellText: string | null,
): string | null {
  if (approval.details?.kind !== "shell_command") return null;
  const executed = executedApproval.execution;
  const resultRow = executed?.result as { success?: boolean } | undefined;
  const failed =
    executed?.status === "failed" ||
    resultRow?.success === false ||
    shellText?.includes("成功：否") === true;
  if (!failed) return null;

  const hints: string[] = [
    "命令失败时不得直接 final 结束；必须诊断并给出下一步（可再次 shell.run.prepare，需用户批准）。",
  ];
  const cmd =
    typeof resultRow === "object" &&
    resultRow &&
    "command" in resultRow &&
    typeof (resultRow as { command?: string }).command === "string"
      ? (resultRow as { command: string }).command
      : approval.title;
  const recovery = classifyShellRecoveryPlan({
    command: cmd,
    output: shellText,
    error: executed?.error,
  });
  hints.push(`${recovery.headline}：${recovery.detail}`);
  if (recovery.suggestedCommand) {
    hints.push(
      `下一步建议命令（须 shell.run.prepare + 用户批准）：\`${recovery.suggestedCommand}\``,
    );
  }
  if (recovery.tier === "port_conflict" && !recovery.suggestedCommand) {
    hints.push("也可 prepare 查占用：Windows `netstat -ano | findstr :3000`。");
  }

  return hints.join("\n");
}

export function findUserRequestForTask(
  taskId: string,
  events: Array<{ type: string; taskId?: string; task?: { userRequest?: string } }>,
): string | null {
  for (const event of events) {
    if (event.type === "task.created" && event.taskId === taskId && event.task?.userRequest) {
      return event.task.userRequest;
    }
  }
  return null;
}

export function shouldResumeLoopAfterApprovalExecute(
  approval: ApprovalLike,
): boolean {
  const kind = approval.details?.kind;
  return kind === "shell_command" || kind === "git_mutation";
}

export function buildApprovalLoopContinuationRequest(
  approval: ApprovalLike,
  execPayload: {
    result?: unknown;
    approval?: ApprovalLike;
  },
  priorUserRequest?: string | null,
): string {
  const executed = execPayload.approval?.execution ?? approval.execution;
  const result = execPayload.result ?? executed?.result;
  const lines = [
    "【继续原定任务】用户已批准并执行你先前准备的命令/操作，请据此继续，不要从头重复已完成步骤。",
    "回复第一句必须明确写清：命令已成功 / 命令失败（引用关键输出），然后再说下一步。",
  ];
  if (priorUserRequest?.trim()) {
    lines.push(`原先用户任务：${priorUserRequest.trim()}`);
  }
  lines.push(`已执行操作：${approval.title}`);
  if (executed?.summary) lines.push(`执行摘要：${executed.summary}`);
  if (executed?.error) lines.push(`错误：${executed.error}`);

  const shellText = formatShellOutput(result);
  if (shellText) lines.push(shellText);

  const executedApproval = (execPayload.approval as ApprovalLike | undefined) ?? approval;
  const recoveryHint = buildShellFailureRecoveryHint(
    approval,
    executedApproval,
    shellText,
  );
  if (recoveryHint) lines.push(recoveryHint);

  if (!shellText && result && typeof result === "object") {
    try {
      lines.push(`结果 JSON：${truncate(JSON.stringify(result))}`);
    } catch {
      /* ignore */
    }
  }

  lines.push(
    "请根据上述执行结果继续完成原定目标。",
    "若命令失败且目标未达成：必须继续调用工具诊断/修复，不要只汇报失败就结束。",
    "若任务已完成，用中文给出简短 final 总结。",
  );
  return lines.join("\n\n");
}
