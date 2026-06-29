/**
 * Agent Loop 上下文压缩（Cursor/Codex 技术路线）。
 *
 * - 写入前工具结果整形
 * - Head（system + 用户任务 + 滚动记忆）+ Tail（最近完整步）
 * - Pinned facts 永不丢（审批 ID、路径、分支、错误）
 * - 增量滚动：再次压缩时合并 prior memory + 新 evicted 段
 * - 确定性 → ModelProvider.compact 语义合并
 */
import { estimateTokens } from "@/agent/memory/context-manager";
import { compressContext } from "@/agent/memory/context-compressor";
import {
  emptyPinnedFacts,
  extractPinnedFactsFromMessages,
  extractPinnedFactsFromText,
  formatPinnedFactsBlock,
  mergePinnedFacts,
  type LoopPinnedFacts,
} from "@/agent/memory/loop-pinned-facts";
import type { ContextSection } from "@/agent/memory/types";
import {
  DEFAULT_TOKEN_BUDGET,
  getMaxContextTokens,
} from "@/agent/memory/token-budget";
import { LOOP_COMPACTION_CONFIG } from "@/agent/memory/loop-compaction-config";
import {
  isBurstTailEnabled,
  resolveBurstAwareTailStart,
} from "@/agent/memory/loop-burst-tail";
import {
  COLLAPSE_TAIL_KEEP,
  isSoftToolCollapseEnabled,
  microCompactMiddleObservations,
  needsEmergencyCollapse,
  needsSoftToolCollapse,
  snipLowValueMiddleMessages,
  softCollapseMiddleToolObservations,
} from "@/agent/memory/loop-compaction-layers";
import {
  extractUserMessageAnchors,
  formatUserAnchorsBlock,
} from "@/agent/memory/loop-tombstone-stub";
import {
  extractFileReadSnippetsFromMessages,
  formatPinnedFileSnippetsBlock,
  mergePinnedFileSnippets,
  parsePinnedFileSnippetsFromBlock,
  SECTION_FILE_SNIPPETS,
  SECTION_FILE_SNIPPETS_ZH,
  type PinnedFileSnippet,
} from "@/agent/memory/loop-files-read-pin";
import type { UiPrepareHint } from "@/agent/core/ui-prepare-nudge";
import {
  extractPrepareHintFromMessages,
  formatPinnedPrepareHintBlock,
  mergePrepareHints,
  parsePinnedPrepareHintFromBlock,
  SECTION_PREPARE_HINT,
  SECTION_PREPARE_HINT_ZH,
} from "@/agent/memory/loop-prepare-hint-pin";
import {
  formatCompactModelOutput,
  getCompactSystemPrompt,
} from "@/agent/prompts/compact-prompt";
import type { ModelProvider } from "@/agent/model/types";

