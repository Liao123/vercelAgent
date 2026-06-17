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
import {
  LOOP_COMPACTION_CONFIG,
} from "@/agent/memory/loop-compaction-config";
import {
  COLLAPSE_TAIL_KEEP,
  microCompactMiddleObservations,
  needsEmergencyCollapse,
  snipLowValueMiddleMessages,
} from "@/agent/memory/loop-compaction-layers";
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
import type { ModelProvider } from "@/agent/model/types";
import type { AgentMessage } from "@/agent/types";
import { newId, nowIso } from "@/agent/types";

/** 无 thread 记忆时至少保留 system + 当前用户任务。 */
const MIN_PINNED_HEAD_COUNT = 2;
const TAIL_KEEP_COUNT = LOOP_COMPACTION_CONFIG.tailKeepCount;
const MIDDLE_TRIGGER_TOKENS = LOOP_COMPACTION_CONFIG.middleTokenTrigger;
const MIDDLE_MESSAGE_TRIGGER = LOOP_COMPACTION_CONFIG.middleMessageTrigger;
const OBSERVATION_JSON_MAX = 8_000;
const FILE_READ_CONTENT_MAX = 12_000;
const SUMMARY_MERGE_MAX_CHARS = 10_000;
const SUMMARY_PREVIEW_CHARS = 420;

const COMPACTED_MEMORY_PREFIX = "[COMPACTED_MEMORY";
const SECTION_PINNED = "## Pinned facts";
const SECTION_PINNED_ZH = "## 钉住事实";
const SECTION_SUMMARY = "## Summary";
const SECTION_SUMMARY_ZH = "## 摘要";
const SECTION_CHANGED = "## Changed files";
const SECTION_CHANGED_ZH = "## 涉及文件";

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

export type ParsedCompactedMemory = {
  round: number;
  method?: string;
  pinnedFacts: LoopPinnedFacts;
  summaryBody: string;
  changedFiles: string[];
  pinnedFileSnippets: PinnedFileSnippet[];
  pinnedPrepareHint: UiPrepareHint | null;
};

