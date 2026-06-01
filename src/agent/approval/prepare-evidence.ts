/**
 * prepare 审批依据：磁盘上的 exact 匹配片段与行号（A077）。
 */
import { contentSnapshotPair } from "@/agent/approval/content-snapshot";

export type PrepareEvidenceInput = {
  path: string;
  content: string;
  search: string;
  source: "file.replace.prepare";
  contextLines?: number;
};

export type PrepareEvidence = {
  path: string;
  startLine: number;
  endLine: number;
  matchedSnippet: string;
  searchText?: string;
  source: "file.replace.prepare" | "file.mutation.prepare";
};

function splitLines(content: string): string[] {
  if (content.length === 0) return [];
  return content.split(/\r?\n/);
}

/** 从 exact search 串定位行号并截取上下文作为审批依据。 */
export function buildPrepareEvidenceFromSearch(
  input: PrepareEvidenceInput,
): PrepareEvidence {
  const { path, content, search, source } = input;
  const contextLines = input.contextLines ?? 3;
  const index = content.indexOf(search);

  if (index === -1) {
    return {
      path,
      startLine: 1,
      endLine: 1,
      matchedSnippet: search,
      searchText: search,
      source,
    };
  }

  const lines = splitLines(content);
  const before = content.slice(0, index);
  const matchStartLine = Math.max(0, before.split(/\r?\n/).length - 1);

  const searchLines = splitLines(search);
  const matchEndLine = Math.min(
    lines.length - 1,
    matchStartLine + Math.max(searchLines.length, 1) - 1,
  );

  const sliceStart = Math.max(0, matchStartLine - contextLines);
  const sliceEnd = Math.min(lines.length, matchEndLine + contextLines + 1);

  return {
    path,
    startLine: sliceStart + 1,
    endLine: sliceEnd,
    matchedSnippet: lines.slice(sliceStart, sliceEnd).join("\n"),
    searchText: search,
    source,
  };
}

/** write 类 mutation：围绕首次 diff 截取 old 侧依据片段。 */
export function buildPrepareEvidenceFromContentChange(input: {
  path: string;
  oldContent: string;
  newContent: string;
  source: "file.mutation.prepare";
}): PrepareEvidence | undefined {
  if (input.oldContent === input.newContent) return undefined;

  const pair = contentSnapshotPair(input.oldContent, input.newContent);
  const snippetLines = splitLines(pair.old.text);
  const startLine = pair.old.startLine ?? 1;
  const endLine = startLine + Math.max(snippetLines.length, 1) - 1;

  return {
    path: input.path,
    startLine,
    endLine,
    matchedSnippet: pair.old.text,
    source: input.source,
  };
}