function mergeTaskReasoningPin(
  pinnedFacts: LoopPinnedFacts,
  taskReasoning?: {
    intent: string;
    risk: string;
    evidenceNeeded: string[];
    ambiguity: string | null;
  } | null,
): LoopPinnedFacts {
  if (!taskReasoning) return pinnedFacts;
  const pin = [
    `intent=${taskReasoning.intent}`,
    `risk=${taskReasoning.risk}`,
    taskReasoning.ambiguity ? `ambiguity=${taskReasoning.ambiguity}` : null,
    taskReasoning.evidenceNeeded.length > 0
      ? `evidence=${taskReasoning.evidenceNeeded.slice(0, 4).join("; ")}`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return {
    ...pinnedFacts,
    toolHighlights: [
      ...new Set([
        `[TASK_REASONING_PIN] ${pin}`,
        ...pinnedFacts.toolHighlights,
      ]),
    ].slice(0, 16),
  };
}
import type { AgentMessage } from "@/agent/types";
import { newId, nowIso } from "@/agent/types";
import {
  externalizeObservationPayload,
  FILE_READ_INLINE_MAX,
  isToolResultExternalizeEnabled,
  serializedPayloadBytes,
  TOOL_RESULT_INLINE_MAX,
  type ToolResultObservationContext,
} from "@/agent/memory/tool-result-storage";

/** 无 thread 记忆时至少保留 system + 当前用户任务。 */
const MIN_PINNED_HEAD_COUNT = 2;
const TAIL_KEEP_COUNT = LOOP_COMPACTION_CONFIG.tailKeepCount;
const MIDDLE_TRIGGER_TOKENS = LOOP_COMPACTION_CONFIG.middleTokenTrigger;
const MIDDLE_MESSAGE_TRIGGER = LOOP_COMPACTION_CONFIG.middleMessageTrigger;
const OBSERVATION_JSON_MAX = TOOL_RESULT_INLINE_MAX;
const FILE_READ_CONTENT_MAX = FILE_READ_INLINE_MAX;
const SUMMARY_MERGE_MAX_CHARS = 10_000;
const SUMMARY_PREVIEW_CHARS = 420;

const COMPACTED_MEMORY_PREFIX = "[COMPACTED_MEMORY";
const SECTION_PINNED = "## Pinned facts";
const SECTION_PINNED_ZH = "## 钉住事实";
const SECTION_SUMMARY = "## Summary";
const SECTION_SUMMARY_ZH = "## 摘要";
const SECTION_CHANGED = "## Changed files";
const SECTION_HANDOFF = "## Handoff";
const SECTION_CHANGED_ZH = "## 涉及文件";
const SECTION_USER_ANCHORS_ZH = "## 用户锚点";

function findSectionStart(content: string, ...headers: string[]): number {
  for (const header of headers) {
    const index = content.indexOf(header);
    if (index >= 0) return index;
  }
  return -1;
}

export type LoopContextCompactMethod = "none" | "deterministic" | "semantic";

export type LoopContextCompactResult = {
  messages: AgentMessage[];
  method: LoopContextCompactMethod;
  summaryId?: string;
  contextWindow?: LoopContextWindow;
  estimatedTokensBefore: number;
  estimatedTokensAfter: number;
  middleMessageCount: number;
  round: number;
  summaryPreview?: string;
  memoryContent?: string;
  pinnedFacts?: LoopPinnedFacts;
  changedFiles?: string[];
  /** 本次触发的压缩层（snip / micro / auto / collapse） */
  layersApplied?: string[];
};

export type LoopContextWindow = {
  windowNumber: number;
  windowId: string;
  previousWindowId?: string;
};

export type ParsedCompactedMemory = {
  round: number;
  method?: string;
  windowId?: string;
  previousWindowId?: string;
  pinnedFacts: LoopPinnedFacts;
  summaryBody: string;
  changedFiles: string[];
  pinnedFileSnippets: PinnedFileSnippet[];
  pinnedPrepareHint: UiPrepareHint | null;
};

function messageText(message: AgentMessage): string {
  if (message.role === "tool") {
    const body =
      typeof message.content === "string"
        ? message.content
        : JSON.stringify(message.content);
    return `Tool result (${message.tool_call_id ?? "?"}): ${body}`;
  }
  if (message.tool_calls?.length) {
    const names = message.tool_calls
      .map((call) => call.function.name)
      .join(", ");
    const text =
      typeof message.content === "string"
        ? message.content
        : message.content
          ? JSON.stringify(message.content)
          : "";
    return `Assistant tool_calls [${names}]${text ? `: ${text}` : ""}`;
  }
  if (message.content == null) return "";
  if (typeof message.content === "string") return message.content;
  return JSON.stringify(message.content);
}

export function estimateMessagesTokens(messages: AgentMessage[]): number {
  return messages.reduce(
    (total, message) => total + estimateTokens(messageText(message)),
    0,
  );
}

function safeJson(value: unknown, maxChars: number): string {
  try {
    const json = JSON.stringify(value, null, 2);
    if (json.length <= maxChars) return json;
    return JSON.stringify({
      truncated: true,
      originalLength: json.length,
      preview: json.slice(0, Math.max(0, maxChars - 280)),
      note: "Full tool result omitted; re-call the tool if you need details.",
    });
  } catch {
    return JSON.stringify({
      truncated: true,
      preview: String(value).slice(0, Math.max(0, maxChars - 120)),
    });
  }
}

function truncateFileReadResult(
  result: Record<string, unknown>,
): Record<string, unknown> {
  const content = result.content;
  if (typeof content !== "string" || content.length <= FILE_READ_CONTENT_MAX) {
    return result;
  }
  return {
    ...result,
    content: `${content.slice(0, FILE_READ_CONTENT_MAX)}\n...[file content truncated; file.read again if needed]`,
    truncated: true,
    originalLength: content.length,
  };
}

function shapeFileReadResult(
  record: Record<string, unknown>,
  ctx?: ToolResultObservationContext,
): Record<string, unknown> {
  const content = record.content;
  if (
    ctx?.workspaceRoot &&
    isToolResultExternalizeEnabled() &&
    typeof content === "string" &&
    content.length > FILE_READ_CONTENT_MAX
  ) {
    return externalizeObservationPayload(ctx, record, {
      path: record.path,
      lineCount: content.split(/\r?\n/).length,
      originalLength: content.length,
    });
  }
  return truncateFileReadResult(record);
}

function finalizeObservationPayload(
  toolName: string,
  payload: unknown,
  ctx?: ToolResultObservationContext,
): unknown {
  const bytes = serializedPayloadBytes(payload);
  if (
    ctx?.workspaceRoot &&
    isToolResultExternalizeEnabled() &&
    bytes > OBSERVATION_JSON_MAX
  ) {
    return externalizeObservationPayload({ ...ctx, toolName }, payload);
  }
  if (bytes <= OBSERVATION_JSON_MAX) {
    return payload;
  }
  return JSON.parse(safeJson(payload, OBSERVATION_JSON_MAX));
}

/** 写入模型上下文前的工具结果整形（单条观测上限；超大结果可外置）。 */
export function shapeToolResultForObservation(
  toolName: string,
  result: unknown,
  ctx?: ToolResultObservationContext,
): unknown {
  if (!result || typeof result !== "object") {
    return result;
  }

  const record = result as Record<string, unknown>;

  if (toolName === "file.read") {
    return shapeFileReadResult(record, ctx);
  }

  if (toolName === "file.search" && Array.isArray(record.matches)) {
    const matches = record.matches as unknown[];
    if (matches.length > 20) {
      return {
        ...record,
        matches: matches.slice(0, 20),
        truncated: true,
        totalMatches: matches.length,
      };
    }
  }

  if (toolName === "git.diff") {
    const diff =
      typeof record.diff === "string"
        ? record.diff
        : typeof record.stdout === "string"
          ? record.stdout
          : null;
    if (diff && diff.length > 6_000) {
      return {
        ...record,
        diff: `${diff.slice(0, 6_000)}\n...[diff truncated]`,
        stdout: undefined,
        truncated: true,
      };
    }
  }

  if (toolName === "git.status" && typeof record.summary === "string") {
    const files = Array.isArray(record.files)
      ? (record.files as unknown[]).slice(0, 40)
      : [];
    return {
      dirty: record.dirty,
      branch: record.branch,
      upstream: record.upstream,
      ahead: record.ahead,
      behind: record.behind,
      summary: record.summary,
      files,
      fileCount: Array.isArray(record.files) ? record.files.length : 0,
    };
  }

  if (
    toolName === "workspace.inspect" &&
    record.git &&
    typeof record.git === "object"
  ) {
    const git = record.git as Record<string, unknown>;
    return {
      rootPath: record.rootPath,
      gitRootPath: record.gitRootPath,
      packageManager: record.packageManager,
      framework: record.framework,
      packageName: record.packageName,
      git: {
        dirty: git.dirty,
        branch: git.branch,
        summary: git.summary,
        files: Array.isArray(git.files)
          ? (git.files as unknown[]).slice(0, 24)
          : [],
      },
      rules: record.rules,
    };
  }

  if (toolName === "project.index") {
    return {
      fileCount: record.fileCount,
      routeCount: record.routeCount,
      apiRouteCount: record.apiRouteCount,
      componentCount: record.componentCount,
      note: "Full index omitted; call project.index again if needed.",
    };
  }

  if (
    toolName === "file.mutation.prepare" ||
    toolName === "file.replace.prepare"
  ) {
    const approval = record.approval;
    if (approval && typeof approval === "object") {
      const approvalRecord = approval as Record<string, unknown>;
      return {
        prepared: true,
        approvalId: approvalRecord.id,
        title: approvalRecord.title,
        status: approvalRecord.status,
        path: typeof record.path === "string" ? record.path : undefined,
        note: "Full preview in approval UI; re-prepare if needed.",
      };
    }
  }

  if (toolName === "patch.prepare" && record.approval) {
    const approval = record.approval as Record<string, unknown>;
    return {
      prepared: true,
      approvalId: approval.id,
      title: approval.title,
      files: Array.isArray(record.files) ? record.files.length : undefined,
      note: "Patch approval in UI.",
    };
  }

  if (
    toolName === "git.mutation.prepare" ||
    toolName === "shell.command.prepare" ||
    toolName === "shell.run.prepare"
  ) {
    const approval = record.approval;
    if (approval && typeof approval === "object") {
      const approvalRecord = approval as Record<string, unknown>;
      return {
        prepared: true,
        approvalId: approvalRecord.id,
        title: approvalRecord.title,
        operation:
          typeof record.operation === "object" &&
          record.operation &&
          "type" in (record.operation as object)
            ? (record.operation as { type: string }).type
            : undefined,
        command:
          typeof record.command === "string" ? record.command : undefined,
        note: "Full preview in approval UI; re-prepare if needed.",
      };
    }
  }

  return finalizeObservationPayload(toolName, result, ctx);
}

export function buildToolObservationMessage(
  toolName: string,
  result: unknown,
  ctx?: ToolResultObservationContext,
): AgentMessage {
  const shaped = shapeToolResultForObservation(toolName, result, ctx);
  return {
    role: "user",
    content: `Observation from ${toolName}:\n${safeJson(shaped, OBSERVATION_JSON_MAX)}`,
  };
}

function isCompactedMemoryMessage(message: AgentMessage): boolean {
  return messageText(message).startsWith(COMPACTED_MEMORY_PREFIX);
}

/** Thread 级记忆注入（跨 Task），与本轮 [COMPACTED_MEMORY] 不同。 */
export function isThreadMemoryInjectionMessage(message: AgentMessage): boolean {
  const text = messageText(message);
  return (
    message.role === "user" &&
    (text.includes("[THREAD_MEMORY]") ||
      text.includes("Rolling thread memory from earlier tasks in this thread"))
  );
}

export function isLoopEphemeralUserMessage(message: AgentMessage): boolean {
  const text = messageText(message);
  return (
    text.startsWith("Observation from") ||
    text.includes("Reflection (") ||
    isCompactedMemoryMessage(message)
  );
}

/** 当前 Task 的用户需求原文（必须留在 head，不可被压进 middle）。 */
export function isPrimaryTaskUserMessage(message: AgentMessage): boolean {
  return (
    message.role === "user" &&
    !isThreadMemoryInjectionMessage(message) &&
    !isLoopEphemeralUserMessage(message)
  );
}

/**
 * 计算 Loop 压缩时要钉在头部的消息数：system →（可选）thread 记忆 → 当前用户任务。
 */
export function resolveLoopPinnedHeadCount(
  messages: AgentMessage[],
  tailStartIndex: number,
): number {
  if (tailStartIndex <= 0) return 0;

  let count = 0;
  if (messages[0]?.role === "system") {
    count = 1;
  } else {
    return Math.min(MIN_PINNED_HEAD_COUNT, tailStartIndex);
  }

  if (
    count < tailStartIndex &&
    isThreadMemoryInjectionMessage(messages[count])
  ) {
    count += 1;
  }

  if (count < tailStartIndex && isPrimaryTaskUserMessage(messages[count])) {
    count += 1;
  }

  return Math.max(count, Math.min(MIN_PINNED_HEAD_COUNT, tailStartIndex));
}

export function splitLoopMessagesForCompaction(messages: AgentMessage[]): {
  head: AgentMessage[];
  middle: AgentMessage[];
  tail: AgentMessage[];
} {
  let tailStart = Math.max(0, messages.length - TAIL_KEEP_COUNT);
  let headCount = resolveLoopPinnedHeadCount(messages, tailStart);

  if (isBurstTailEnabled()) {
    tailStart = resolveBurstAwareTailStart(messages, headCount, {
      minKeep: LOOP_COMPACTION_CONFIG.burstTailMin,
      maxKeep: TAIL_KEEP_COUNT,
    });
    headCount = resolveLoopPinnedHeadCount(messages, tailStart);
    if (tailStart < headCount) {
      tailStart = headCount;
    }
  } else {
    headCount = resolveLoopPinnedHeadCount(messages, tailStart);
  }

  return {
    head: messages.slice(0, headCount),
    middle: messages.slice(headCount, tailStart),
    tail: messages.slice(tailStart),
  };
}

export function parseCompactedMemory(
  content: string,
): ParsedCompactedMemory | null {
  if (!content.startsWith(COMPACTED_MEMORY_PREFIX)) return null;

  const roundMatch = /round\s+(\d+)/i.exec(content);
  const methodMatch = /,\s*(deterministic|semantic)(?:,|\])/i.exec(content);
  const windowMatch = /window\s+([a-zA-Z0-9_-]+)/i.exec(content);
  const previousWindowMatch = /prevWindow\s+([a-zA-Z0-9_-]+)/i.exec(content);
  const pinnedStart = findSectionStart(
    content,
    SECTION_PINNED_ZH,
    SECTION_PINNED,
  );
  const snippetsStart = findSectionStart(
    content,
    SECTION_FILE_SNIPPETS_ZH,
    SECTION_FILE_SNIPPETS,
  );
  const prepareHintStart = findSectionStart(
    content,
    SECTION_PREPARE_HINT_ZH,
    SECTION_PREPARE_HINT,
  );
  const summaryStart = findSectionStart(
    content,
    SECTION_SUMMARY_ZH,
    SECTION_SUMMARY,
  );
  const changedStart = findSectionStart(
    content,
    SECTION_CHANGED_ZH,
    SECTION_CHANGED,
  );

  const pinnedHeaderLen =
    pinnedStart >= 0
      ? content.startsWith(SECTION_PINNED_ZH, pinnedStart)
        ? SECTION_PINNED_ZH.length
        : SECTION_PINNED.length
      : 0;
  const summaryHeaderLen =
    summaryStart >= 0
      ? content.startsWith(SECTION_SUMMARY_ZH, summaryStart)
        ? SECTION_SUMMARY_ZH.length
        : SECTION_SUMMARY.length
      : 0;
  const changedHeaderLen =
    changedStart >= 0
      ? content.startsWith(SECTION_CHANGED_ZH, changedStart)
        ? SECTION_CHANGED_ZH.length
        : SECTION_CHANGED.length
      : 0;

  const snippetsHeaderLen =
    snippetsStart >= 0
      ? content.startsWith(SECTION_FILE_SNIPPETS_ZH, snippetsStart)
        ? SECTION_FILE_SNIPPETS_ZH.length
        : SECTION_FILE_SNIPPETS.length
      : 0;
  const prepareHintHeaderLen =
    prepareHintStart >= 0
      ? content.startsWith(SECTION_PREPARE_HINT_ZH, prepareHintStart)
        ? SECTION_PREPARE_HINT_ZH.length
        : SECTION_PREPARE_HINT.length
      : 0;

  const pinnedBlock =
    pinnedStart >= 0 && summaryStart > pinnedStart
      ? content
          .slice(
            pinnedStart + pinnedHeaderLen,
            snippetsStart > pinnedStart ? snippetsStart : summaryStart,
          )
          .trim()
      : "";
  const snippetsBlock =
    snippetsStart >= 0 &&
    (prepareHintStart > snippetsStart || summaryStart > snippetsStart)
      ? content
          .slice(
            snippetsStart + snippetsHeaderLen,
            prepareHintStart > snippetsStart
              ? prepareHintStart
              : summaryStart > snippetsStart
                ? summaryStart
                : undefined,
          )
          .trim()
      : "";
  const prepareHintBlock =
    prepareHintStart >= 0 && summaryStart > prepareHintStart
      ? content
          .slice(prepareHintStart + prepareHintHeaderLen, summaryStart)
          .trim()
      : "";
  const summaryBody =
    summaryStart >= 0
      ? content
          .slice(
            summaryStart + summaryHeaderLen,
            changedStart >= summaryStart ? changedStart : undefined,
          )
          .trim()
      : content;
  const changedBlock =
    changedStart >= 0
      ? content.slice(changedStart + changedHeaderLen).trim()
      : "";

  const changedFiles = changedBlock
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*]\s*/, "").trim())
    .filter((line) => line && line !== "none");

  return {
    round: roundMatch ? Number.parseInt(roundMatch[1], 10) : 1,
    method: methodMatch?.[1],
    windowId: windowMatch?.[1],
    previousWindowId: previousWindowMatch?.[1],
    pinnedFacts: extractPinnedFactsFromText(pinnedBlock),
    summaryBody,
    changedFiles,
    pinnedFileSnippets: parsePinnedFileSnippetsFromBlock(snippetsBlock),
    pinnedPrepareHint: parsePinnedPrepareHintFromBlock(prepareHintBlock),
  };
}

