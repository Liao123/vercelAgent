"use client";

import { useState } from "react";
import { DiffView } from "@/components/diff-view";
import { PatchFilesDiffView } from "@/components/patch-files-diff";
import type { ApprovalDetails } from "@/agent/types";
import { approvalAnchorId } from "@/lib/approval-anchor";
import { formatPatchPreviewSummary } from "@/lib/patch-summary";

export type InlineApprovalView = {
  id: string;
  taskId: string;
  title: string;
  reason: string;
  risk: "low" | "medium" | "high";
  action: string;
  createdAt: string;
  status: "pending" | "approved" | "rejected";
  details?: ApprovalDetails;
  execution?: {
    status: "succeeded" | "failed";
    attemptedAt: string;
    summary: string;
    error?: string;
    result?: unknown;
  };
};

type AgentInlineApprovalsProps = {
  approvals: InlineApprovalView[];
  currentTaskId?: string | null;
  loading: boolean;
  pushConfirmId: string | null;
  focusedApprovalId?: string | null;
  onReject: (id: string) => void;
  onApprove: (id: string) => void;
  onApproveAndExecute: (approval: InlineApprovalView) => void;
  onExecute: (approval: InlineApprovalView) => void;
  needsPushSecondConfirm: (approval: InlineApprovalView) => boolean;
};

function approvalOneLiner(details?: ApprovalDetails): string | null {
  if (!details) return null;
  if (details.kind === "patch_apply") {
    return formatPatchPreviewSummary(details.preview);
  }
  if (details.kind === "file_mutation") {
    const p = details.preview;
    return p.path ?? p.toPath ?? p.fromPath ?? null;
  }
  if (details.kind === "git_mutation") {
    return details.preview.command;
  }
  if (details.kind === "shell_command") {
    return details.preview.command;
  }
  return null;
}

