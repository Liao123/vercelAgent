"use client";

import { useMemo, useState, type ReactNode } from "react";
import type { AgentEvent } from "@/agent/types";
import { AgentTurnBlock } from "@/components/agent-turn-block";
import { groupEventsIntoTurns } from "@/lib/agent-turn-feed";
import {
  formatPatchPreviewSummary,
  formatPatchToolResultSummary,
} from "@/lib/patch-summary";
import { formatCompactionMeta } from "@/lib/compaction-labels";
import { formatReflectionBlockersLine } from "@/lib/reflection-blockers-ui";
import { extractApprovalIdFromUnknown } from "@/lib/approval-anchor";
import {
  formatGitStatusDetail,
  type GitStatusSnapshot,
} from "@/lib/git-status";
import { GitStatusView } from "@/components/git-status-view";

function toolLabel(name: string): string {
  const labels: Record<string, string> = {
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
    "devtools.get_console_errors": "Console",
    "devtools.get_network_requests": "Network",
    "devtools.click": "页面点击",
    "devtools.type": "页面输入",
    "devtools.get_box_model": "盒模型",
    "devtools.get_computed_style": "计算样式",
    "devtools.inspect_element_at": "坐标探测",
    "file.mutation.prepare": "准备文件变更",
    "file.replace.prepare": "准备文本替换",
    "git.mutation.prepare": "准备 Git 操作",
    "shell.command.prepare": "准备 npm 脚本",
    "shell.run.prepare": "准备终端命令",
    "patch.prepare": "准备 Patch",
  };
  return labels[name] ?? name;
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
  if (typeof record.summary === "string" && Array.isArray(record.files)) {
    return record.summary;
  }
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
  if (isGitStatusSnapshot(record)) {
    return formatGitStatusDetail(record);
  }
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
  detailNode,
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
  detailNode?: ReactNode;
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
  const hasExpandable =
    Boolean(detail || detailNode) || (showDebug && debugJson !== undefined);

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
      {open && detailNode && (
        <div className="mt-2 max-h-48 overflow-auto rounded border border-zinc-200 bg-zinc-50 p-2 dark:border-zinc-700 dark:bg-zinc-900/80">
          {detailNode}
        </div>
      )}
      {open && !detailNode && detail && (
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

function renderAgentEvent(
  event: AgentEvent,
  index: number,
  showDebug: boolean,
  compact: boolean,
  taskStillRunning: boolean,
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
      const metaParts = formatCompactionMeta({
        method: event.method,
        round: event.round,
        pinnedApprovalCount: event.pinnedApprovalCount,
        changedFileCount: event.changedFileCount,
        estimatedTokensBefore: event.estimatedTokensBefore,
        estimatedTokensAfter: event.estimatedTokensAfter,
        layersApplied: event.layersApplied,
      });
      return (
        <CollapsibleEventRow
          key={`${event.type}-${index}`}
          tone="info"
          title="上下文已压缩"
          summary={event.summaryPreview ?? "滚动任务记忆已更新"}
          meta={metaParts || undefined}
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
              ? formatReflectionBlockersLine(event.reflection.blockers, {
                  taskStillRunning,
                })
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
      const gitSnapshot = isGitStatusSnapshot(event.result) ? event.result : null;
      const detail = gitSnapshot ? null : formatToolDetail(event.result);
      const linkedApprovalId = extractApprovalIdFromUnknown(event.result);
      return (
        <CollapsibleEventRow
          key={`${event.type}-${index}`}
          tone={event.toolCall.error ? "error" : "success"}
          title={`工具 · ${toolLabel(event.toolCall.toolName)}`}
          summary={event.toolCall.error ?? hint ?? "完成"}
          detail={detail ?? undefined}
          detailNode={
            gitSnapshot ? (
              <GitStatusView snapshot={gitSnapshot} compact maxFiles={16} />
            ) : undefined
          }
          showDebug={showDebug}
          debugJson={event}
          defaultOpen={Boolean(event.toolCall.error || gitSnapshot?.dirty)}
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
      const shellLine =
        event.approval.details?.kind === "shell_command"
          ? event.approval.details.preview.command
          : null;
      return (
        <EventRow
          key={`${event.type}-${index}`}
          tone="warn"
          title={`待审批 · ${event.approval.title}`}
          body={[event.approval.reason, shellLine ? `命令：${shellLine}` : null, patchLine]
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
    case "approval.executed":
      return (
        <CollapsibleEventRow
          key={`${event.type}-${index}`}
          tone={event.status === "succeeded" ? "success" : "error"}
          title={
            event.status === "succeeded"
              ? `命令已执行 · ${event.command}`
              : `命令失败 · ${event.command}`
          }
          summary={event.summary ?? (event.status === "succeeded" ? "完成" : "失败")}
          detail={event.output?.slice(0, 2000)}
          showDebug={showDebug}
          debugJson={event}
          defaultOpen={event.status === "failed"}
          compact={compact}
        />
      );
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
    case "trace.checkpoint":
      return (
        <EventRow
          key={`${event.type}-${index}`}
          tone={
            event.checkpoint.kind === "task_failed"
              ? "error"
              : event.checkpoint.kind === "shell_paused"
                ? "neutral"
                : "success"
          }
          title={event.checkpoint.label}
          meta={
            event.checkpoint.command
              ? event.checkpoint.command
              : event.checkpoint.approvalId
                ? `approval ${event.checkpoint.approvalId}`
                : undefined
          }
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
    case "task.cancelled":
      return (
        <EventRow
          key={`${event.type}-${index}`}
          tone="neutral"
          title="任务已停止"
          body={event.task.error ?? "用户已停止运行"}
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

type AgentEventTimelineProps = {
  events: AgentEvent[];
  running: boolean;
  density?: "comfortable" | "compact";
  /** 对话式中栏：无标题栏、宽松排版 */
  chatMode?: boolean;
  /** 不在中栏展示的事件类型（如 plan 放右侧栏） */
  excludeEventTypes?: AgentEvent["type"][];
  /** 活动流为空时提示可从左侧会话历史恢复 */
  showRestoreHint?: boolean;
  /** 点击带审批的活动行时，滚动定位到审查面板 */
  onFocusApproval?: (approvalId: string, filePath?: string) => void;
  onApplyApproval?: (approvalId: string) => void;
  onRejectApproval?: (approvalId: string) => void;
  applyApprovalBusy?: boolean;
  pendingCommandApprovalIds?: Set<string>;
  executedCommandApprovalIds?: Set<string>;
  onApproveCommand?: (approvalId: string) => void;
  onRejectCommand?: (approvalId: string) => void;
  commandApprovalBusy?: boolean;
  /** 中栏变更卡是否显示接受/拒绝（三栏下 false，与 Cursor 一致：改在审查/自动写盘） */
  showInlineFileChangeActions?: boolean;
  onFixLintAfterWrite?: (
    verification: import("@/agent/verification").PostExecuteVerification,
  ) => void;
  /** 点击「上下文已压缩」时仅提示（详情在活动流 Worked 内） */
  onFocusCompactedMemory?: () => void;
};

export function AgentEventTimeline({
  events,
  running,
  density = "comfortable",
  chatMode = false,
  excludeEventTypes = [],
  showRestoreHint = false,
  onFocusApproval,
  onApplyApproval,
  onRejectApproval,
  applyApprovalBusy = false,
  pendingCommandApprovalIds,
  executedCommandApprovalIds,
  onApproveCommand,
  onRejectCommand,
  commandApprovalBusy = false,
  showInlineFileChangeActions = true,
  onFixLintAfterWrite,
}: AgentEventTimelineProps) {
  const compact = density === "compact";
  const excludeSet = useMemo(
    () => new Set(excludeEventTypes),
    [excludeEventTypes],
  );

  const compressed = useMemo(() => compressToolEvents(events), [events]);

  const turns = useMemo(
    () => groupEventsIntoTurns(compressed),
    [compressed],
  );

  const shouldSkipEvent = (event: AgentEvent) => {
    if (excludeSet.has(event.type)) return true;
    if (
      event.type === "thread.created" ||
      event.type === "turn.created" ||
      event.type === "trace.linked"
    ) {
      return true;
    }
    return false;
  };

  const filterWorkedEvent = (event: AgentEvent) => !shouldSkipEvent(event);

  return (
    <section
      className={`flex min-h-0 flex-1 flex-col ${chatMode ? "" : compact ? "gap-1" : "gap-2"}`}
    >
      {!chatMode && (
        <div className="flex flex-wrap items-center justify-between gap-1.5">
          {!compact && (
            <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
              活动
            </h3>
          )}
          {compact && (
            <span className="text-[10px] font-medium text-zinc-500">活动流</span>
          )}
          {running && (
            <span className="text-[11px] text-blue-600 dark:text-blue-400">
              运行中…
            </span>
          )}
        </div>
      )}
      <div
        className={`min-h-0 flex-1 overflow-auto ${chatMode ? "px-0" : "pr-1"} ${chatMode ? "space-y-0" : compact ? "space-y-1" : "space-y-2"}`}
      >
        {turns.length === 0 && !running ? (
          <p
            className={`text-center text-sm text-zinc-500 ${
              chatMode
                ? "px-2 py-16"
                : "rounded-lg border border-dashed border-zinc-300 px-3 py-8 dark:border-zinc-700"
            }`}
          >
              {showRestoreHint ? (
                <>
                  活动流为空。在左侧「项目 → 会话」中点击某条会话，可恢复该任务的活动流与审批。
                  <span className="mt-2 block text-xs text-zinc-400">
                    或在下方输入新任务并点击「运行」。
                  </span>
                </>
              ) : (
                "描述你的编程任务，Agent 会在这里展示计划、工具调用与审批。"
              )}
            </p>
          ) : turns.length === 0 && running ? (
          <p
            className={`text-center text-sm text-zinc-500 ${
              chatMode ? "py-12" : "rounded-lg bg-zinc-50 px-3 py-6 dark:bg-zinc-900"
            }`}
          >
            正在启动 Agent…
          </p>
        ) : (
          <>
            {turns.map((turn, turnIndex) => (
              <div
                key={turn.taskId}
                className={
                  chatMode && turnIndex > 0
                    ? "border-t border-zinc-100 pt-8 dark:border-zinc-800/80"
                    : undefined
                }
              >
                <AgentTurnBlock
                  turn={{
                    ...turn,
                    workedEvents: turn.workedEvents.filter(filterWorkedEvent),
                    highlights: turn.highlights.filter(filterWorkedEvent),
                  }}
                  isLatest={turnIndex === turns.length - 1}
                  running={running}
                  onReviewApproval={onFocusApproval}
                  onApplyApproval={onApplyApproval}
                  onRejectApproval={onRejectApproval}
                  applyApprovalBusy={applyApprovalBusy}
                  pendingCommandApprovalIds={pendingCommandApprovalIds}
                  executedCommandApprovalIds={executedCommandApprovalIds}
                  onApproveCommand={onApproveCommand}
                  onRejectCommand={onRejectCommand}
                  commandApprovalBusy={commandApprovalBusy}
                  showInlineFileChangeActions={showInlineFileChangeActions}
                  onFixLintAfterWrite={onFixLintAfterWrite}
                />
              </div>
            ))}
          </>
        )}
      </div>
    </section>
  );
}
