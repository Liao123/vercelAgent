import fs from "node:fs";
import path from "node:path";

/** 跨会话用户偏好上限（对齐 Claude Code MEMORY.md） */
export const WORKSPACE_MEMORY_MAX_BYTES = 25 * 1024;

export const WORKSPACE_MEMORY_REL_PATH = ".agent-state/MEMORY.md";

export function loadWorkspaceMemory(workspaceRoot: string): string | null {
  const filePath = path.join(workspaceRoot, WORKSPACE_MEMORY_REL_PATH);
  try {
    const raw = fs.readFileSync(filePath, "utf8").trim();
    if (!raw) return null;
    if (Buffer.byteLength(raw, "utf8") <= WORKSPACE_MEMORY_MAX_BYTES) {
      return raw;
    }
    const truncated = Buffer.from(raw, "utf8")
      .subarray(0, WORKSPACE_MEMORY_MAX_BYTES)
      .toString("utf8")
      .trimEnd();
    return `${truncated}\n...[MEMORY truncated at ${WORKSPACE_MEMORY_MAX_BYTES} bytes]`;
  } catch {
    return null;
  }
}

export function formatWorkspaceMemoryBlock(content: string): string {
  return [
    "",
    "## Workspace memory (cross-session user preferences)",
    "Follow these preferences unless the current user message explicitly overrides them.",
    content,
  ].join("\n");
}
