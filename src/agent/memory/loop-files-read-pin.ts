/**
 * Loop 压缩时钉住最近 file.read 的关键片段（A080）。
 */
import type { AgentMessage } from "@/agent/types";

export type PinnedFileSnippet = {
  path: string;
  startLine: number;
  snippet: string;
};

export const SECTION_FILE_SNIPPETS_ZH = "## 钉住文件片段";
export const SECTION_FILE_SNIPPETS = "## Pinned file snippets";

const DEFAULT_MAX_FILES = 6;
const DEFAULT_MAX_CHARS = 1_200;

function messageText(message: AgentMessage): string {
  if (typeof message.content === "string") return message.content;
  return JSON.stringify(message.content);
}

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\/+/, "");
}

function truncateSnippet(content: string, maxChars: number): string {
  if (content.length <= maxChars) return content;
  return `${content.slice(0, maxChars)}\n...[snippet truncated at ${maxChars} chars]`;
}

function parseFileReadObservation(text: string): { path: string; content: string } | null {
  if (!text.startsWith("Observation from file.read:")) return null;
  const jsonStart = text.indexOf("{");
  if (jsonStart < 0) return null;
  try {
    const parsed = JSON.parse(text.slice(jsonStart)) as Record<string, unknown>;

    let path =
      typeof parsed.path === "string" ? normalizePath(parsed.path) : undefined;
    let content =
      typeof parsed.content === "string" ? parsed.content : undefined;

    if (!content && parsed.truncated && typeof parsed.preview === "string") {
      const preview = parsed.preview;
      if (!path) {
        const pathMatch = /"path":\s*"([^"\\]+)"/.exec(preview);
        if (pathMatch) path = normalizePath(pathMatch[1]);
      }
      try {
        const previewObj = JSON.parse(preview) as {
          path?: unknown;
          content?: unknown;
        };
        if (!path && typeof previewObj.path === "string") {
          path = normalizePath(previewObj.path);
        }
        if (typeof previewObj.content === "string") {
          content = previewObj.content;
        }
      } catch {
        const contentMatch = /"content":\s*"((?:[^"\\]|\\.)*)"/.exec(
          preview,
        );
        if (contentMatch) {
          try {
            content = JSON.parse(`"${contentMatch[1]}"`) as string;
          } catch {
            content = contentMatch[1]
              .replace(/\\n/g, "\n")
              .replace(/\\t/g, "\t")
              .replace(/\\"/g, '"')
              .replace(/\\\\/g, "\\");
          }
        }
      }
    }

    if (!path) {
      const pathMatch = /"path":\s*"([^"\\]+)"/.exec(text);
      if (pathMatch) path = normalizePath(pathMatch[1]);
    }

    if (!path || !content) return null;
    return { path, content };
  } catch {
    return null;
  }
}

/** 从消息历史提取最近 file.read 片段，优先 filesReadPaths 中的路径顺序。 */
export function extractFileReadSnippetsFromMessages(
  messages: AgentMessage[],
  options?: {
    maxFiles?: number;
    maxCharsPerFile?: number;
    filesReadPaths?: string[];
  },
): PinnedFileSnippet[] {
  const maxFiles = options?.maxFiles ?? DEFAULT_MAX_FILES;
  const maxChars = options?.maxCharsPerFile ?? DEFAULT_MAX_CHARS;
  const byPath = new Map<string, PinnedFileSnippet>();

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const parsed = parseFileReadObservation(messageText(messages[index]));
    if (!parsed || byPath.has(parsed.path)) continue;
    byPath.set(parsed.path, {
      path: parsed.path,
      startLine: 1,
      snippet: truncateSnippet(parsed.content, maxChars),
    });
    if (byPath.size >= maxFiles * 2) break;
  }

  const preferred = (options?.filesReadPaths ?? []).map(normalizePath).filter(Boolean);
  const ordered: PinnedFileSnippet[] = [];

  for (const path of [...preferred].reverse()) {
    const snippet = byPath.get(path);
    if (snippet && !ordered.some((item) => item.path === path)) {
      ordered.push(snippet);
    }
  }

  for (const snippet of byPath.values()) {
    if (ordered.length >= maxFiles) break;
    if (!ordered.some((item) => item.path === snippet.path)) {
      ordered.push(snippet);
    }
  }

  return ordered.slice(0, maxFiles);
}

export function mergePinnedFileSnippets(
  prior: PinnedFileSnippet[],
  next: PinnedFileSnippet[],
  maxFiles = DEFAULT_MAX_FILES,
): PinnedFileSnippet[] {
  const byPath = new Map<string, PinnedFileSnippet>();
  for (const snippet of prior) {
    byPath.set(snippet.path, snippet);
  }
  for (const snippet of next) {
    byPath.set(snippet.path, snippet);
  }
  return [...byPath.values()].slice(-maxFiles);
}

export function formatPinnedFileSnippetsBlock(snippets: PinnedFileSnippet[]): string {
  if (snippets.length === 0) return "- (none)";
  return snippets
    .map(
      (item) =>
        `### ${item.path} (from file.read)\n\`\`\`\n${item.snippet.trim()}\n\`\`\``,
    )
    .join("\n\n");
}

export function parsePinnedFileSnippetsFromBlock(block: string): PinnedFileSnippet[] {
  const snippets: PinnedFileSnippet[] = [];
  const sections = block.split(/^### /m).filter(Boolean);
  for (const section of sections) {
    const pathMatch = /^([\w./\\-]+)\s*(?:\(from file\.read\))?/m.exec(section);
    if (!pathMatch) continue;
    const fenceStart = section.indexOf("```");
    const fenceEnd = fenceStart >= 0 ? section.indexOf("```", fenceStart + 3) : -1;
    const snippet =
      fenceStart >= 0 && fenceEnd > fenceStart
        ? section.slice(fenceStart + 3, fenceEnd).replace(/^\n/, "").trim()
        : section.slice(pathMatch[0].length).trim();
    if (!snippet) continue;
    snippets.push({
      path: normalizePath(pathMatch[1]),
      startLine: 1,
      snippet,
    });
  }
  return snippets;
}
