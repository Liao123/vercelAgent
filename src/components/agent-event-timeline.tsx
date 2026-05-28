"use client";

import { useMemo, useState } from "react";
import type { AgentEvent } from "@/agent/types";
import {
  formatPatchPreviewSummary,
  formatPatchToolResultSummary,
} from "@/lib/patch-summary";
import { extractApprovalIdFromUnknown } from "@/lib/approval-anchor";

type EventFilter =
  | "all"
  | "tools"
  | "approvals"
  | "planning"
  | "results"
  | "other";

function toolLabel(name: string): string {
  const labels: Record<string, string> = {
    "workspace.inspect": "检查工作区",
    "project.index": "索引项目",
    "file.locate": "定位文件",
    "file.list": "列出目录",
    "file.read": "读取文件",
    "file.search": "搜索文件",
    "git.status": "Git 状态",
    "git.diff": "Git diff",
    "browser.open": "打开浏览器",
    "file.mutation.prepare": "准备文件变更",
    "file.replace.prepare": "准备文本替换",
    "git.mutation.prepare": "准备 Git 操作",
    "shell.command.prepare": "准备 npm 脚本",
    "patch.prepare": "准备 Patch",
  };
  return labels[name] ?? name;
}

function eventCategory(event: AgentEvent): EventFilter {
  if (event.type.startsWith("tool.")) return "tools";
  if (event.type === "approval.required") return "approvals";
  if (
    event.type === "plan.updated" ||
    event.type === "reflection.updated"
  ) {
    return "planning";
  }
  if (
    event.type === "task.completed" ||
    event.type === "task.failed" ||
    event.type === "verification.completed" ||
    event.type === "file.changed"
  ) {
    return "results";
  }
  if (event.type === "task.created" || event.type === "model.delta") {
    return "other";
  }
  return "other";
}

/** 合并 tool.started 到对应的 tool.completed，减少重复行。 */
function compressToolEvents(events: AgentEvent[]): AgentEvent[] {
  const result: AgentEvent[] = [];
  const pendingStarted = new Map<string, AgentEvent>();

  for (const event of events) {
    if (event.type === "tool.started") {
      pendingStarted.set(event.toolCall.id, event);
      continue;
    }
    if (event.type === "tool.completed") {
      pendingStarted.delete(event.toolCall.id);
      result.push(event);
      continue;
    }
    result.push(event);
  }

  for (const started of pendingStarted.values()) {
    result.push(started);
  }

  return result;
}

function summarizeToolResult(result: unknown): string | null {
  const patchHint = formatPatchToolResultSummary(result);
  if (patchHint) return patchHint;

  if (!result || typeof result !== "object") return null;
  const record = result as Record<string, unknown>;
  if (typeof record.summary === "string") return record.summary;
  if (record.approval && typeof record.approval === "object") {
    const approval = record.approval as { title?: string };
    return approval.title ? `已创建审批：${approval.title}` : "已创建审批请求";
  }
  if (Array.isArray(record.candidates)) {
    return `找到 ${record.candidates.length} 个候选文件`;
  }
  if (typeof record.path === "string") return record.path;
  return null;
}

function formatToolDetail(result: unknown): string | null {
  if (!result || typeof result !== "object") return null;
  const record = result as Record<string, unknown>;
  if (typeof record.content === "string" && record.content.length > 0) {
    const preview =
      record.content.length > 1200
        ? `${record.content.slice(0, 1200)}\n…`
        : record.content;
    return preview;
  }
  if (typeof record.stdout === "string" && record.stdout.trim()) {
    return record.stdout.slice(0, 800);
  }
  return null;
}

function RowFocusButton({
  label,
  onActivate,
}: {
  label: string;
  onActivate: () => void;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onActivate();
      }}
      className="shrink-0 rounded border border-blue-300 bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-800 transition hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-200 dark:hover:bg-blue-900"
    >
      {label}
    </button>
  );
}

