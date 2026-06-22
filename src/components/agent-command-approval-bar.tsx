"use client";

import type { CommandApprovalRecord } from "@/lib/command-approval-state";
import { shellCommandFromApproval } from "@/lib/approval-chat-events";

type AgentCommandApprovalBarProps = {
  approvals: CommandApprovalRecord[];
  busy?: boolean;
  onApprove: (approvalId: string) => void;
  onReject: (approvalId: string) => void;
};

function commandLabel(approval: CommandApprovalRecord): string {
  if (approval.details?.kind === "shell_command") {
    return approval.details.preview.command;
  }
  return shellCommandFromApproval(approval);
}

export function AgentCommandApprovalBar({
  approvals,
  busy = false,
  onApprove,
  onReject,
}: AgentCommandApprovalBarProps) {
  const shellPending = approvals.filter(
    (approval) => approval.details?.kind === "shell_command",
  );
  if (shellPending.length === 0) return null;

  const primary = shellPending[0]!;
  const command = commandLabel(primary);
  const extraCount = shellPending.length - 1;

  return (
    <div
      className="border-t border-amber-200/90 bg-amber-50/95 px-4 py-3 dark:border-amber-900/50 dark:bg-amber-950/40"
      role="region"
      aria-label="待批准命令"
    >
      <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-medium text-amber-900 dark:text-amber-100">
            待运行命令
            {extraCount > 0 ? `（另有 ${extraCount} 条）` : ""}
          </p>
          <p className="mt-0.5 truncate font-mono text-[13px] text-zinc-900 dark:text-zinc-100">
            {command}
          </p>
          {primary.reason ? (
            <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-zinc-600 dark:text-zinc-400">
              {primary.reason}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => onReject(primary.id)}
            className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-[12px] font-medium text-zinc-700 transition hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            拒绝
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => onApprove(primary.id)}
            className="rounded-lg bg-amber-600 px-3 py-1.5 text-[12px] font-semibold text-white transition hover:bg-amber-700 disabled:opacity-50"
          >
            {busy ? "运行中…" : "批准并运行"}
          </button>
        </div>
      </div>
    </div>
  );
}
