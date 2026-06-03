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
  "file.mutation.prepare": "准备文件变更",
  "file.replace.prepare": "准备文本替换",
  "git.mutation.prepare": "准备 Git 操作",
  "shell.command.prepare": "准备 npm 脚本",
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

export function TurnHighlightLine({ event }: { event: AgentEvent }) {
  if (event.type === "verification.completed" && !event.result.success) {
    return (
      <WorkedLine
        label={`验证失败 · ${event.result.command}`}
        detail={event.result.output.slice(0, 1500)}
        tone="error"
        defaultOpen
      />
    );
  }
  return null;
}
