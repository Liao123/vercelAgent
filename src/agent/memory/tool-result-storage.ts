/**
 * A115：大 tool 结果外置（对标 Claude Code contentReplacement / toolResultStorage）。
 *
 * 超过内联上限的观测写入 `.agent-state/tool-results/*.json`，
 * 模型上下文只保留 stub；需要全文时用 file.read 读 storagePath。
 */
import fs from "node:fs";
import path from "node:path";
import { newId } from "@/agent/types";

const STATE_DIR = ".agent-state";
const TOOL_RESULTS_SUBDIR = "tool-results";
const MAX_RETAINED_FILES = 150;
const PREVIEW_CHARS = 600;

export const TOOL_RESULT_INLINE_MAX = 8_000;
export const FILE_READ_INLINE_MAX = 12_000;

export type ToolResultObservationContext = {
  workspaceRoot: string;
  toolName: string;
  toolCallId?: string;
};

export function isToolResultExternalizeEnabled(): boolean {
  return process.env.AGENT_TOOL_RESULT_EXTERNALIZE !== "0";
}

export function getToolResultStorageRelPath(id: string): string {
  return `${STATE_DIR}/${TOOL_RESULTS_SUBDIR}/${id}.json`.replaceAll("\\", "/");
}

function ensureToolResultsDir(workspaceRoot: string): string {
  const dir = path.join(workspaceRoot, STATE_DIR, TOOL_RESULTS_SUBDIR);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function pruneOldToolResults(dir: string): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => {
      const absolute = path.join(dir, entry.name);
      const stat = fs.statSync(absolute);
      return { absolute, mtimeMs: stat.mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  for (const file of files.slice(MAX_RETAINED_FILES)) {
    try {
      fs.unlinkSync(file.absolute);
    } catch {
      // best-effort prune
    }
  }
}

export function writeExternalizedToolResult(
  ctx: ToolResultObservationContext,
  payload: unknown,
): { storagePath: string; id: string; originalBytes: number } {
  const safeId = (ctx.toolCallId ?? newId("tr")).replace(/[^a-zA-Z0-9_-]/g, "_");
  const relPath = getToolResultStorageRelPath(safeId);
  const dir = ensureToolResultsDir(ctx.workspaceRoot);
  pruneOldToolResults(dir);

  const absolutePath = path.join(ctx.workspaceRoot, relPath);
  const envelope = {
    toolName: ctx.toolName,
    storedAt: new Date().toISOString(),
    payload,
  };
  const serialized = JSON.stringify(envelope, null, 2);
  fs.writeFileSync(absolutePath, serialized, "utf8");

  return {
    storagePath: relPath,
    id: safeId,
    originalBytes: Buffer.byteLength(serialized, "utf8"),
  };
}

export function buildExternalizedStub(input: {
  toolName: string;
  storagePath: string;
  originalBytes: number;
  preview: string;
  fields?: Record<string, unknown>;
}): Record<string, unknown> {
  const preview =
    input.preview.length > PREVIEW_CHARS
      ? `${input.preview.slice(0, PREVIEW_CHARS)}\n...[preview truncated]`
      : input.preview;

  return {
    ...input.fields,
    externalized: true,
    toolName: input.toolName,
    storagePath: input.storagePath,
    originalBytes: input.originalBytes,
    preview,
    note:
      "Full tool result stored on disk. Use file.read on storagePath to load it, or re-call the tool.",
  };
}

export function readExternalizedToolResult(
  workspaceRoot: string,
  storagePath: string,
): unknown {
  const absolute = path.join(workspaceRoot, storagePath);
  const raw = fs.readFileSync(absolute, "utf8");
  const parsed = JSON.parse(raw) as { payload?: unknown };
  return parsed.payload ?? parsed;
}

export function buildPreviewForPayload(payload: unknown): string {
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    if (typeof record.content === "string") {
      return record.content;
    }
    if (typeof record.diff === "string") {
      return record.diff;
    }
    if (typeof record.stdout === "string") {
      return record.stdout;
    }
  }
  try {
    return JSON.stringify(payload, null, 2);
  } catch {
    return String(payload);
  }
}

export function externalizeObservationPayload(
  ctx: ToolResultObservationContext,
  payload: unknown,
  fields?: Record<string, unknown>,
): Record<string, unknown> {
  const stored = writeExternalizedToolResult(ctx, payload);
  return buildExternalizedStub({
    toolName: ctx.toolName,
    storagePath: stored.storagePath,
    originalBytes: stored.originalBytes,
    preview: buildPreviewForPayload(payload),
    fields,
  });
}

export function serializedPayloadBytes(payload: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(payload), "utf8");
  } catch {
    return Buffer.byteLength(String(payload), "utf8");
  }
}