function CollapsibleEventRow({
  tone,
  title,
  summary,
  detail,
  meta,
  debugJson,
  showDebug,
  defaultOpen = false,
  compact = false,
  focusApprovalId,
  onFocusApproval,
  focusActionLabel = "查看审批",
}: {
  tone: "neutral" | "info" | "success" | "warn" | "error";
  title: string;
  summary?: string;
  detail?: string;
  meta?: string;
  debugJson?: unknown;
  showDebug: boolean;
  defaultOpen?: boolean;
  compact?: boolean;
  focusApprovalId?: string | null;
  onFocusApproval?: (approvalId: string) => void;
  focusActionLabel?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const hasExpandable = Boolean(detail) || (showDebug && debugJson !== undefined);

  const toneClass =
    tone === "success"
      ? "border-emerald-200 bg-emerald-50/60 dark:border-emerald-900 dark:bg-emerald-950/30"
      : tone === "warn"
        ? "border-amber-200 bg-amber-50/60 dark:border-amber-900 dark:bg-amber-950/30"
        : tone === "error"
          ? "border-red-200 bg-red-50/60 dark:border-red-900 dark:bg-red-950/30"
          : tone === "info"
            ? "border-blue-200 bg-blue-50/60 dark:border-blue-900 dark:bg-blue-950/30"
            : "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950";

  const canFocusApproval = Boolean(focusApprovalId && onFocusApproval);

  return (
    <article
      className={`rounded-md border text-xs ${compact ? "px-2 py-1.5" : "rounded-lg px-3 py-2"} ${toneClass}${
        canFocusApproval ? " cursor-pointer ring-0 transition hover:ring-1 hover:ring-blue-300/80 dark:hover:ring-blue-700/80" : ""
      }`}
      role={canFocusApproval ? "button" : undefined}
      tabIndex={canFocusApproval ? 0 : undefined}
      onClick={
        canFocusApproval
          ? () => onFocusApproval!(focusApprovalId!)
          : undefined
      }
      onKeyDown={
        canFocusApproval
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onFocusApproval!(focusApprovalId!);
              }
            }
          : undefined
      }
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-medium text-zinc-900 dark:text-zinc-100">{title}</p>
          {meta && (
            <p className="mt-0.5 font-mono text-[10px] text-zinc-500">{meta}</p>
          )}
          {summary && (
            <p className="mt-1 whitespace-pre-wrap break-words text-zinc-600 dark:text-zinc-400">
              {summary}
            </p>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {canFocusApproval && (
            <RowFocusButton
              label={focusActionLabel}
              onActivate={() => onFocusApproval!(focusApprovalId!)}
            />
          )}
          {hasExpandable && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setOpen((v) => !v);
              }}
              className="rounded border border-zinc-300 px-2 py-0.5 text-[10px] text-zinc-600 dark:border-zinc-600 dark:text-zinc-400"
            >
              {open ? "收起" : "展开"}
            </button>
          )}
        </div>
      </div>
      {open && detail && (
        <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-zinc-950 p-2 text-[10px] text-zinc-300">
          {detail}
        </pre>
      )}
      {showDebug && debugJson !== undefined && (
        <pre className="mt-2 max-h-40 overflow-auto rounded bg-zinc-950 p-2 text-[10px] text-zinc-300">
          {JSON.stringify(debugJson, null, 2)}
        </pre>
      )}
    </article>
  );
}

function EventRow({
  tone,
  title,
  body,
  meta,
  debugJson,
  showDebug,
  compact = false,
  focusApprovalId,
  onFocusApproval,
}: {
  tone: "neutral" | "info" | "success" | "warn" | "error";
  title: string;
  body?: string;
  meta?: string;
  debugJson?: unknown;
  showDebug: boolean;
  compact?: boolean;
  focusApprovalId?: string | null;
  onFocusApproval?: (approvalId: string) => void;
}) {
  return (
    <CollapsibleEventRow
      tone={tone}
      title={title}
      summary={body}
      meta={meta}
      debugJson={debugJson}
      showDebug={showDebug}
      defaultOpen={tone === "error"}
      compact={compact}
      focusApprovalId={focusApprovalId}
      onFocusApproval={onFocusApproval}
    />
  );
}

