import type { AgentEvent, ApprovalRequest, VerificationResult } from "@/agent/types";
import { isCommandLikeApproval } from "@/lib/approval-kind";

type ApprovalWithStatus = ApprovalRequest & {
  status?: "pending" | "approved" | "rejected";
};

export type CommandApprovalRecord = ApprovalRequest & {
  status: "pending" | "approved" | "rejected";
};

function executedApprovalIdsFromEvents(events: AgentEvent[]): Set<string> {
  const ids = new Set<string>();
  for (const event of events) {
    if (event.type === "approval.executed") {
      ids.add(event.approvalId);
    }
  }
  return ids;
}

function latestRequiredShellApprovalIdByTask(events: AgentEvent[]): Map<string, string> {
  const latest = new Map<string, string>();
  for (const event of events) {
    if (event.type !== "approval.required") continue;
    if (!isCommandLikeApproval(event.approval)) continue;
    const taskId = event.taskId ?? event.approval.taskId ?? "";
    latest.set(taskId, event.approval.id);
  }
  return latest;
}

function mergeCommandApprovalSnapshot(
  server: CommandApprovalRecord | undefined,
  fromEvent: ApprovalRequest,
): CommandApprovalRecord {
  if (!server) {
    return { ...fromEvent, status: "pending" };
  }
  if (server.status === "rejected") {
    return server;
  }
  if (server.execution?.status === "succeeded" || server.execution?.status === "failed") {
    return server;
  }
  return {
    ...fromEvent,
    ...server,
    details: server.details ?? fromEvent.details,
    status: server.status,
    execution: server.execution,
  };
}

/** 命令审批是否仍等待用户点击「批准并运行」。 */
export function isAwaitingCommandExecution(
  approval: ApprovalWithStatus,
  executedApprovalIds?: ReadonlySet<string>,
): boolean {
  if (!isCommandLikeApproval(approval)) return false;
  if (approval.status === "rejected") return false;
  if (executedApprovalIds?.has(approval.id)) return false;
  const execStatus = approval.execution?.status;
  if (execStatus === "succeeded" || execStatus === "failed") return false;
  return true;
}

/**
 * 对话内联按钮用的待处理命令列表。
 * 同一 task 只保留最新一条 approval.required，避免 Agent 重试后旧命令一直占着黄条。
 */
export function collectPendingCommandApprovals(
  events: AgentEvent[],
  approvals: Array<ApprovalRequest & { status?: "pending" | "approved" | "rejected" }>,
): CommandApprovalRecord[] {
  const executedIds = executedApprovalIdsFromEvents(events);
  const latestRequiredByTask = latestRequiredShellApprovalIdByTask(events);

  const byId = new Map<string, CommandApprovalRecord>();
  for (const approval of approvals) {
    if (isCommandLikeApproval(approval)) {
      byId.set(approval.id, {
        ...approval,
        status: approval.status ?? "pending",
      });
    }
  }
  for (const event of events) {
    if (event.type !== "approval.required") continue;
    if (!isCommandLikeApproval(event.approval)) continue;
    byId.set(
      event.approval.id,
      mergeCommandApprovalSnapshot(byId.get(event.approval.id), event.approval),
    );
  }

  const pending: CommandApprovalRecord[] = [];
  for (const [id, approval] of byId) {
    if (!isAwaitingCommandExecution(approval, executedIds)) continue;
    const taskId = approval.taskId ?? "";
    const latestForTask = latestRequiredByTask.get(taskId);
    if (latestForTask && latestForTask !== id) continue;
    pending.push(approval);
  }

  return pending.sort((left, right) =>
    right.createdAt.localeCompare(left.createdAt),
  );
}

/** 从 execute API 响应里取出 VerificationResult（兼容多种嵌套）。 */
export function extractShellVerificationResult(
  execPayload: Record<string, unknown>,
  approval: ApprovalWithStatus,
): VerificationResult | null {
  const unwrap = (value: unknown): VerificationResult | null => {
    if (!value || typeof value !== "object") return null;
    const row = value as Record<string, unknown>;
    if (
      typeof row.success === "boolean" &&
      typeof row.output === "string" &&
      typeof row.command === "string"
    ) {
      return {
        command: row.command,
        success: row.success,
        output: row.output,
        completedAt:
          typeof row.completedAt === "string"
            ? row.completedAt
            : new Date().toISOString(),
      };
    }
    if (row.result && typeof row.result === "object") {
      return unwrap(row.result);
    }
    return null;
  };

  const fromPayload =
    unwrap(execPayload.result) ??
    unwrap(
      (execPayload.approval as ApprovalWithStatus | undefined)?.execution?.result,
    );
  if (fromPayload) return fromPayload;

  const execution = (execPayload.approval as ApprovalWithStatus | undefined)
    ?.execution?.result as
    | { command?: string; success?: boolean; output?: string }
    | undefined;
  if (execution && typeof execution.success === "boolean") {
    return {
      command: execution.command ?? approval.title,
      success: execution.success,
      output: String(execution.output ?? ""),
      completedAt: new Date().toISOString(),
    };
  }
  return null;
}