function mergeTaskMemorySummaries(prior: string, taskTurn: string): string {
  const merged = [
    prior.trim() ? `### Earlier in thread\n${prior.trim()}` : "",
    taskTurn.trim() ? `### Latest task\n${taskTurn.trim()}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  if (merged.length <= SUMMARY_MERGE_MAX_CHARS) return merged;
  return `${merged.slice(0, SUMMARY_MERGE_MAX_CHARS)}\n...[memory truncated at ${SUMMARY_MERGE_MAX_CHARS} chars]`;
}

function buildTaskTurnSummary(userRequest: string, summary: string): string {
  return [
    `**User request:** ${userRequest.trim()}`,
    `**Agent outcome:** ${summary.trim()}`,
  ].join("\n");
}

function truncateMemoryLine(
  value: string | null | undefined,
  maxChars = 420,
): string {
  const normalized = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return "";
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, Math.max(0, maxChars - 3))}...`;
}

function extractLatestReflectionForHandoff(messages: AgentMessage[]): {
  understanding?: string;
  plannedNext?: string;
  blockers?: string[];
} {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const text = messageText(messages[index]!);
    try {
      const parsed = JSON.parse(text) as {
        action?: string;
        understanding?: unknown;
        plannedNext?: unknown;
        blockers?: unknown;
      };
      if (parsed.action === "reflect") {
        return {
          understanding:
            typeof parsed.understanding === "string"
              ? parsed.understanding
              : undefined,
          plannedNext:
            typeof parsed.plannedNext === "string"
              ? parsed.plannedNext
              : undefined,
          blockers: Array.isArray(parsed.blockers)
            ? parsed.blockers.filter(
                (item): item is string => typeof item === "string",
              )
            : undefined,
        };
      }
    } catch {
      // Continue with line-based runtime reflection parsing below.
    }

    const understanding = new RegExp(
      "(?:\\u7406\\u89e3|Understanding)\\s*[:\\uFF1A]\\s*(.+)",
      "i",
    ).exec(text)?.[1];
    const plannedNext = new RegExp(
      "(?:\\u4e0b\\u4e00\\u6b65|Next step)\\s*[:\\uFF1A]\\s*(.+)",
      "i",
    ).exec(text)?.[1];
    const blockerLine = new RegExp(
      "(?:\\u963b\\u585e|Blockers?)\\s*[:\\uFF1A]\\s*(.+)",
      "i",
    ).exec(text)?.[1];
    if (understanding || plannedNext || blockerLine) {
      return {
        understanding,
        plannedNext,
        blockers: blockerLine ? [blockerLine] : undefined,
      };
    }
  }
  return {};
}

