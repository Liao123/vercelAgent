"use client";

import type { ApprovalRequest } from "@/agent/types";

type ApprovalRecordView = ApprovalRequest & {
  status: "pending" | "approved" | "rejected";
};

type AgentCommandApprovalBarProps = {
  pending: ApprovalRecordView[];
  loading: boolean;
  onApproveAndExecute: (approval: ApprovalRecordView) => void;
  onReject: (approvalId: string) => void;
};

function describeCommand(approval: ApprovalRecordView): string {
  const details = approval.details;
  if (!details) return approval.title;
  if (details.kind === "shell_command") {
    return `npm run ${details.operation.script}`;
  }
  if (details.kind === "git_mutation") {
    const op = details.operation;
    if (op.type === "branch") return `git branch ${op.branchName}`;
    if (op.type === "commit") return `git commit`;
    if (op.type === "push") return `git push`;
  }
  return approval.action || approval.title;
}

/** 中栏底部命令授权条（对齐 Cursor/Codex：跑命令时再弹出） */
export function AgentCommandApprovalBar({
  pending,
  loading,
  onApproveAndExecute,
  onReject,
}: AgentCommandApprovalBarProps) {
  if (pending.length === 0) return null;

  const primary = pending[0];

  return (
    <div
      className="shrink-0 border-t border-amber-200/80 bg-amber-50/95 px-4 py-3 shadow-[0_-4px_24px_rgba(0,0,0,0.06)] backdrop-blur-sm dark:border-amber-900/50 dark:bg-amber-950/90"
      role="region"
      aria-label="命令授权"
    >
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold text-amber-900 dark:text-amber-100">
            需要授权运行命令
            {pending.length > 1 ? `（${pending.length} 项待处理）` : ""}
          </p>
          <p className="mt-0.5 truncate font-mono text-[12px] text-amber-800 dark:text-amber-200">
            {describeCommand(primary)}
          </p>
          <p className="mt-1 text-[10px] text-amber-700/90 dark:text-amber-300/80">
            {primary.reason}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            disabled={loading}
            onClick={() => onReject(primary.id)}
            className="rounded-lg border border-amber-300 px-3 py-1.5 text-[11px] font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50 dark:border-amber-800 dark:text-amber-100 dark:hover:bg-amber-900"
          >
            拒绝
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={() => onApproveAndExecute(primary)}
            className="rounded-lg bg-amber-600 px-3 py-1.5 text-[11px] font-medium text-white hover:bg-amber-700 disabled:opacity-50 dark:bg-amber-500 dark:hover:bg-amber-400"
          >
            批准并运行
          </button>
        </div>
      </div>
    </div>
  );
}
