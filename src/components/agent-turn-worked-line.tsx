"use client";

import { useState } from "react";
import type { AgentEvent } from "@/agent/types";
import { formatCompactionMeta } from "@/lib/compaction-labels";
import { GitStatusView } from "@/components/git-status-view";
import { type GitStatusSnapshot } from "@/lib/git-status";
import { formatPatchToolResultSummary } from "@/lib/patch-summary";
import { ChevronIcon } from "@/components/chevron-icon";
import { agentToolIcon } from "@/lib/agent-tool-icons";

const TOOL_LABELS: Record<string, string> = {
  "workspace.inspect": "检查工作区",
  "project.index": "索引项目",
  "file.locate": "定位文件",
  "ui.trace_from_page": "追踪页面组件树",
  "file.list": "列出目录",
  "file.read": "读取文件",
  "file.search": "搜索文件",
  "jsx.find_text": "查找 JSX 文案",
  "symbol.find_references": "查找符号引用",
  "git.status": "Git 状态",
  "git.diff": "Git diff",
  "browser.open": "打开浏览器",
  "browser.inspect": "读取浏览器快照",
  "browser.wait_and_inspect": "等待并读取页面",
  "browser.query": "查询页面元素",
  "devtools.get_screenshot": "CDP 截图",
  "devtools.get_dom_snapshot": "DOM 快照",
  "devtools.get_accessibility_tree": "无障碍树",
  "devtools.get_console_errors": "Console 日志",
  "devtools.get_network_requests": "Network 请求",
  "devtools.click": "页面点击",
  "devtools.type": "页面输入",
  "devtools.get_box_model": "元素盒模型",
  "devtools.get_computed_style": "计算样式",
  "devtools.inspect_element_at": "坐标探测元素",
  "file.mutation.prepare": "准备文件变更",
  "file.replace.prepare": "准备文本替换",
  "git.mutation.prepare": "准备 Git 操作",
  "shell.command.prepare": "准备 npm 脚本",
  "shell.run.prepare": "准备终端命令",
  "patch.prepare": "准备 Patch",
};

function toolLabel(name: string): string {
  return TOOL_LABELS[name] ?? name;
}

function isGitStatusSnapshot(value: unknown): value is GitStatusSnapshot {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.summary === "string" &&
    typeof record.dirty === "boolean" &&
    Array.isArray(record.files)
  );
}

function summarizeToolResult(result: unknown): string | null {
  const patchHint = formatPatchToolResultSummary(result);
  if (patchHint) return patchHint;
  if (!result || typeof result !== "object") return null;
  const record = result as Record<string, unknown>;
  if (typeof record.summary === "string") return record.summary;
  if (record.preview && typeof record.preview === "object") {
    const preview = record.preview as { command?: string };
    if (typeof preview.command === "string") return preview.command;
  }
  if (typeof record.path === "string") return record.path;
  if (Array.isArray(record.candidates)) {
    return `${record.candidates.length} 个候选`;
  }
  return null;
}

function Chevron({ open }: { open: boolean }) {
  return (
    <ChevronIcon expanded={open} className="h-4 w-4 text-zinc-400" />
  );
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
  tone?: "neutral" | "error";
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
            : "text-zinc-600 dark:text-zinc-400"
        } ${expandable ? "cursor-pointer hover:text-zinc-800 dark:hover:text-zinc-200" : "cursor-default"}`}
      >
        {expandable ? <Chevron open={open} /> : icon ?? <span className="w-3.5 shrink-0" />}
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
}: {
  event: AgentEvent;
}) {
  switch (event.type) {
    case "tool.completed": {
      const hint = summarizeToolResult(event.result);
      const gitSnapshot = isGitStatusSnapshot(event.result) ? event.result : null;
      const label = event.toolCall.error
        ? `${toolLabel(event.toolCall.toolName)} · 失败`
        : `${toolLabel(event.toolCall.toolName)}${hint ? ` · ${hint}` : ""}`;
      const detail =
        gitSnapshot ? null : (
          event.result &&
          typeof event.result === "object" &&
          typeof (event.result as Record<string, unknown>).content === "string"
            ? String((event.result as Record<string, unknown>).content).slice(0, 800)
            : undefined
        );
      return (
        <WorkedLine
          label={label}
          detail={detail ?? undefined}
          detailNode={
            gitSnapshot ? (
              <GitStatusView snapshot={gitSnapshot} compact maxFiles={12} />
            ) : undefined
          }
          tone={event.toolCall.error ? "error" : "neutral"}
          defaultOpen={Boolean(event.toolCall.error || gitSnapshot?.dirty)}
          icon={toolIcon(event.toolCall.toolName)}
        />
      );
    }
    case "tool.started":
      return (
        <WorkedLine
          label={`${toolLabel(event.toolCall.toolName)} · 运行中…`}
          icon={toolIcon(event.toolCall.toolName)}
        />
      );
    case "context.compacted": {
      const meta = formatCompactionMeta({
        method: event.method,
        round: event.round,
        pinnedApprovalCount: event.pinnedApprovalCount,
        changedFileCount: event.changedFileCount,
        estimatedTokensBefore: event.estimatedTokensBefore,
        estimatedTokensAfter: event.estimatedTokensAfter,
        layersApplied: event.layersApplied,
      });
      return (
        <WorkedLine
          label={`压缩上下文${event.round != null ? ` · 第 ${event.round} 轮` : ""}`}
          detail={meta ? `${meta}\n\n${event.summaryPreview ?? ""}` : event.summaryPreview}
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
              ? `阻塞：${event.reflection.blockers.join("；")}`
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
  onApproveCommand,
  onRejectCommand,
  commandApprovalBusy,
}: {
  event: AgentEvent;
  pendingCommandApprovalIds?: Set<string>;
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
    const isPending =
      isShell &&
      (pendingCommandApprovalIds?.has(event.approval.id) ?? false);
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