function summarizeCriticalFactsForHandoff(input: {
  pinnedFacts: LoopPinnedFacts;
  changedFiles: string[];
}): string {
  const facts: string[] = [];
  if (input.pinnedFacts.approvalIds.length > 0) {
    facts.push(`approvals=${input.pinnedFacts.approvalIds.join(", ")}`);
  }
  if (input.changedFiles.length > 0) {
    facts.push(`changed=${input.changedFiles.slice(0, 8).join(", ")}`);
  }
  if (input.pinnedFacts.filePaths.length > 0) {
    facts.push(`files=${input.pinnedFacts.filePaths.slice(0, 10).join(", ")}`);
  }
  if (input.pinnedFacts.branches.length > 0) {
    facts.push(`branches=${input.pinnedFacts.branches.join(", ")}`);
  }
  if (input.pinnedFacts.errors.length > 0) {
    facts.push(`errors=${input.pinnedFacts.errors.slice(0, 4).join(" | ")}`);
  }
  if (input.pinnedFacts.blockers.length > 0) {
    facts.push(
      `blockers=${input.pinnedFacts.blockers.slice(0, 4).join(" | ")}`,
    );
  }
  return facts.length > 0 ? facts.join("; ") : "none extracted";
}

function buildHandoffBlock(input: {
  userRequest?: string;
  latestUnderstanding?: string;
  latestPlannedNext?: string;
  latestBlockers?: string[];
  pinnedFacts: LoopPinnedFacts;
  changedFiles: string[];
  contextWindow?: LoopContextWindow;
}): string {
  const lines = [
    input.contextWindow
      ? `- Context window: ${input.contextWindow.windowNumber} (${input.contextWindow.windowId})${
          input.contextWindow.previousWindowId
            ? ` after ${input.contextWindow.previousWindowId}`
            : ""
        }.`
      : "",
    input.userRequest
      ? `- Current user request: ${truncateMemoryLine(input.userRequest)}`
      : "",
    input.latestUnderstanding
      ? `- Current progress: ${truncateMemoryLine(input.latestUnderstanding)}`
      : "- Current progress: see Summary and the recent tail messages after this memory.",
    input.latestPlannedNext
      ? `- Next step: ${truncateMemoryLine(input.latestPlannedNext)}`
      : "- Next step: continue from the recent tail messages; re-call tools for tombstoned details.",
    input.latestBlockers?.length
      ? `- Blockers: ${input.latestBlockers
          .map((item) => truncateMemoryLine(item, 180))
          .join(" | ")}`
      : "",
    `- Critical facts: ${summarizeCriticalFactsForHandoff(input)}`,
    "- Recovery rule: treat this handoff plus the recent tail as live state; omitted tool bodies must be re-read or re-called before relying on exact details.",
  ].filter(Boolean);

  return lines.join("\n");
}

