/**
 * A125：工具观测「墓碑」stub — 结构化省略摘要 + 检索提示（对标 F148 tombstone，编程 Agent 版）。
 */
import type { AgentMessage } from "@/agent/types";
import { estimateTokens } from "@/agent/memory/context-manager";

export const TOMBSTONE_MARKER = "[TOMBSTONE";

export const MICRO_OBSERVATION_STUB =
  `${TOMBSTONE_MARKER} micro] see [COMPACTED_MEMORY] snippets`;

export const SOFT_TOOL_COLLAPSE_STUB =
  `${TOMBSTONE_MARKER} soft] re-call tool or file.read storagePath`;

export type TombstoneKind = "micro" | "soft";

export type ToolObservationMeta = {
  toolName: string | null;
  storagePath?: string;
  filePath?: string;
  tokenEstimate: number;
};

function messageBody(message: AgentMessage): string {
  if (message.role === "tool") {
    return typeof message.content === "string"
      ? message.content
      : JSON.stringify(message.content ?? "");
  }
  if (typeof message.content === "string") return message.content;
  return JSON.stringify(message.content);
}

export function parseObservationToolName(text: string): string | null {
  const match = /Observation from ([^:]+):/.exec(text);
  return match?.[1]?.trim() ?? null;
}

function tryParseObservationJson(text: string): Record<string, unknown> | null {
  const newline = text.indexOf("\n");
  const jsonPart = newline >= 0 ? text.slice(newline + 1).trim() : text.trim();
  if (!jsonPart.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(jsonPart) as Record<string, unknown>;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

/** 从观测正文提取 tool 名、外置路径、文件路径。 */
export function parseToolObservationMeta(message: AgentMessage): ToolObservationMeta {
  const body = messageBody(message);
  const tokenEstimate = estimateTokens(body);
  let toolName = parseObservationToolName(body);

  if (message.role === "tool" && !toolName) {
    toolName = "tool";
  }

  const parsed = tryParseObservationJson(body);
  const storagePath =
    typeof parsed?.storagePath === "string"
      ? parsed.storagePath
      : /"storagePath"\s*:\s*"([^"]+)"/.exec(body)?.[1];
  const filePath =
    typeof parsed?.path === "string"
      ? parsed.path
      : typeof parsed?.filePath === "string"
        ? parsed.filePath
        : /"path"\s*:\s*"([^"]+)"/.exec(body)?.[1];

  return { toolName, storagePath, filePath, tokenEstimate };
}

/** 零成本关键词：路径、@ 提及、常见文件片段。 */
export function extractTombstoneKeywords(text: string, max = 5): string[] {
  const seen = new Set<string>();
  const keywords: string[] = [];

  const add = (value: string) => {
    const normalized = value.replaceAll("\\", "/").trim();
    if (!normalized || normalized.length < 3 || seen.has(normalized)) return;
    seen.add(normalized);
    keywords.push(normalized);
  };

  for (const match of text.matchAll(/@[\w./-]+(?:#\d+(?:-\d+)?)?/g)) {
    add(match[0].replace(/^@/, ""));
  }
  for (const match of text.matchAll(
    /(?:^|[\s"'`(])([a-zA-Z0-9_./-]+\.(?:tsx?|jsx?|vue|css|md|json|py|go|rs))\b/g,
  )) {
    add(match[1] ?? "");
  }
  for (const match of text.matchAll(
    /(?:^|[\s"'`(])(src\/[a-zA-Z0-9_./-]+)/g,
  )) {
    add(match[1] ?? "");
  }

  return keywords.slice(0, max);
}

function buildRecallHints(meta: ToolObservationMeta, kind: TombstoneKind): string[] {
  const hints: string[] = [];
  if (meta.storagePath) {
    hints.push(`file.read ${meta.storagePath}`);
  }
  if (meta.filePath && meta.toolName === "file.read") {
    hints.push(`re-call file.read ${meta.filePath}`);
  } else if (meta.toolName) {
    hints.push(`re-call ${meta.toolName}`);
  }
  if (kind === "micro") {
    hints.push("[COMPACTED_MEMORY] snippets");
  }
  return hints.slice(0, 3);
}

/** 约 40–80 token 的结构化墓碑（单行头 + 关键词 + recall）。 */
export function buildToolObservationTombstone(
  message: AgentMessage,
  kind: TombstoneKind,
): string {
  const body = messageBody(message);
  const firstLine = body.split("\n")[0] ?? body.slice(0, 120);
  const meta = parseToolObservationMeta(message);
  const toolLabel = meta.toolName ?? "tool";
  const keywords = extractTombstoneKeywords(body);
  const recall = buildRecallHints(meta, kind);

  const header = `${TOMBSTONE_MARKER} ${kind} tool=${toolLabel} ~${meta.tokenEstimate}tok]`;
  const keywordLine =
    keywords.length > 0 ? `keywords: ${keywords.join(", ")}` : undefined;
  const recallLine =
    recall.length > 0 ? `recall: ${recall.join(" | ")}` : undefined;

  return [
    firstLine,
    header,
    keywordLine,
    recallLine,
  ]
    .filter(Boolean)
    .join("\n");
}

export function isTombstoneStubText(text: string): boolean {
  return text.includes(TOMBSTONE_MARKER);
}

/** middle 里带 @ / 附图 / 代码块的用户消息，压缩时钉入 [COMPACTED_MEMORY]。 */
export function extractUserMessageAnchors(
  messages: AgentMessage[],
  max = 3,
): string[] {
  const ranked: { text: string; score: number }[] = [];

  for (const message of messages) {
    if (message.role !== "user") continue;
    const text =
      typeof message.content === "string"
        ? message.content
        : Array.isArray(message.content)
          ? message.content
              .map((part) =>
                part.type === "text"
                  ? part.text
                  : part.type === "image_url"
                    ? "[image]"
                    : "",
              )
              .join("\n")
          : String(message.content ?? "");

    if (
      text.startsWith("[COMPACTED_MEMORY") ||
      text.startsWith("Observation from") ||
      text.includes("Reflection (")
    ) {
      continue;
    }

    let score = 0;
    if (/@\S+/.test(text)) score += 3;
    if (text.includes("[image]") || text.includes("data:image/")) score += 4;
    if (/```/.test(text)) score += 2;
    if (text.length > 120) score += 1;

    if (score <= 0) continue;
    ranked.push({
      text: text.trim().slice(0, 420),
      score,
    });
  }

  ranked.sort((a, b) => b.score - a.score);
  const seen = new Set<string>();
  const anchors: string[] = [];
  for (const item of ranked) {
    if (seen.has(item.text)) continue;
    seen.add(item.text);
    anchors.push(item.text);
    if (anchors.length >= max) break;
  }
  return anchors;
}

export function formatUserAnchorsBlock(anchors: string[]): string {
  if (anchors.length === 0) return "none";
  return anchors.map((text, index) => `${index + 1}. ${text}`).join("\n\n");
}