function messageText(message: AgentMessage): string {
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

/** 写入模型上下文前的工具结果整形（单条观测上限）。 */
export function shapeToolResultForObservation(
  toolName: string,
  result: unknown,
): unknown {
  if (!result || typeof result !== "object") {
    return result;
  }

  const record = result as Record<string, unknown>;

  if (toolName === "file.read") {
    return truncateFileReadResult(record);
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

  if (toolName === "workspace.inspect" && record.git && typeof record.git === "object") {
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

  if (toolName === "file.mutation.prepare" || toolName === "file.replace.prepare") {
    const approval = record.approval;
    if (approval && typeof approval === "object") {
      const approvalRecord = approval as Record<string, unknown>;
      return {
        prepared: true,
        approvalId: approvalRecord.id,
        title: approvalRecord.title,
        status: approvalRecord.status,
        path:
          typeof record.path === "string"
            ? record.path
            : undefined,
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
    toolName === "shell.command.prepare"
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

  return JSON.parse(safeJson(result, OBSERVATION_JSON_MAX));
}

export function buildToolObservationMessage(
  toolName: string,
  result: unknown,
): AgentMessage {
  const shaped = shapeToolResultForObservation(toolName, result);
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

  if (
    count < tailStartIndex &&
    isPrimaryTaskUserMessage(messages[count])
  ) {
    count += 1;
  }

  return Math.max(count, Math.min(MIN_PINNED_HEAD_COUNT, tailStartIndex));
}

export function splitLoopMessagesForCompaction(messages: AgentMessage[]): {
  head: AgentMessage[];
  middle: AgentMessage[];
  tail: AgentMessage[];
} {
  const tailStart = Math.max(0, messages.length - TAIL_KEEP_COUNT);
  const headCount = resolveLoopPinnedHeadCount(messages, tailStart);
  return {
    head: messages.slice(0, headCount),
    middle: messages.slice(headCount, tailStart),
    tail: messages.slice(tailStart),
  };
}

export function parseCompactedMemory(content: string): ParsedCompactedMemory | null {
  if (!content.startsWith(COMPACTED_MEMORY_PREFIX)) return null;

  const roundMatch = /round\s+(\d+)/i.exec(content);
  const methodMatch = /,\s*(deterministic|semantic)\]/i.exec(content);
  const pinnedStart = findSectionStart(content, SECTION_PINNED_ZH, SECTION_PINNED);
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
  const summaryStart = findSectionStart(content, SECTION_SUMMARY_ZH, SECTION_SUMMARY);
  const changedStart = findSectionStart(content, SECTION_CHANGED_ZH, SECTION_CHANGED);

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
      ? content.slice(
          pinnedStart + pinnedHeaderLen,
          snippetsStart > pinnedStart ? snippetsStart : summaryStart,
        ).trim()
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
      ? content.slice(
          summaryStart + summaryHeaderLen,
          changedStart >= summaryStart ? changedStart : undefined,
        ).trim()
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
    pinnedFacts: extractPinnedFactsFromText(pinnedBlock),
    summaryBody,
    changedFiles,
    pinnedFileSnippets: parsePinnedFileSnippetsFromBlock(snippetsBlock),
    pinnedPrepareHint: parsePinnedPrepareHintFromBlock(prepareHintBlock),
  };
}

export function buildStructuredCompactedMemory(input: {
  round: number;
  method: LoopContextCompactMethod;
  pinnedFacts: LoopPinnedFacts;
  summaryBody: string;
  changedFiles: string[];
  pinnedFileSnippets?: PinnedFileSnippet[];
  pinnedPrepareHint?: UiPrepareHint | null;
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

  return [
    `${COMPACTED_MEMORY_PREFIX} — round ${input.round}, ${input.method}]`,
    "本轮滚动任务记忆。最近 tail 消息代表最新一步。",
    "如需核实下方未列出的细节，可再次调用工具。",
    "",
    SECTION_PINNED_ZH,
    formatPinnedFactsBlock(input.pinnedFacts),
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
    const parsed = parseCompactedMemory(
      `${COMPACTED_MEMORY_PREFIX} — round 1, semantic]\n${SECTION_SUMMARY}\n${output.summary}`,
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
        content: [
          "Merge prior memory with new agent steps into compact memory.",
          "Output sections ## Summary and ## Changed files only.",
          "Copy every approval_* id from Pinned facts into Summary verbatim.",
          "Do not invent facts. Collapse duplicate file reads.",
        ].join("\n"),
      },
      {
        role: "user",
        content: [
          `Task:\n${input.userRequest}`,
          `\nPinned:\n${pinnedBlock}`,
          input.priorSummary
            ? `\nPrior memory:\n${input.priorSummary}`
            : "",
          `\nNew steps:\n${JSON.stringify(sectionPayload, null, 2)}`,
        ].join("\n"),
      },
    ],
    maxTokens: 1_100,
    temperature: 0,
  });

  const parsed = parseCompactedMemory(
    `${COMPACTED_MEMORY_PREFIX} — round 1, semantic]\n${output.content}`,
  );
  return {
    summaryBody: parsed?.summaryBody ?? output.content.trim(),
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
  /** API 超长等紧急场景：跳过阈值直接压缩（Reactive） */
  forceCompact?: boolean;
}): Promise<LoopContextCompactResult> {
  const layersApplied: string[] = [];
  const messages = [...input.messages];
  const estimatedTokensBefore = estimateMessagesTokens(messages);
  const maxContext = getMaxContextTokens(DEFAULT_TOKEN_BUDGET);

  const { head, middle: initialMiddle, tail } =
    splitLoopMessagesForCompaction(messages);
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
  const mustCompact =
    shouldCompact || input.forceCompact === true || layersApplied.length > 0;

  if (!mustCompact) {
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
  const pinnedFacts = mergePinnedFacts(
    priorMemory?.pinnedFacts ?? emptyPinnedFacts(),
    mergePinnedFacts(
      mergePinnedFacts(headPinned, evictedPinned),
      tailPinned,
    ),
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

  const afterDeterministic = estimateMessagesTokens([
    ...head,
    {
      role: "user",
      content: buildStructuredCompactedMemory({
        round: input.compactRound ?? 1,
        method: "deterministic",
        pinnedFacts,
        summaryBody,
        changedFiles,
        pinnedFileSnippets,
        pinnedPrepareHint,
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
      changedFiles = uniqueFiles([
        ...changedFiles,
        ...semantic.changedFiles,
      ]);
      method = "semantic";
    } catch {
      method = "deterministic";
    }
  }

  const round = input.compactRound ?? (priorMemory?.round ?? 0) + 1;
  let memoryContent = buildStructuredCompactedMemory({
    round,
    method,
    pinnedFacts,
    summaryBody,
    changedFiles,
    pinnedFileSnippets,
    pinnedPrepareHint,
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
      pinnedFacts,
      summaryBody: collapseSummary,
      changedFiles,
      pinnedFileSnippets: pinnedFileSnippets.slice(0, 3),
      pinnedPrepareHint,
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

  if (method !== "none") {
    layersApplied.push("auto");
  }

  return {
    messages: nextMessages,
    method,
    summaryId: newId("summary"),
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
  pinnedApprovalCount?: number;
  changedFileCount?: number;
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
    pinnedApprovalCount: result.pinnedFacts?.approvalIds.length,
    changedFileCount: result.changedFiles?.length,
  };
}