function createLoopContextWindow(
  round: number,
  priorMemory: ParsedCompactedMemory | null,
): LoopContextWindow {
  return {
    windowNumber: Math.max(1, round),
    windowId: newId("ctxwin"),
    previousWindowId: priorMemory?.windowId,
  };
}

/** 任务结束时写入/更新 thread 滚动记忆（短对话未触发压缩时也能续聊）。 */
export function buildThreadMemoryAfterTask(input: {
  messages: AgentMessage[];
  userRequest: string;
  summary: string;
  priorMemoryContent?: string;
  filesReadPaths?: string[];
  prepareHint?: UiPrepareHint | null;
  compactRound: number;
  taskReasoning?: {
    intent: string;
    risk: string;
    evidenceNeeded: string[];
    ambiguity: string | null;
  } | null;
}): {
  memoryContent: string;
  summaryId: string;
  contextWindow: LoopContextWindow;
  round: number;
  method: "deterministic";
  summaryPreview: string;
} {
  const priorMemory = input.priorMemoryContent
    ? parseCompactedMemory(input.priorMemoryContent)
    : null;
  const priorRound = priorMemory?.round ?? 0;
  const round =
    input.compactRound > priorRound ? input.compactRound : priorRound + 1;

  const pinnedFacts = mergeTaskReasoningPin(
    mergePinnedFacts(
      priorMemory?.pinnedFacts ?? emptyPinnedFacts(),
      extractPinnedFactsFromMessages(input.messages),
    ),
    input.taskReasoning,
  );
  const pinnedFileSnippets = mergePinnedFileSnippets(
    priorMemory?.pinnedFileSnippets ?? [],
    extractFileReadSnippetsFromMessages(input.messages, {
      filesReadPaths: input.filesReadPaths,
    }),
  );
  const pinnedPrepareHint = mergePrepareHints(
    priorMemory?.pinnedPrepareHint ?? null,
    mergePrepareHints(
      extractPrepareHintFromMessages(input.messages),
      input.prepareHint ?? null,
    ),
  );
  const userAnchors = extractUserMessageAnchors(input.messages);
  const summaryBody = mergeTaskMemorySummaries(
    priorMemory?.summaryBody ?? "",
    buildTaskTurnSummary(input.userRequest, input.summary),
  );
  const changedFiles = uniqueFiles([
    ...(priorMemory?.changedFiles ?? []),
    ...(input.filesReadPaths ?? []),
    ...pinnedFacts.filePaths,
  ]);
  const contextWindow = createLoopContextWindow(round, priorMemory);
  const latestReflection = extractLatestReflectionForHandoff(input.messages);

  const memoryContent = buildStructuredCompactedMemory({
    round,
    method: "deterministic",
    contextWindow,
    userRequest: input.userRequest,
    latestUnderstanding: latestReflection.understanding,
    latestPlannedNext: latestReflection.plannedNext,
    latestBlockers: latestReflection.blockers,
    pinnedFacts,
    summaryBody,
    changedFiles,
    pinnedFileSnippets,
    pinnedPrepareHint,
    userAnchors,
  });

  return {
    memoryContent,
    summaryId: newId("summary"),
    contextWindow,
    round,
    method: "deterministic",
    summaryPreview: memoryContent.slice(0, SUMMARY_PREVIEW_CHARS),
  };
}

