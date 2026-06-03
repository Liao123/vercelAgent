import path from "node:path";

/** 侧栏项目去重键：同一路径只对应一个项目（对齐 Cursor/Codex 打开文件夹）。 */
export function normalizeWorkspaceKey(workspaceId: string): string {
  const resolved = path.resolve(workspaceId.trim());
  if (process.platform === "win32") {
    return resolved.toLowerCase();
  }
  return resolved;
}

export function workspaceIdsEqual(a: string, b: string): boolean {
  return normalizeWorkspaceKey(a) === normalizeWorkspaceKey(b);
}
