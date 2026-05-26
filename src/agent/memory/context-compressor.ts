/**
 * Context Compressor 骨架。
 *
 * 当前是确定性压缩：把多个 ContextSection 提炼成结构化 ContextSummary。
 * 这保证即使不调用模型，也能先把旧上下文、大日志和工具结果收拢起来。
 * 后续可以在这个接口后面接模型 compact。
 */
import { newId, nowIso } from "@/agent/types";
import type {
  ContextCompressionInput,
  ContextCompressionResult,
  ContextSection,
  ContextSummary,
} from "@/agent/memory/types";
import { estimateTokens } from "@/agent/memory/context-manager";

const DEFAULT_MAX_SECTION_CHARS = 1200;
const DEFAULT_MAX_FACTS = 24;

function firstNonEmptyLines(text: string, maxLines: number): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, maxLines);
}

function compactText(text: string, maxChars: number): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, maxChars - 3)}...`;
}

function extractChangedFiles(sections: ContextSection[]): string[] {
  const files = new Set<string>();
  const filePattern =
    /(?:^|\s)([\w./\\-]+\.(?:ts|tsx|js|jsx|json|md|css|scss|mjs|mts|yml|yaml))/gi;

  for (const section of sections) {
    const haystack = `${section.source ?? ""}\n${section.content}`;
    for (const match of haystack.matchAll(filePattern)) {
      files.add(match[1].replaceAll("\\", "/"));
    }
  }

  return [...files].sort();
}

function buildFacts(
  sections: ContextSection[],
  maxSectionChars: number,
  maxFacts: number,
): string[] {
  const facts: string[] = [];

  for (const section of sections) {
    const lines = firstNonEmptyLines(section.content, 6);
    const compacted = lines.length > 0 ? lines.join(" ") : section.content;
    facts.push(
      `[${section.kind}] ${section.title}: ${compactText(
        compacted,
        maxSectionChars,
      )}`,
    );
    if (facts.length >= maxFacts) break;
  }

  return facts;
}

export function compressContext(
  input: ContextCompressionInput,
): ContextCompressionResult {
  const maxSectionChars = input.maxSectionChars ?? DEFAULT_MAX_SECTION_CHARS;
  const maxFacts = input.maxFacts ?? DEFAULT_MAX_FACTS;
  const estimatedTokensBefore = input.sections.reduce(
    (total, section) => total + section.estimatedTokens,
    0,
  );
  const sourceSectionIds = input.sections.map((section) => section.id);
  const facts = buildFacts(input.sections, maxSectionChars, maxFacts);
  const changedFiles = extractChangedFiles(input.sections);
  const summaryText = [
    `Compressed ${input.sections.length} context sections for ${input.scope}.`,
    facts.length > 0 ? "Key facts:" : "No key facts.",
    ...facts.map((fact) => `- ${fact}`),
    changedFiles.length > 0 ? "Referenced files:" : "",
    ...changedFiles.map((file) => `- ${file}`),
  ]
    .filter(Boolean)
    .join("\n");
  const summary: ContextSummary = {
    id: newId("summary"),
    scope: input.scope,
    sourceSectionIds,
    title: `Compressed ${input.scope} context`,
    summary: summaryText,
    facts,
    openQuestions: [],
    changedFiles,
    estimatedTokensBefore,
    estimatedTokensAfter: estimateTokens(summaryText),
    createdAt: nowIso(),
  };
  const section: ContextSection = {
    id: `context-summary:${summary.id}`,
    kind:
      input.scope === "thread"
        ? "thread_memory"
        : input.scope === "task"
          ? "task_memory"
          : input.scope === "tool"
            ? "tool_result"
            : "turn_context",
    title: summary.title,
    content: summary.summary,
    priority: 70,
    estimatedTokens: summary.estimatedTokensAfter,
    source: summary.id,
  };

  return { summary, section };
}

export function shouldCompressContext(
  sections: ContextSection[],
  tokenThreshold: number,
): boolean {
  const total = sections.reduce(
    (sum, section) => sum + section.estimatedTokens,
    0,
  );
  return total > tokenThreshold;
}