export function buildStructuredCompactedMemory(input: {
  round: number;
  method: LoopContextCompactMethod;
  contextWindow?: LoopContextWindow;
  userRequest?: string;
  latestUnderstanding?: string;
  latestPlannedNext?: string;
  latestBlockers?: string[];
  pinnedFacts: LoopPinnedFacts;
  summaryBody: string;
  changedFiles: string[];
  pinnedFileSnippets?: PinnedFileSnippet[];
  pinnedPrepareHint?: UiPrepareHint | null;
  userAnchors?: string[];
}): string {
  const changedLines =
    input.changedFiles.length > 0
      ? input.changedFiles.map((file) => `- ${file}`)
      : ["- none"];
  const snippetBlock = formatPinnedFileSnippetsBlock(
    input.pinnedFileSnippets ?? [],
  );
  const prepareHintBlock = formatPinnedPrepareHintBlock(
    input.pinnedPrepareHint ?? null,
  );
  const userAnchorsBlock = formatUserAnchorsBlock(input.userAnchors ?? []);
  const handoffBlock = buildHandoffBlock({
    userRequest: input.userRequest,
    latestUnderstanding: input.latestUnderstanding,
    latestPlannedNext: input.latestPlannedNext,
    latestBlockers: input.latestBlockers,
    pinnedFacts: input.pinnedFacts,
    changedFiles: input.changedFiles,
    contextWindow: input.contextWindow,
  });
  const headerParts = [
    `${COMPACTED_MEMORY_PREFIX} round ${input.round}`,
    input.method,
    input.contextWindow ? `window ${input.contextWindow.windowId}` : "",
    input.contextWindow?.previousWindowId
      ? `prevWindow ${input.contextWindow.previousWindowId}`
      : "",
  ].filter(Boolean);

  return [
    `${headerParts.join(", ")}]`,
    "本轮滚动任务记忆。最近 tail 消息代表最新一步。",
    "如需核实下方未列出的细节，可再次调用工具；墓碑 stub 的 recall 行提示如何找回。",
    "",
    SECTION_HANDOFF,
    handoffBlock,
    "",
    SECTION_PINNED_ZH,
    formatPinnedFactsBlock(input.pinnedFacts),
    "",
    SECTION_USER_ANCHORS_ZH,
    userAnchorsBlock,
    "",
    SECTION_FILE_SNIPPETS_ZH,
    snippetBlock,
    "",
    SECTION_PREPARE_HINT_ZH,
    prepareHintBlock,
    "",
    SECTION_SUMMARY_ZH,
    input.summaryBody.trim(),
    "",
    SECTION_CHANGED_ZH,
    ...changedLines,
  ].join("\n");
}

function middleMessageToSection(
  message: AgentMessage,
  index: number,
): ContextSection {
  const content = messageText(message);
  const isObservation = content.startsWith("Observation from");
  const isReflection = content.includes("Reflection (");
  return {
    id: `loop-mid-${index}`,
    kind: isObservation ? "tool_result" : "turn_context",
    title: isObservation
      ? content.split("\n")[0].slice(0, 80)
      : isReflection
        ? "Reflection"
        : message.role === "assistant"
          ? "Assistant step"
          : "Context",
    content,
    priority: isObservation ? 55 : isReflection ? 75 : 50,
    estimatedTokens: estimateTokens(content),
    source: `loop:${index}`,
  };
}

