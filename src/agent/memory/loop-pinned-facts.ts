/**
 * Loop 压缩时必须保留的「钉住事实」（对齐 Cursor/Codex 的 pinned context）。
 */
import type { AgentMessage } from "@/agent/types";

export type LoopPinnedFacts = {
  approvalIds: string[];
  filePaths: string[];
  branches: string[];
  errors: string[];
  blockers: string[];
  toolHighlights: string[];
};

const APPROVAL_ID = /\b(approval_[a-z0-9-]+)\b/gi;
const FILE_PATH =
  /(?:^|[\s"'`(])([\w./\\-]+\.(?:ts|tsx|js|jsx|json|md|css|scss|mjs|mts|yml|yaml))\b/gi;
const GIT_BRANCH_CMD = /git branch\s+([\w./-]+)/gi;

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.map((v) => v.trim()).filter(Boolean))].sort();
}

function messageText(message: AgentMessage): string {
  if (typeof message.content === "string") return message.content;
  return JSON.stringify(message.content);
}

export function emptyPinnedFacts(): LoopPinnedFacts {
  return {
    approvalIds: [],
    filePaths: [],
    branches: [],
    errors: [],
    blockers: [],
    toolHighlights: [],
  };
}

export function mergePinnedFacts(
  a: LoopPinnedFacts,
  b: LoopPinnedFacts,
): LoopPinnedFacts {
  return {
    approvalIds: uniqueSorted([...a.approvalIds, ...b.approvalIds]),
    filePaths: uniqueSorted([...a.filePaths, ...b.filePaths]),
    branches: uniqueSorted([...a.branches, ...b.branches]),
    errors: uniqueSorted([...a.errors, ...b.errors]).slice(0, 12),
    blockers: uniqueSorted([...a.blockers, ...b.blockers]).slice(0, 8),
    toolHighlights: uniqueSorted([...a.toolHighlights, ...b.toolHighlights]).slice(
      0,
      16,
    ),
  };
}

export function extractPinnedFactsFromText(text: string): LoopPinnedFacts {
  const approvalIds: string[] = [];
  const filePaths: string[] = [];
  const branches: string[] = [];
  const errors: string[] = [];
  const blockers: string[] = [];
  const toolHighlights: string[] = [];

  for (const match of text.matchAll(APPROVAL_ID)) {
    approvalIds.push(match[1]);
  }

  for (const match of text.matchAll(FILE_PATH)) {
    filePaths.push(match[1].replaceAll("\\", "/"));
  }

  for (const match of text.matchAll(GIT_BRANCH_CMD)) {
    branches.push(match[1]);
  }

  if (text.includes("codex/")) {
    for (const match of text.matchAll(/\bcodex\/[\w./-]+\b/g)) {
      branches.push(match[0]);
    }
  }

  const errorLine = /"(?:error|message)":\s*"([^"]{8,200})"/gi;
  for (const match of text.matchAll(errorLine)) {
    errors.push(match[1]);
  }

  const blockerMatch = /Blockers:\s*(.+)/i.exec(text);
  if (blockerMatch && !blockerMatch[1].includes("(none)")) {
    blockers.push(blockerMatch[1].trim());
  }

  const observationHeader = /^Observation from ([\w.]+):/gm;
  for (const match of text.matchAll(observationHeader)) {
    toolHighlights.push(match[1]);
  }

  if (text.includes("approval") && text.includes("pending")) {
    toolHighlights.push("pending_approval");
  }

  return {
    approvalIds: uniqueSorted(approvalIds),
    filePaths: uniqueSorted(filePaths),
    branches: uniqueSorted(branches),
    errors: uniqueSorted(errors),
    blockers: uniqueSorted(blockers),
    toolHighlights: uniqueSorted(toolHighlights),
  };
}

export function extractPinnedFactsFromMessages(
  messages: AgentMessage[],
): LoopPinnedFacts {
  return messages.reduce(
    (acc, message) =>
      mergePinnedFacts(acc, extractPinnedFactsFromText(messageText(message))),
    emptyPinnedFacts(),
  );
}

export function formatPinnedFactsBlock(facts: LoopPinnedFacts): string {
  const lines: string[] = [];

  if (facts.approvalIds.length > 0) {
    lines.push(
      ...facts.approvalIds.map((id) => `- approval: ${id} (must not lose)`),
    );
  }
  if (facts.filePaths.length > 0) {
    lines.push(
      ...facts.filePaths.slice(0, 24).map((file) => `- file: ${file}`),
    );
    if (facts.filePaths.length > 24) {
      lines.push(`- … +${facts.filePaths.length - 24} more files`);
    }
  }
  if (facts.branches.length > 0) {
    lines.push(...facts.branches.map((branch) => `- branch: ${branch}`));
  }
  if (facts.errors.length > 0) {
    lines.push(...facts.errors.map((error) => `- error: ${error}`));
  }
  if (facts.blockers.length > 0) {
    lines.push(...facts.blockers.map((blocker) => `- blocker: ${blocker}`));
  }
  if (facts.toolHighlights.length > 0) {
    lines.push(
      `- recent tools: ${facts.toolHighlights.slice(0, 10).join(", ")}`,
    );
  }

  return lines.length > 0 ? lines.join("\n") : "- (none extracted)";
}