function renderEvent(
  event: AgentEvent,
  index: number,
  showDebug: boolean,
  compact: boolean,
  onFocusApproval?: (approvalId: string) => void,
  onFocusCompactedMemory?: () => void,
) {
  switch (event.type) {
    case "task.created":
      return (
        <EventRow
          key={`${event.type}-${index}`}
          tone="info"
          title="任务已开始"
          meta={event.taskId}
          showDebug={showDebug}
          debugJson={event}
          compact={compact}
        />
      );
    case "plan.updated":
      return (
        <CollapsibleEventRow
          key={`${event.type}-${index}`}
          tone="neutral"
          title="计划"
          summary={event.plan.goal}
          meta={event.plan.steps
            .map((step) => `${step.status}: ${step.title}`)
            .join(" · ")}
          detail={event.plan.steps
            .map((step) => `- [${step.status}] ${step.title}`)
            .join("\n")}
          showDebug={showDebug}
          debugJson={event}
          compact={compact}
        />
      );
    case "context.compacted": {
      const tokenMeta =
        event.estimatedTokensBefore != null &&
        event.estimatedTokensAfter != null
          ? `约 ${event.estimatedTokensBefore} → ${event.estimatedTokensAfter} tokens`
          : undefined;
      const metaParts = [
        event.method,
        event.round != null ? `第 ${event.round} 轮` : null,
        event.pinnedApprovalCount
          ? `${event.pinnedApprovalCount} 个审批`
          : null,
        event.changedFileCount != null
          ? `${event.changedFileCount} 个文件`
          : null,
        tokenMeta,
      ].filter(Boolean);
      return (
        <CollapsibleEventRow
          key={`${event.type}-${index}`}
          tone="info"
          title="上下文已压缩"
          summary={event.summaryPreview ?? "滚动任务记忆已更新"}
          meta={metaParts.join(" · ")}
          detail={event.memoryContent ?? event.summaryPreview}
          showDebug={showDebug}
          debugJson={event}
          compact={compact}
          focusApprovalId={onFocusCompactedMemory ? "__memory__" : null}
          onFocusApproval={
            onFocusCompactedMemory
              ? () => onFocusCompactedMemory()
              : undefined
          }
          focusActionLabel="查看记忆"
        />
      );
    }
    case "reflection.updated":
      return (
        <CollapsibleEventRow
          key={`${event.type}-${index}`}
          tone="info"
          title="反思"
          summary={[event.reflection.understanding, event.reflection.plannedNext]
            .filter(Boolean)
            .join("\n")}
          meta={
            event.reflection.blockers.length > 0
              ? `阻塞: ${event.reflection.blockers.join("; ")}`
              : undefined
          }
          showDebug={showDebug}
          debugJson={event}
          compact={compact}
        />
      );
    case "tool.started":
      return (
        <EventRow
          key={`${event.type}-${index}`}
          tone="neutral"
          title={`工具 · ${toolLabel(event.toolCall.toolName)}`}
          meta="运行中…"
          showDebug={showDebug}
          debugJson={event}
          compact={compact}
        />
      );
    case "tool.completed": {
      const hint = summarizeToolResult(event.result);
      const detail = formatToolDetail(event.result);
      const linkedApprovalId = extractApprovalIdFromUnknown(event.result);
      return (
        <CollapsibleEventRow
          key={`${event.type}-${index}`}
          tone={event.toolCall.error ? "error" : "success"}
          title={`工具 · ${toolLabel(event.toolCall.toolName)}`}
          summary={event.toolCall.error ?? hint ?? "完成"}
          detail={detail ?? undefined}
          showDebug={showDebug}
          debugJson={event}
          defaultOpen={Boolean(event.toolCall.error)}
          compact={compact}
          focusApprovalId={linkedApprovalId}
          onFocusApproval={onFocusApproval}
        />
      );
    }
    case "approval.required": {
      const patchLine =
        event.approval.details?.kind === "patch_apply"
          ? formatPatchPreviewSummary(event.approval.details.preview)
          : null;
      return (
        <EventRow
          key={`${event.type}-${index}`}
          tone="warn"
          title={`待审批 · ${event.approval.title}`}
          body={[event.approval.reason, patchLine]
            .filter(Boolean)
            .join("\n")}
          showDebug={showDebug}
          debugJson={event}
          compact={compact}
          focusApprovalId={event.approval.id}
          onFocusApproval={onFocusApproval}
        />
      );
    }
    case "verification.completed":
      return (
        <CollapsibleEventRow
          key={`${event.type}-${index}`}
          tone={event.result.success ? "success" : "error"}
          title={`验证 · ${event.result.command}`}
          summary={
            event.result.success ? "通过" : "失败"
          }
          detail={event.result.output.slice(0, 2000)}
          showDebug={showDebug}
          debugJson={event}
          defaultOpen={!event.result.success}
          compact={compact}
        />
      );
    case "file.changed":
      return (
        <EventRow
          key={`${event.type}-${index}`}
          tone="success"
          title="文件已变更"
          meta={event.filePath}
          showDebug={showDebug}
          debugJson={event}
          compact={compact}
        />
      );
    case "task.completed":
      return (
        <EventRow
          key={`${event.type}-${index}`}
          tone="success"
          title="任务完成"
          body={event.summary}
          showDebug={showDebug}
          debugJson={event}
          compact={compact}
        />
      );
    case "task.failed":
      return (
        <EventRow
          key={`${event.type}-${index}`}
          tone="error"
          title="任务失败"
          body={event.error}
          showDebug={showDebug}
          debugJson={event}
          compact={compact}
        />
      );
    case "model.delta":
      return (
        <CollapsibleEventRow
          key={`${event.type}-${index}`}
          tone="neutral"
          title="模型输出"
          summary={event.text.slice(0, 280)}
          detail={event.text.length > 280 ? event.text : undefined}
          showDebug={showDebug}
          debugJson={event}
          compact={compact}
        />
      );
    default:
      return null;
  }
}

const FILTER_OPTIONS: { id: EventFilter; label: string }[] = [
  { id: "all", label: "全部" },
  { id: "tools", label: "工具" },
  { id: "approvals", label: "审批" },
  { id: "planning", label: "计划" },
  { id: "results", label: "结果" },
  { id: "other", label: "其它" },
];

