import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function normalizeRelativePath(relativePath: string): string {
  return relativePath.replaceAll("\\", "/").replace(/^\.\/+/, "");
}

/** 将工作区单文件恢复为 HEAD（未跟踪文件则删除）。 */
export async function revertWorkspaceFile(
  rootPath: string,
  relativePath: string,
): Promise<{ path: string; method: "git_restore" | "delete_untracked" }> {
  const normalized = normalizeRelativePath(relativePath);
  const fullPath = path.join(rootPath, normalized);

  try {
    await execFileAsync(
      "git",
      ["restore", "--source=HEAD", "--staged", "--worktree", "--", normalized],
      { cwd: rootPath, maxBuffer: 8 * 1024 * 1024 },
    );
    return { path: normalized, method: "git_restore" };
  } catch {
    try {
      await fs.unlink(fullPath);
      return { path: normalized, method: "delete_untracked" };
    } catch (error) {
      throw new Error(
        error instanceof Error
          ? error.message
          : `无法撤销 ${normalized} 的更改。`,
      );
    }
  }
}
