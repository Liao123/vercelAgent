"use client";

import { useState } from "react";
import type { AgentEvent } from "@/agent/types";
import { formatCompactionCheckpoint } from "@/lib/compaction-labels";
import { GitStatusView } from "@/components/git-status-view";
import { type GitStatusSnapshot } from "@/lib/git-status";
import { ChevronIcon } from "@/components/chevron-icon";
import { formatReflectionBlockersLine } from "@/lib/reflection-blockers-ui";
import { agentToolIcon } from "@/lib/agent-tool-icons";
import {
  agentToolIssueLabel,
  formatAgentToolIssueDetail,
  formatAgentToolAction,
} from "@/lib/agent-tool-display";

function isGitStatusSnapshot(value: unknown): value is GitStatusSnapshot {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.summary === "string" &&
    typeof record.dirty === "boolean" &&
    Array.isArray(record.files)
  );
}

function Chevron({ open }: { open: boolean }) {
  return <ChevronIcon expanded={open} className="h-4 w-4 text-zinc-400" />;
}

function toolIcon(toolName?: string): React.ReactNode {
  return agentToolIcon(toolName);
}

function WorkedLine({
  label,
  detail,
  detailNode,
  tone = "neutral",
  defaultOpen = false,
  icon,
}: {
  label: string;
  detail?: string;
  detailNode?: React.ReactNode;
  tone?: "neutral" | "warn" | "error";
  defaultOpen?: boolean;
  icon?: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const expandable = Boolean(detail || detailNode);

  return (
    <div className="py-0.5">
      <button
        type="button"
        disabled={!expandable}
        onClick={() => expandable && setOpen((v) => !v)}
        className={`flex w-full items-start gap-1.5 text-left text-[12px] leading-snug ${
          tone === "error"
            ? "text-red-700 dark:text-red-300"
            : tone === "warn"
              ? "text-amber-700 dark:text-amber-400"
            : "text-zinc-600 dark:text-zinc-400"
        } ${expandable ? "cursor-pointer hover:text-zinc-800 dark:hover:text-zinc-200" : "cursor-default"}`}
      >
        {expandable ? (
          <Chevron open={open} />
        ) : (
          (icon ?? <span className="w-3.5 shrink-0" />)
        )}
        <span className="min-w-0 flex-1">{label}</span>
      </button>
      {open && detailNode && (
        <div className="ml-5 mt-1 max-h-40 overflow-auto rounded-md bg-zinc-50/80 p-2 dark:bg-zinc-900/60">
          {detailNode}
        </div>
      )}
      {open && !detailNode && detail && (
        <pre className="ml-5 mt-1 max-h-36 overflow-auto whitespace-pre-wrap break-words rounded-md bg-zinc-50/80 p-2 font-mono text-[10px] text-zinc-600 dark:bg-zinc-900/60 dark:text-zinc-400">
          {detail}
        </pre>
      )}
    </div>
  );
}

export function TurnWorkedLine({
  event,
  taskStillRunning = false,
}: {
  event: AgentEvent;
  taskStillRunning?: boolean;
}) {
  switch (event.type) {
    case "tool.completed": {
      const gitSnapshot = isGitStatusSnapshot(event.result)
        ? event.result
        : null;
      const display = formatAgentToolAction({
        toolName: event.toolCall.toolName,
        args: event.toolCall.args,
        result: event.result,
        error: event.toolCall.error,
      });
      const issue = event.toolCall.error
        ? agentToolIssueLabel({ taskStillRunning })
        : null;
      const label = `${display.action}${display.target ? ` · ${display.target}` : ""}${issue ? ` · ${issue}` : ""}`;
      const detail = gitSnapshot
        ? null
        : event.toolCall.error
          ? formatAgentToolIssueDetail(event.toolCall.error)
        : event.result &&
            typeof event.result === "object" &&
            typeof (event.result as Record<string, unknown>).content ===
              "string"
          ? String((event.result as Record<string, unknown>).content).slice(
              0,
              800,
            )
          : undefined;
      return (
        <WorkedLine
          label={label}
          detail={detail ?? undefined}
          detailNode={
            gitSnapshot ? (
              <GitStatusView snapshot={gitSnapshot} compact maxFiles={12} />
            ) : undefined
          }
          tone={event.toolCall.error ? "warn" : "neutral"}
          defaultOpen={Boolean(gitSnapshot?.dirty)}
          icon={toolIcon(event.toolCall.toolName)}
        />
      );
    }
    case "tool.started":
      {
        const display = formatAgentToolAction({
          toolName: event.toolCall.toolName,
          args: event.toolCall.args,
          running: true,
        });
        return (
          <WorkedLine
            label={`${display.action}${display.target ? ` · ${display.target}` : ""}…`}
            icon={toolIcon(event.toolCall.toolName)}
          />
        );
      }
    case "context.compacted": {
      const display = formatCompactionCheckpoint({
        method: event.method,
        round: event.round,
        contextWindow: event.contextWindow,
        pinnedApprovalCount: event.pinnedApprovalCount,
        changedFileCount: event.changedFileCount,
        estimatedTokensBefore: event.estimatedTokensBefore,
        estimatedTokensAfter: event.estimatedTokensAfter,
        layersApplied: event.layersApplied,
        summaryPreview: event.summaryPreview,
        memoryContent: event.memoryContent,
      });
      return (
        <WorkedLine
          label={display.label}
          detail={display.detail}
          icon={toolIcon()}
        />
      );
    }
    case "reflection.updated":
      return (
        <WorkedLine
          label={`反思 · ${event.reflection.plannedNext.slice(0, 80)}${event.reflection.plannedNext.length > 80 ? "…" : ""}`}
          detail={[
            event.reflection.understanding,
            event.reflection.blockers.length > 0
              ? formatReflectionBlockersLine(event.reflection.blockers, {
                  taskStillRunning,
                })
              : null,
            event.reflection.plannedNext,
          ]
            .filter(Boolean)
            .join("\n")}
        />
      );
    case "model.delta":
      return (
        <WorkedLine
          label={`模型输出 · ${event.text.slice(0, 72)}${event.text.length > 72 ? "…" : ""}`}
          detail={event.text.length > 72 ? event.text : undefined}
        />
      );
    default:
      return null;
  }
}

export function TurnHighlightLine({
  event,
  pendingCommandApprovalIds,
  executedCommandApprovalIds,
  onApproveCommand,
  onRejectCommand,
  commandApprovalBusy,
}: {
  event: AgentEvent;
  pendingCommandApprovalIds?: Set<string>;
  executedCommandApprovalIds?: Set<string>;
  onApproveCommand?: (approvalId: string) => void;
  onRejectCommand?: (approvalId: string) => void;
  commandApprovalBusy?: boolean;
}) {
  if (event.type === "approval.required") {
    const command =
      event.approval.details?.kind === "shell_command"
        ? event.approval.details.preview.command
        : null;
    const isShell = event.approval.details?.kind === "shell_command";
    const alreadyExecuted =
      executedCommandApprovalIds?.has(event.approval.id) ?? false;
    const isPending =
      isShell &&
      !alreadyExecuted &&
      (pendingCommandApprovalIds?.has(event.approval.id) ?? false);

    if (isShell && !isPending) {
      return null;
    }

    const canInlineApprove =
      isPending && Boolean(onApproveCommand && onRejectCommand);

    if (canInlineApprove) {
      return (
        <div className="rounded-xl border border-amber-200/90 bg-amber-50/90 px-3.5 py-3 dark:border-amber-900/60 dark:bg-amber-950/35">
          <p className="text-[12px] font-medium text-amber-900 dark:text-amber-100">
            待运行命令
          </p>
          <p className="mt-1 font-mono text-[13px] text-zinc-900 dark:text-zinc-100">
            {command ?? event.approval.title}
          </p>
          {event.approval.reason ? (
            <p className="mt-1.5 text-[12px] leading-relaxed text-zinc-600 dark:text-zinc-400">
              {event.approval.reason}
            </p>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={commandApprovalBusy}
              onClick={() => onRejectCommand?.(event.approval.id)}
              className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-[12px] font-medium text-zinc-700 transition hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              拒绝
            </button>
            <button
              type="button"
              disabled={commandApprovalBusy}
              onClick={() => onApproveCommand?.(event.approval.id)}
              className="rounded-lg bg-amber-600 px-3 py-1.5 text-[12px] font-semibold text-white transition hover:bg-amber-700 disabled:opacity-50"
            >
              {commandApprovalBusy ? "运行中…" : "批准并运行"}
            </button>
          </div>
        </div>
      );
    }

    return (
      <WorkedLine
        label={`待授权命令 · ${command ?? event.approval.title}`}
        detail={[event.approval.reason, command ? `命令：${command}` : null]
          .filter(Boolean)
          .join("\n")}
        tone="neutral"
        defaultOpen
      />
    );
  }

  if (event.type === "approval.executed") {
    const detail = event.output ?? event.summary;
    return (
      <WorkedLine
        label={
          event.status === "succeeded"
            ? `命令已成功 · ${event.command}`
            : `命令执行失败 · ${event.command}`
        }
        detail={detail}
        tone={event.status === "succeeded" ? "neutral" : "error"}
        defaultOpen
      />
    );
  }

  if (event.type === "verification.completed") {
    return (
      <WorkedLine
        label={
          event.result.success
            ? `命令输出 · ${event.result.command}`
            : `命令失败 · ${event.result.command}`
        }
        detail={event.result.output.slice(0, 2000)}
        tone={event.result.success ? "neutral" : "error"}
        defaultOpen={!event.result.success}
      />
    );
  }

  return null;
}