type AgentEventTimelineProps = {
  events: AgentEvent[];
  running: boolean;
  density?: "comfortable" | "compact";
  /** 不在中栏展示的事件类型（如 plan 放右侧栏） */
  excludeEventTypes?: AgentEvent["type"][];
  /** 活动流为空时提示可从左侧任务历史恢复 */
  showRestoreHint?: boolean;
  /** 点击带审批的活动行时，滚动定位到审查/内联审批卡片 */
  onFocusApproval?: (approvalId: string) => void;
  /** 点击「上下文已压缩」时，滚动到滚动任务记忆面板 */
  onFocusCompactedMemory?: () => void;
};

export function AgentEventTimeline({
  events,
  running,
  density = "comfortable",
  excludeEventTypes = [],
  showRestoreHint = false,
  onFocusApproval,
  onFocusCompactedMemory,
}: AgentEventTimelineProps) {
  const compact = density === "compact";
  const excludeSet = useMemo(
    () => new Set(excludeEventTypes),
    [excludeEventTypes],
  );
  const [filter, setFilter] = useState<EventFilter>("all");
  const [showDebug, setShowDebug] = useState(false);
  const [collapseTools, setCollapseTools] = useState(true);

  const compressed = useMemo(
    () => (collapseTools ? compressToolEvents(events) : events),
    [collapseTools, events],
  );

  const visible = useMemo(() => {
    return compressed.filter((event) => {
      if (excludeSet.has(event.type)) return false;
      if (
        event.type === "thread.created" ||
        event.type === "turn.created" ||
        event.type === "trace.linked"
      ) {
        return false;
      }
      if (filter === "all") return true;
      return eventCategory(event) === filter;
    });
  }, [compressed, excludeSet, filter]);

  return (
    <section
      className={`flex min-h-0 flex-1 flex-col ${compact ? "gap-1" : "gap-2"}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-1.5">
        {!compact && (
          <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
            活动
          </h3>
        )}
        {compact && <span className="text-[10px] font-medium text-zinc-500">活动流</span>}
        {running && (
          <span className="text-[11px] text-blue-600 dark:text-blue-400">
            运行中…
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1">
        {FILTER_OPTIONS.map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => setFilter(option.id)}
            className={`rounded-md px-2 py-0.5 text-[11px] transition ${
              filter === option.id
                ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950"
                : "text-zinc-600 hover:bg-zinc-200/80 dark:text-zinc-400 dark:hover:bg-zinc-800"
            }`}
          >
            {option.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setCollapseTools((v) => !v)}
          className={`rounded-md px-2 py-0.5 text-[11px] transition ${
            collapseTools
              ? "bg-zinc-800 text-white dark:bg-zinc-200 dark:text-zinc-900"
              : "border border-zinc-300 text-zinc-600 dark:border-zinc-600"
          }`}
          title="合并 tool.started 与 tool.completed"
        >
          {collapseTools ? "已合并工具事件" : "显示全部工具事件"}
        </button>
        <button
          type="button"
          onClick={() => setShowDebug((v) => !v)}
          className={`ml-auto rounded-md px-2 py-0.5 text-[11px] transition ${
            showDebug
              ? "bg-amber-600 text-white"
              : "border border-zinc-300 text-zinc-600 dark:border-zinc-600 dark:text-zinc-400"
          }`}
        >
          {showDebug ? "隐藏 JSON" : "调试 JSON"}
        </button>
      </div>
      <div
        className={`min-h-0 flex-1 overflow-auto pr-1 ${compact ? "space-y-1" : "space-y-2"}`}
      >
        {visible.length === 0 && !running && events.length === 0 && (
          <p className="rounded-lg border border-dashed border-zinc-300 px-3 py-8 text-center text-sm text-zinc-500 dark:border-zinc-700">
            {showRestoreHint ? (
              <>
                活动流为空。在左侧「任务」列表点击某条记录，可恢复该任务的活动流与审批。
                <span className="mt-2 block text-xs text-zinc-400">
                  或在下方输入新任务并点击「运行」。
                </span>
              </>
            ) : (
              "描述你的编程任务，Agent 会在这里展示计划、工具调用与审批。"
            )}
          </p>
        )}
        {running && visible.length === 0 && (
          <p className="rounded-lg bg-zinc-50 px-3 py-6 text-center text-sm text-zinc-500 dark:bg-zinc-900">
            正在启动 Agent…
          </p>
        )}
        {visible.length === 0 && !running && events.length > 0 && (
          <p className="text-center text-xs text-zinc-500">
            当前筛选下没有事件，试试「全部」。
          </p>
        )}
        {visible.map((event, index) =>
          renderEvent(
            event,
            index,
            showDebug,
            compact,
            onFocusApproval,
            onFocusCompactedMemory,
          ),
        )}
      </div>
    </section>
  );
}
