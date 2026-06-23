/**
 * Shell 命令批准后，在同 Loop 上下文内注入执行结果并续跑（A151 / A166）。
 */
import type { PendingShellApproval } from "@/agent/core/loop-shell-checkpoint";
import type { AgentLoopToolRunResult } from "@/agent/core/agent-loop-tool-runner";
import { buildShellFailureRecoveryHint } from "@/lib/approval-loop-continuation";
import type { AgentMessage, VerificationResult } from "@/agent/types";

function truncate(text: string, max = 2400): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n…[输出已截断]`;
}

function messageText(message: AgentMessage): string {
  if (typeof message.content === "string") return message.content;
  if (Array.isArray(message.content)) {
    return message.content
      .map((part) => ("text" in part ? part.text : ""))
      .join("");
  }
  return "";
}

export type ShellLoopResumeInput = {
  approvalId: string;
  result: VerificationResult;
};

function buildShellRecoveryHint(
  pendingShell: PendingShellApproval,
  result: VerificationResult,
): string | null {
  const approvalLike = {
    id: pendingShell.approvalId,
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
  return buildShellFailureRecoveryHint(
    approvalLike,
    approvalLike,
    result.output
      ? `成功：${result.success ? "是" : "否"}\n输出：\n${result.output}`
      : null,
  );
}

/** 对标 Claude/Cursor：批准后回灌为 tool_result 文本（非 user 续跑消息）。 */
export function buildShellExecutedToolResultContent(input: {
  pendingShell: PendingShellApproval;
  result: VerificationResult;
  priorUserRequest?: string | null;
}): string {
  const { result, pendingShell } = input;
  const shaped = {
    status: "executed_after_approval",
    tool: pendingShell.toolName,
    command: result.command || pendingShell.command,
    success: result.success,
    output: result.output?.trim()
      ? truncate(result.output.trim())
      : "",
    approvalId: pendingShell.approvalId,
  };
  const lines = [
    `Observation from ${pendingShell.toolName}:`,
    JSON.stringify(shaped, null, 2),
  ];
  if (input.priorUserRequest?.trim()) {
    lines.push(`Original user task: ${input.priorUserRequest.trim()}`);
  }
  const recoveryHint = buildShellRecoveryHint(pendingShell, result);
  if (recoveryHint) {
    lines.push(recoveryHint);
  }
  lines.push(
    "Continue the same task. If the goal is met, give a short Chinese final summary.",
    "If the command failed, diagnose and continue with tools (new shell.run.prepare still needs user approval).",
  );
  return lines.join("\n\n");
}

/**
 * 将 shell 执行结果写回 messages：优先替换同 tool_call_id 的 tool 消息（native loop）。
 * JSON 协议回退为替换 Observation user 消息；均失败时返回 false。
 */
export function applyShellExecutionToMessages(
  messages: AgentMessage[],
  input: {
    pendingShell: PendingShellApproval;
    result: VerificationResult;
    priorUserRequest?: string | null;
  },
): boolean {
  const content = buildShellExecutedToolResultContent(input);
  const { toolCallId, toolName } = input.pendingShell;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "tool" && message.tool_call_id === toolCallId) {
      messages[index] = { ...message, content };
      return true;
    }
  }

  const observationPrefix = `Observation from ${toolName}:`;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (
      message?.role === "user" &&
      messageText(message).startsWith(observationPrefix)
    ) {
      messages[index] = { ...message, content };
      return true;
    }
  }

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== "assistant" || !message.tool_calls?.length) continue;
    if (!message.tool_calls.some((call) => call.id === toolCallId)) continue;
    messages.push({
      role: "tool",
      tool_call_id: toolCallId,
      content,
    });
    return true;
  }

  return false;
}

/** Phase A 回退：无 checkpoint / 无法写回 tool_result 时用 user 续跑消息。 */
export function buildShellExecutionResumeMessage(input: {
  pendingShell: PendingShellApproval;
  result: VerificationResult;
  priorUserRequest?: string | null;
}): string {
  const { result, pendingShell } = input;
  const lines = [
    "[SHELL_EXECUTED — in-loop resume fallback]",
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

  const recoveryHint = buildShellRecoveryHint(pendingShell, result);
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