function CompactApprovalCard({
  approval,
  currentTaskId,
  loading,
  pushConfirmId,
  highlighted,
  onReject,
  onApprove,
  onApproveAndExecute,
  onExecute,
  needsPushSecondConfirm,
}: {
  approval: InlineApprovalView;
  currentTaskId?: string | null;
  loading: boolean;
  pushConfirmId: string | null;
  highlighted: boolean;
  onReject: (id: string) => void;
  onApprove: (id: string) => void;
  onApproveAndExecute: (approval: InlineApprovalView) => void;
  onExecute: (approval: InlineApprovalView) => void;
  needsPushSecondConfirm: (approval: InlineApprovalView) => boolean;
}) {
  const [showDiff, setShowDiff] = useState(false);
  const line = approvalOneLiner(approval.details);
  const isHistorical =
    Boolean(currentTaskId) && approval.taskId !== currentTaskId;
  const highlightClass = highlighted
    ? "ring-2 ring-blue-500 ring-offset-2 ring-offset-white dark:ring-offset-zinc-950"
    : "";

  if (approval.status === "rejected") {
    return (
      <div
        id={approvalAnchorId(approval.id)}
        className={`rounded-lg border border-zinc-200/80 bg-zinc-50 px-2.5 py-2 text-[11px] dark:border-zinc-800 dark:bg-zinc-900/40 ${highlightClass}`}
      >
        <span className="text-zinc-600 dark:text-zinc-400">
          {approval.title}
          {isHistorical ? " · 历史" : ""} · 已拒绝
        </span>
      </div>
    );
  }

  if (approval.status === "approved" && approval.execution?.status !== "succeeded") {
    return (
      <div
        id={approvalAnchorId(approval.id)}
        className={`rounded-lg border border-blue-200/80 bg-blue-50/40 px-2.5 py-2 dark:border-blue-900 dark:bg-blue-950/20 ${highlightClass}`}
      >
        <p className="text-[11px] font-medium text-zinc-900 dark:text-zinc-100">
          {approval.title}
          {isHistorical ? " · 历史" : ""} · 已批准
        </p>
        {line && (
          <p className="mt-0.5 truncate font-mono text-[10px] text-zinc-600">
            {line}
          </p>
        )}
        <button
          type="button"
          disabled={loading}
          onClick={() => onExecute(approval)}
          className="mt-2 rounded-md bg-blue-600 px-2 py-1 text-[10px] font-medium text-white disabled:opacity-50"
        >
          {needsPushSecondConfirm(approval) && pushConfirmId === approval.id
            ? "确认 Push"
            : "执行"}
        </button>
      </div>
    );
  }

  return (
    <div
      id={approvalAnchorId(approval.id)}
      className={`rounded-lg border border-amber-300/80 bg-amber-50/50 px-2.5 py-2 dark:border-amber-900/60 dark:bg-amber-950/20 ${highlightClass}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[11px] font-medium text-zinc-900 dark:text-zinc-100">
            {approval.title}
            {isHistorical && (
              <span className="ml-1.5 rounded bg-zinc-200 px-1 py-0.5 text-[9px] font-normal text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                历史
              </span>
            )}
          </p>
          {line && (
            <p className="mt-0.5 truncate font-mono text-[10px] text-zinc-600 dark:text-zinc-400">
              {line}
            </p>
          )}
        </div>
        <span className="shrink-0 text-[10px] text-amber-700 dark:text-amber-400">
          待授权
        </span>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <button
          type="button"
          disabled={loading}
          onClick={() => onReject(approval.id)}
          className="rounded-md border border-zinc-300 px-2 py-1 text-[10px] disabled:opacity-50 dark:border-zinc-600"
        >
          拒绝
        </button>
        {approval.details && (
          <button
            type="button"
            disabled={loading}
            onClick={() => onApproveAndExecute(approval)}
            className="rounded-md bg-blue-600 px-2 py-1 text-[10px] font-medium text-white disabled:opacity-50"
          >
            批准并执行
          </button>
        )}
        {!approval.details && (
          <button
            type="button"
            disabled={loading}
            onClick={() => onApprove(approval.id)}
            className="rounded-md bg-zinc-800 px-2 py-1 text-[10px] text-white disabled:opacity-50 dark:bg-zinc-200 dark:text-zinc-900"
          >
            批准
          </button>
        )}
        {approval.details && (
          <button
            type="button"
            onClick={() => setShowDiff((v) => !v)}
            className="rounded-md px-2 py-1 text-[10px] text-zinc-600 underline dark:text-zinc-400"
          >
            {showDiff ? "收起" : "查看 diff"}
          </button>
        )}
      </div>
      {showDiff && approval.details?.kind === "patch_apply" && (
        <div className="mt-2">
          <PatchFilesDiffView files={approval.details.preview.files} />
        </div>
      )}
      {showDiff &&
        approval.details?.kind === "file_mutation" &&
        (approval.details.preview.oldContent ||
          approval.details.preview.newContent) && (
          <div className="mt-2">
            <DiffView
              before={approval.details.preview.oldContent}
              after={approval.details.preview.newContent}
              layout="split"
              showLayoutToggle={false}
            />
          </div>
        )}
    </div>
  );
}

export function AgentInlineApprovals({
  focusedApprovalId = null,
  currentTaskId = null,
  ...props
}: AgentInlineApprovalsProps) {
  const actionable = props.approvals.filter(
    (a) =>
      a.status === "pending" ||
      (a.status === "approved" && a.execution?.status !== "succeeded"),
  );
  if (actionable.length === 0) return null;

  const historicalCount = actionable.filter(
    (a) => currentTaskId && a.taskId !== currentTaskId,
  ).length;
  const sectionLabel =
    historicalCount === actionable.length && historicalCount > 0
      ? `历史待授权 (${actionable.length})`
      : `待你授权 (${actionable.length})`;

  return (
    <div className="mt-3 space-y-2 border-t border-zinc-200/80 pt-3 dark:border-zinc-800">
      <p className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">
        {sectionLabel}
      </p>
      {historicalCount > 0 && historicalCount < actionable.length && (
        <p className="text-[10px] text-zinc-500">
          含 {historicalCount} 条历史任务审批；右侧「变更审查」可筛选「仅本次任务」。
        </p>
      )}
      {actionable.map((approval) => (
        <CompactApprovalCard
          key={approval.id}
          approval={approval}
          currentTaskId={currentTaskId}
          highlighted={focusedApprovalId === approval.id}
          {...props}
        />
      ))}
    </div>
  );
}
