/**
 * Shell 命令批准后，在同 Loop 上下文内注入执行结果并续跑（A151）。
 */
import type { PendingShellApproval } from "@/agent/core/loop-shell-checkpoint";
import type { AgentLoopToolRunResult } from "@/agent/core/agent-loop-tool-runner";
import { buildShellFailureRecoveryHint } from "@/lib/approval-loop-continuation";
import type { VerificationResult } from "@/agent/types";

function truncate(text: string, max = 2400): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n…[输出已截断]`;
}

export type ShellLoopResumeInput = {
  approvalId: string;
  result: VerificationResult;
};

export function buildShellExecutionResumeMessage(input: {
  pendingShell: PendingShellApproval;
  result: VerificationResult;
  priorUserRequest?: string | null;
}): string {
  const { result, pendingShell } = input;
  const lines = [
    "[SHELL_EXECUTED — in-loop resume]",
    "User approved and ran the prepared shell command. Continue the same task in this conversation.",
    "Do not repeat completed gather/prepare steps. Reply first with success/failure citing key output.",
    "",
    `Tool: ${pendingShell.toolName}`,
    `Command: ${result.command || pendingShell.command}`,
    `Success: ${result.success ? "yes" : "no"}`,
  ];
  if (input.priorUserRequest?.trim()) {
    lines.push(`Original user task: ${input.priorUserRequest.trim()}`);
  }
  if (result.output?.trim()) {
    lines.push(`Output:\n${truncate(result.output.trim())}`);
  }

  const approvalLike = {
    id: input.pendingShell.approvalId,
    title: pendingShell.command,
    details: { kind: "shell_command" as const },
    execution: {
      status: result.success ? "succeeded" : "failed",
      result: {
        kind: "shell_command",
        command: result.command,
        success: result.success,
        output: result.output,
      },
    },
  };
  const recoveryHint = buildShellFailureRecoveryHint(
    approvalLike,
    approvalLike,
    result.output ? `成功：${result.success ? "是" : "否"}\n输出：\n${result.output}` : null,
  );
  if (recoveryHint) lines.push(recoveryHint);

  lines.push(
    "If the goal is met, give a short Chinese final summary.",
    "If the command failed and the goal is not met, continue with tools (new shell.run.prepare still needs user approval).",
  );
  return lines.join("\n\n");
}

export function pendingShellFromToolRun(
  toolName: string,
  toolCallId: string,
  runResult: AgentLoopToolRunResult,
): PendingShellApproval | null {
  if (!runResult.pendingShellApproval) return null;
  return {
    toolCallId,
    toolName,
    approvalId: runResult.pendingShellApproval.approvalId,
    command: runResult.pendingShellApproval.command,
  };
}