function mergeSummaryBodies(prior: string, next: string): string {
  const merged = [
    prior.trim() ? `### Prior\n${prior.trim()}` : "",
    next.trim() ? `### Latest eviction\n${next.trim()}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  if (merged.length <= SUMMARY_MERGE_MAX_CHARS) return merged;
  return `${merged.slice(0, SUMMARY_MERGE_MAX_CHARS)}\n...[memory truncated at ${SUMMARY_MERGE_MAX_CHARS} chars]`;
}

function shouldCompactMessages(input: {
  estimatedTokens: number;
  maxContext: number;
  middleLength: number;
  middleTokens: number;
  hasPriorMemory: boolean;
  forceCompact?: boolean;
}): boolean {
  if (input.forceCompact && input.middleLength >= 1) return true;

  const threshold =
    input.maxContext * DEFAULT_TOKEN_BUDGET.compressionThresholdRatio;

  if (input.estimatedTokens > threshold) return true;
  if (
    input.middleLength >= MIDDLE_MESSAGE_TRIGGER &&
    input.middleTokens >= MIDDLE_TRIGGER_TOKENS
  ) {
    return true;
  }
  if (input.hasPriorMemory && input.middleLength >= 3) {
    return true;
  }
  return false;
}

async function runSemanticCompact(input: {
  provider: ModelProvider;
  userRequest: string;
  priorSummary: string;
  sections: ContextSection[];
  pinnedFacts: LoopPinnedFacts;
}): Promise<{ summaryBody: string; changedFiles: string[] }> {
  const sectionPayload = input.sections.map((section) => ({
    title: section.title,
    kind: section.kind,
    excerpt: section.content.slice(0, 2_500),
  }));
  const pinnedBlock = formatPinnedFactsBlock(input.pinnedFacts);

  if (input.provider.compact) {
    const output = await input.provider.compact({
      userRequest: input.userRequest,
      priorMemory: input.priorSummary || undefined,
      sections: sectionPayload,
      pinnedFacts: pinnedBlock,
      maxTokens: 1_100,
    });
    const formatted = formatCompactModelOutput(output.summary);
    const parsed = parseCompactedMemory(
      `${COMPACTED_MEMORY_PREFIX} — round 1, semantic]\n${SECTION_SUMMARY}\n${formatted}`,
    );
    return {
      summaryBody: parsed?.summaryBody ?? output.summary,
      changedFiles: parsed?.changedFiles ?? [],
    };
  }

  const output = await input.provider.generate({
    messages: [
      {
        role: "system",
        content: getCompactSystemPrompt(),
      },
      {
        role: "user",
        content: [
          `Task:\n${input.userRequest}`,
          `\nPinned:\n${pinnedBlock}`,
          input.priorSummary ? `\nPrior memory:\n${input.priorSummary}` : "",
          `\nNew steps:\n${JSON.stringify(sectionPayload, null, 2)}`,
        ].join("\n"),
      },
    ],
    maxTokens: 1_100,
    temperature: 0,
  });

  const formatted = formatCompactModelOutput(output.content);
  const parsed = parseCompactedMemory(
    `${COMPACTED_MEMORY_PREFIX} — round 1, semantic]\n${formatted}`,
  );
  return {
    summaryBody: parsed?.summaryBody ?? formatted.trim(),
    changedFiles: parsed?.changedFiles ?? [],
  };
}

/**
 * 压缩 messages：保留 head + tail，滚动合并中间段。
 */
export async function compactAgentLoopMessages(input: {
  messages: AgentMessage[];
  userRequest: string;
  provider?: ModelProvider | null;
  enableSemanticCompact?: boolean;
  compactRound?: number;
  /** 运行态 filesRead，用于钉住片段时优先最近读取的文件 */
  filesReadPaths?: string[];
  /** 运行态 prepareHint（A084），压缩后仍写入滚动记忆 */
  prepareHint?: UiPrepareHint | null;
  /** A157：压缩时钉住任务推理摘要 */
  taskReasoning?: {
    intent: string;
    risk: string;
    evidenceNeeded: string[];
    ambiguity: string | null;
  } | null;
  /** API 超长等紧急场景：跳过阈值直接压缩（Reactive） */
  forceCompact?: boolean;
}): Promise<LoopContextCompactResult> {
  const layersApplied: string[] = [];
  const messages = [...input.messages];
  const estimatedTokensBefore = estimateMessagesTokens(messages);
  const maxContext = getMaxContextTokens(DEFAULT_TOKEN_BUDGET);

  const {
    head,
    middle: initialMiddle,
    tail,
  } = splitLoopMessagesForCompaction(messages);
  let middle = [...initialMiddle];

  const headCount = head.length;
  if (messages.length <= headCount + TAIL_KEEP_COUNT + 1) {
    return emptyResult(messages, estimatedTokensBefore);
  }

  const snip = snipLowValueMiddleMessages(middle);
  if (snip.removedCount > 0) {
    middle = snip.messages;
    layersApplied.push(`snip:${snip.removedCount}`);
  }

  const microSource =
    middle.length >= 8 ? middle.slice(0, middle.length - 1) : middle;
  const micro = microCompactMiddleObservations(microSource);
  if (micro.compactedCount > 0) {
    const microTail = middle.length >= 8 ? middle.at(-1)! : null;
    middle = microTail ? [...micro.messages, microTail] : micro.messages;
    layersApplied.push(`micro:${micro.compactedCount}`);
  }

  let estimatedTokensCurrent = estimateMessagesTokens([
    ...head,
    ...middle,
    ...tail,
  ]);
  if (
    isSoftToolCollapseEnabled() &&
    needsSoftToolCollapse(estimatedTokensCurrent, maxContext)
  ) {
    const soft = softCollapseMiddleToolObservations(middle);
    if (soft.collapsedCount > 0) {
      middle = soft.messages;
      estimatedTokensCurrent = estimateMessagesTokens([
        ...head,
        ...middle,
        ...tail,
      ]);
      layersApplied.push(`soft:${soft.collapsedCount}`);
    }
  }

  let priorMemory: ParsedCompactedMemory | null = null;
  const existingMemoryIndex = middle.findIndex(isCompactedMemoryMessage);
  if (existingMemoryIndex >= 0) {
    const [memoryMessage] = middle.splice(existingMemoryIndex, 1);
    priorMemory = parseCompactedMemory(messageText(memoryMessage));
  }

  if (middle.length === 0) {
    return emptyResult(messages, estimatedTokensBefore);
  }

  const middleTokens = estimateMessagesTokens(middle);
  const hasPriorMemory = priorMemory != null;

  const shouldCompact = shouldCompactMessages({
    estimatedTokens: estimatedTokensBefore,
    maxContext,
    middleLength: middle.length,
    middleTokens,
    hasPriorMemory,
    forceCompact: input.forceCompact,
  });

  const hasSoftLayer = layersApplied.some((layer) => layer.startsWith("soft:"));
  const needsMemoryCompact =
    shouldCompact ||
    input.forceCompact === true ||
    layersApplied.some(
      (layer) => layer.startsWith("snip:") || layer.startsWith("micro:"),
    );

  if (!needsMemoryCompact && hasSoftLayer) {
    const layerOnlyMessages = [...head, ...middle, ...tail];
    return {
      messages: layerOnlyMessages,
      method: "none",
      estimatedTokensBefore,
      estimatedTokensAfter: estimateMessagesTokens(layerOnlyMessages),
      middleMessageCount: middle.length,
      round: priorMemory?.round ?? 0,
      layersApplied,
    };
  }

  if (!needsMemoryCompact) {
    return {
      ...emptyResult(messages, estimatedTokensBefore),
      middleMessageCount: middle.length,
    };
  }

  const sections = middle.map((message, index) =>
    middleMessageToSection(message, index),
  );

  const headPinned = extractPinnedFactsFromMessages(
    head.filter(
      (message) =>
        isThreadMemoryInjectionMessage(message) ||
        isCompactedMemoryMessage(message),
    ),
  );
  const evictedPinned = extractPinnedFactsFromMessages(middle);
  const tailPinned = extractPinnedFactsFromMessages(tail);
  const pinnedFacts = mergeTaskReasoningPin(
    mergePinnedFacts(
      priorMemory?.pinnedFacts ?? emptyPinnedFacts(),
      mergePinnedFacts(mergePinnedFacts(headPinned, evictedPinned), tailPinned),
    ),
    input.taskReasoning,
  );

  const evictedSnippets = extractFileReadSnippetsFromMessages(
    [...head, ...middle, ...tail],
    { filesReadPaths: input.filesReadPaths },
  );
  const pinnedFileSnippets = mergePinnedFileSnippets(
    priorMemory?.pinnedFileSnippets ?? [],
    evictedSnippets,
  );

  const pinnedPrepareHint = mergePrepareHints(
    priorMemory?.pinnedPrepareHint ?? null,
    mergePrepareHints(
      extractPrepareHintFromMessages([...head, ...middle, ...tail]),
      input.prepareHint ?? null,
    ),
  );

  const userAnchors = extractUserMessageAnchors([...head, ...middle, ...tail]);

  let method: LoopContextCompactMethod = "deterministic";
  const compressed = compressContext({
    scope: "task",
    sections,
    maxSectionChars: 900,
    maxFacts: 32,
  });

  let summaryBody = mergeSummaryBodies(
    priorMemory?.summaryBody ?? "",
    compressed.summary.summary,
  );
  let changedFiles = uniqueFiles([
    ...(priorMemory?.changedFiles ?? []),
    ...compressed.summary.changedFiles,
  ]);
  const round = input.compactRound ?? (priorMemory?.round ?? 0) + 1;
  const contextWindow = createLoopContextWindow(round, priorMemory);
  const latestReflection = extractLatestReflectionForHandoff([
    ...head,
    ...middle,
    ...tail,
  ]);

  const afterDeterministic = estimateMessagesTokens([
    ...head,
    {
      role: "user",
      content: buildStructuredCompactedMemory({
        round,
        method: "deterministic",
        contextWindow,
        userRequest: input.userRequest,
        latestUnderstanding: latestReflection.understanding,
        latestPlannedNext: latestReflection.plannedNext,
        latestBlockers: latestReflection.blockers,
        pinnedFacts,
        summaryBody,
        changedFiles,
        pinnedFileSnippets,
        pinnedPrepareHint,
        userAnchors,
      }),
    },
    ...tail,
  ]);

  const needsSemantic =
    input.enableSemanticCompact !== false &&
    input.provider &&
    (afterDeterministic > maxContext ||
      middleTokens > MIDDLE_TRIGGER_TOKENS * 2 ||
      (hasPriorMemory && middle.length >= 6));

  if (needsSemantic && input.provider) {
    try {
      const semantic = await runSemanticCompact({
        provider: input.provider,
        userRequest: input.userRequest,
        priorSummary: priorMemory?.summaryBody ?? "",
        sections,
        pinnedFacts,
      });
      summaryBody = mergeSummaryBodies(
        priorMemory?.summaryBody ?? "",
        semantic.summaryBody,
      );
      changedFiles = uniqueFiles([...changedFiles, ...semantic.changedFiles]);
      method = "semantic";
    } catch {
      method = "deterministic";
    }
  }

  let memoryContent = buildStructuredCompactedMemory({
    round,
    method,
    contextWindow,
    userRequest: input.userRequest,
    latestUnderstanding: latestReflection.understanding,
    latestPlannedNext: latestReflection.plannedNext,
    latestBlockers: latestReflection.blockers,
    pinnedFacts,
    summaryBody,
    changedFiles,
    pinnedFileSnippets,
    pinnedPrepareHint,
    userAnchors,
  });

  const memoryMessage: AgentMessage = {
    role: "user",
    content: memoryContent,
  };

  let nextMessages = [...head, memoryMessage, ...tail];
  let estimatedTokensAfter = estimateMessagesTokens(nextMessages);

  if (needsEmergencyCollapse(estimatedTokensAfter, maxContext)) {
    const collapsedTail = nextMessages.slice(-COLLAPSE_TAIL_KEEP);
    const collapsedHead = nextMessages.slice(
      0,
      Math.min(3, Math.max(0, nextMessages.length - COLLAPSE_TAIL_KEEP)),
    );
    const collapseSummary = mergeSummaryBodies(
      priorMemory?.summaryBody ?? "",
      [
        "### Emergency collapse",
        "Context still over budget after auto-compact. Continue from pinned facts and recent tail only.",
        `Task: ${input.userRequest.slice(0, 400)}`,
      ].join("\n\n"),
    );
    const collapseMemory = buildStructuredCompactedMemory({
      round,
      method: "deterministic",
      contextWindow,
      userRequest: input.userRequest,
      latestUnderstanding: latestReflection.understanding,
      latestPlannedNext: latestReflection.plannedNext,
      latestBlockers: latestReflection.blockers,
      pinnedFacts,
      summaryBody: collapseSummary,
      changedFiles,
      pinnedFileSnippets: pinnedFileSnippets.slice(0, 3),
      pinnedPrepareHint,
      userAnchors,
    });
    nextMessages = [
      ...collapsedHead,
      { role: "user", content: collapseMemory },
      ...collapsedTail,
    ];
    estimatedTokensAfter = estimateMessagesTokens(nextMessages);
    layersApplied.push("collapse");
    memoryContent = collapseMemory;
  }

  layersApplied.push("auto");

  return {
    messages: nextMessages,
    method,
    summaryId: newId("summary"),
    contextWindow,
    estimatedTokensBefore,
    estimatedTokensAfter,
    middleMessageCount: middle.length,
    round,
    summaryPreview: memoryContent.slice(0, SUMMARY_PREVIEW_CHARS),
    memoryContent,
    pinnedFacts,
    changedFiles,
    layersApplied: layersApplied.length > 0 ? layersApplied : undefined,
  };
}

function uniqueFiles(files: string[]): string[] {
  return [...new Set(files.map((f) => f.replaceAll("\\", "/")))].sort();
}

function emptyResult(
  messages: AgentMessage[],
  estimatedTokensBefore: number,
): LoopContextCompactResult {
  return {
    messages,
    method: "none",
    estimatedTokensBefore,
    estimatedTokensAfter: estimatedTokensBefore,
    middleMessageCount: 0,
    round: 0,
  };
}

export function shouldApplyCompactionMessages(
  result: LoopContextCompactResult,
): boolean {
  if (result.method !== "none") return true;
  return Boolean(result.layersApplied?.length);
}

export function createLoopCompactEventPayload(
  result: LoopContextCompactResult,
): {
  summaryId: string;
  estimatedTokensBefore: number;
  estimatedTokensAfter: number;
  method: "deterministic" | "semantic";
  compactedAt: string;
  round: number;
  middleMessageCount: number;
  summaryPreview?: string;
  memoryContent?: string;
  contextWindow?: LoopContextWindow;
  pinnedApprovalCount?: number;
  changedFileCount?: number;
  layersApplied?: string[];
} | null {
  if (result.method === "none" || !result.summaryId) return null;
  return {
    summaryId: result.summaryId,
    estimatedTokensBefore: result.estimatedTokensBefore,
    estimatedTokensAfter: result.estimatedTokensAfter,
    method: result.method,
    compactedAt: nowIso(),
    round: result.round,
    middleMessageCount: result.middleMessageCount,
    summaryPreview: result.summaryPreview,
    memoryContent: result.memoryContent,
    contextWindow: result.contextWindow,
    pinnedApprovalCount: result.pinnedFacts?.approvalIds.length,
    changedFileCount: result.changedFiles?.length,
    layersApplied: result.layersApplied,
  };
}
