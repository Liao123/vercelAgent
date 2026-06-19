import type { AgentEvent, ApprovalRequest } from "@/agent/types";
import type { VerificationResult } from "@/agent/types";
import { summarizeShellFailureOutput, formatShellOutputForDisplay } from "@/agent/tools/shell-output";

export function shellCommandFromApproval(approval: ApprovalRequest): string {
  const preview = approval.details?.kind === "shell_command" ? approval.details.preview : null;
  return preview?.command ?? approval.title;
}

export function buildCommandResultNotice(result: VerificationResult): {
  message: string;
  tone: "success" | "error";
  statusLine: string;
} {
  const cmd = result.command;
  if (result.success) {
    const tail = formatShellOutputForDisplay(result.output)
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .slice(-6)
      .join("\n");
    const statusLine = `命令已成功：${cmd}`;
    const message = tail
      ? `${statusLine}\n\n输出（末尾）：\n${tail}`
      : `${statusLine}\n\n（命令无控制台输出）`;
    return { message, tone: "success", statusLine };
  }
  const err = summarizeShellFailureOutput(result.output);
  const statusLine = `命令失败：${cmd}`;
  return {
    message: `${statusLine}\n\n${err}`,
    tone: "error",
    statusLine,
  };
}

export function buildApprovalExecutedEvent(input: {
  taskId: string;
  approvalId: string;
  title: string;
  command: string;
  result: VerificationResult;
  summary?: string;
}): AgentEvent {
  return {
    type: "approval.executed",
    taskId: input.taskId,
    approvalId: input.approvalId,
    title: input.title,
    command: input.result.command || input.command,
    status: input.result.success ? "succeeded" : "failed",
    output: input.result.success
      ? input.result.output.slice(0, 4000)
      : summarizeShellFailureOutput(input.result.output),
    summary: input.summary,
  };
}

export function buildAssistantNoticeEvent(input: {
  taskId: string;
  message: string;
  tone: "success" | "error" | "neutral";
}): AgentEvent {
  return {
    type: "assistant.notice",
    taskId: input.taskId,
    message: input.message,
    tone: input.tone,
  };
}

export function buildShellVerificationEvent(input: {
  taskId: string;
  result: VerificationResult;
}): AgentEvent {
  return {
    type: "verification.completed",
    taskId: input.taskId,
    result: input.result,
  };
}

export function appendApprovalExecutionEvents(
  current: AgentEvent[],
  input: {
    taskId: string;
    approval: ApprovalRequest;
    result: VerificationResult;
    summary?: string;
  },
): AgentEvent[] {
  const notice = buildCommandResultNotice(input.result);
  return [
    ...current,
    buildApprovalExecutedEvent({
      taskId: input.taskId,
      approvalId: input.approval.id,
      title: input.approval.title,
      command: shellCommandFromApproval(input.approval),
      result: input.result,
      summary: input.summary,
    }),
    buildAssistantNoticeEvent({
      taskId: input.taskId,
      message: notice.message,
      tone: notice.tone,
    }),
    buildShellVerificationEvent({
      taskId: input.taskId,
      result: input.result,
    }),
  ];
}
