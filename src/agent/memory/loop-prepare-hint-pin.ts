/**
 * Loop 压缩时钉住 UI prepare 的 exact search 候选（A084）。
 * 避免长对话 middle 被驱逐后模型丢失 Candidate 行。
 */
import type { UiPrepareHint } from "@/agent/core/ui-prepare-nudge";
import type { AgentMessage } from "@/agent/types";

export const SECTION_PREPARE_HINT_ZH = "## 钉住 prepare 候选";
export const SECTION_PREPARE_HINT = "## Pinned prepare candidates";

const NUDGE_MARKER = "=== UI prepare nudge";
const TARGET_FILE = /^Target file:\s*(.+)$/gm;
const CANDIDATE_LINE = /^Candidate\s+(\d+):\s*(.+)$/gm;
const PINNED_CANDIDATE = /^-\s+Candidate\s+\d+:\s*(.+)$/gm;

function slicePrepareHintSection(text: string): string {
  for (const header of [SECTION_PREPARE_HINT_ZH, SECTION_PREPARE_HINT]) {
    const index = text.indexOf(header);
    if (index < 0) continue;
    let scope = text.slice(index + header.length);
    const summaryMatch = /\n## (?:摘要|Summary)\b/.exec(scope);
    if (summaryMatch && summaryMatch.index > 0) {
      scope = scope.slice(0, summaryMatch.index);
    }
    return scope;
  }
  return text;
}

function messageText(message: AgentMessage): string {
  if (typeof message.content === "string") return message.content;
  return JSON.stringify(message.content);
}

function parseCandidateJson(raw: string): string | null {
  const trimmed = raw.trim();
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return typeof parsed === "string" ? parsed : null;
  } catch {
    return trimmed.replace(/^"|"$/g, "") || null;
  }
}

/** 从 reflection/checkpoint 或已压缩记忆块解析 prepare 候选。 */
export function extractPrepareHintFromText(text: string): UiPrepareHint | null {
  const scope = slicePrepareHintSection(text);
  const hasPinnedBlock = /^###\s+[\w./\\-]+/m.test(scope);
  if (
    !text.includes(NUDGE_MARKER) &&
    !text.includes(SECTION_PREPARE_HINT_ZH) &&
    !hasPinnedBlock
  ) {
    return null;
  }

  const targetMatch = TARGET_FILE.exec(scope);
  if (!targetMatch) {
    const pathMatch = /^###\s+([\w./\\-]+)/m.exec(scope);
    if (!pathMatch) return null;
    const path = pathMatch[1].replaceAll("\\", "/");
    const lines: string[] = [];
    for (const match of scope.matchAll(PINNED_CANDIDATE)) {
      const line = parseCandidateJson(match[1]);
      if (line) lines.push(line);
    }
    return lines.length > 0 ? { path, suggestedSearchLines: [...new Set(lines)] } : null;
  }

  const path = targetMatch[1].trim().replaceAll("\\", "/");
  const lines: string[] = [];
  for (const match of scope.matchAll(CANDIDATE_LINE)) {
    const line = parseCandidateJson(match[2]);
    if (line) lines.push(line);
  }

  return lines.length > 0 ? { path, suggestedSearchLines: [...new Set(lines)] } : null;
}

export function extractPrepareHintFromMessages(
  messages: AgentMessage[],
): UiPrepareHint | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const hint = extractPrepareHintFromText(messageText(messages[index]));
    if (hint) return hint;
  }
  return null;
}

export function mergePrepareHints(
  prior: UiPrepareHint | null | undefined,
  next: UiPrepareHint | null | undefined,
): UiPrepareHint | null {
  if (!prior && !next) return null;
  if (!prior) return next ?? null;
  if (!next) return prior;
  if (prior.path !== next.path) return next;
  return {
    path: next.path,
    suggestedSearchLines: [
      ...new Set([
        ...prior.suggestedSearchLines,
        ...next.suggestedSearchLines,
      ]),
    ].slice(0, 6),
  };
}

export function formatPinnedPrepareHintBlock(hint: UiPrepareHint | null): string {
  if (!hint || hint.suggestedSearchLines.length === 0) {
    return "- (none)";
  }

  const lines = [
    `### ${hint.path}`,
    "file.replace.prepare MUST use one Candidate below as exact search (include spaces).",
    ...hint.suggestedSearchLines.map(
      (line, index) => `- Candidate ${index + 1}: ${JSON.stringify(line)}`,
    ),
  ];
  return lines.join("\n");
}

export function parsePinnedPrepareHintFromBlock(
  block: string,
): UiPrepareHint | null {
  if (!block.trim() || block.includes("(none)")) return null;
  return extractPrepareHintFromText(block);
}
