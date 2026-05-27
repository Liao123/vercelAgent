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
import type { ModelProvider } from "@/agent/model/types";
import type { AgentMessage } from "@/agent/types";
import { newId, nowIso } from "@/agent/types";

const PINNED_HEAD_COUNT = 2;
const TAIL_KEEP_COUNT = 12;
const MIDDLE_TRIGGER_TOKENS = 4_000;
const MIDDLE_MESSAGE_TRIGGER = 8;
const OBSERVATION_JSON_MAX = 8_000;
const FILE_READ_CONTENT_MAX = 12_000;
const SUMMARY_MERGE_MAX_CHARS = 10_000;
const SUMMARY_PREVIEW_CHARS = 420;

const COMPACTED_MEMORY_PREFIX = "[COMPACTED_MEMORY";
const SECTION_PINNED = "## Pinned facts";
const SECTION_SUMMARY = "## Summary";
const SECTION_CHANGED = "## Changed files";

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
};

export type ParsedCompactedMemory = {
  round: number;
  method?: string;
  pinnedFacts: LoopPinnedFacts;
  summaryBody: string;
  changedFiles: string[];
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
    return `${json.slice(0, maxChars)}\n...[truncated ${json.length - maxChars} chars]`;
  } catch {
    return String(value).slice(0, maxChars);
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

  if (toolName === "git.diff" && typeof record.diff === "string") {
    const diff = record.diff;
    if (diff.length > 6_000) {
      return {
        ...record,
        diff: `${diff.slice(0, 6_000)}\n...[diff truncated]`,
        truncated: true,
      };
    }
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

export function parseCompactedMemory(content: string): ParsedCompactedMemory | null {
  if (!content.startsWith(COMPACTED_MEMORY_PREFIX)) return null;

  const roundMatch = /round\s+(\d+)/i.exec(content);
  const methodMatch = /,\s*(deterministic|semantic)\]/i.exec(content);
  const pinnedStart = content.indexOf(SECTION_PINNED);
  const summaryStart = content.indexOf(SECTION_SUMMARY);
  const changedStart = content.indexOf(SECTION_CHANGED);

  const pinnedBlock =
    pinnedStart >= 0 && summaryStart > pinnedStart
      ? content.slice(pinnedStart + SECTION_PINNED.length, summaryStart).trim()
      : "";
  const summaryBody =
    summaryStart >= 0
      ? content.slice(
          summaryStart + SECTION_SUMMARY.length,
          changedStart >= summaryStart ? changedStart : undefined,
        ).trim()
      : content;
  const changedBlock =
    changedStart >= 0
      ? content.slice(changedStart + SECTION_CHANGED.length).trim()
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
  };
}

export function buildStructuredCompactedMemory(input: {
  round: number;
  method: LoopContextCompactMethod;
  pinnedFacts: LoopPinnedFacts;
  summaryBody: string;
  changedFiles: string[];
}): string {
  const changedLines =
    input.changedFiles.length > 0
      ? input.changedFiles.map((file) => `- ${file}`)
      : ["- none"];

  return [
    `${COMPACTED_MEMORY_PREFIX} — round ${input.round}, ${input.method}]`,
    "Rolling task memory. Tail messages are authoritative for the latest step.",
    "Re-call tools only to verify facts missing below.",
    "",
    SECTION_PINNED,
    formatPinnedFactsBlock(input.pinnedFacts),
    "",
    SECTION_SUMMARY,
    input.summaryBody.trim(),
    "",
    SECTION_CHANGED,
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
}): boolean {
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
          "Use sections ## Summary and ## Changed files in your output.",
          "Preserve approval IDs, paths, errors from pinned facts.",
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
}): Promise<LoopContextCompactResult> {
  const messages = [...input.messages];
  const estimatedTokensBefore = estimateMessagesTokens(messages);
  const maxContext = getMaxContextTokens(DEFAULT_TOKEN_BUDGET);

  if (messages.length <= PINNED_HEAD_COUNT + TAIL_KEEP_COUNT + 1) {
    return emptyResult(messages, estimatedTokensBefore);
  }

  const head = messages.slice(0, PINNED_HEAD_COUNT);
  const tail = messages.slice(-TAIL_KEEP_COUNT);
  const middle = messages.slice(PINNED_HEAD_COUNT, messages.length - TAIL_KEEP_COUNT);

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

  if (
    !shouldCompactMessages({
      estimatedTokens: estimatedTokensBefore,
      maxContext,
      middleLength: middle.length,
      middleTokens,
      hasPriorMemory,
    })
  ) {
    return {
      ...emptyResult(messages, estimatedTokensBefore),
      middleMessageCount: middle.length,
    };
  }

  const sections = middle.map((message, index) =>
    middleMessageToSection(message, index),
  );

  const evictedPinned = extractPinnedFactsFromMessages(middle);
  const pinnedFacts = mergePinnedFacts(
    priorMemory?.pinnedFacts ?? emptyPinnedFacts(),
    evictedPinned,
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
        round: (input.compactRound ?? 1),
        method: "deterministic",
        pinnedFacts,
        summaryBody,
        changedFiles,
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
  const memoryContent = buildStructuredCompactedMemory({
    round,
    method,
    pinnedFacts,
    summaryBody,
    changedFiles,
  });

  const memoryMessage: AgentMessage = {
    role: "user",
    content: memoryContent,
  };

  const nextMessages = [...head.slice(0, PINNED_HEAD_COUNT), memoryMessage, ...tail];
  const estimatedTokensAfter = estimateMessagesTokens(nextMessages);

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
