/**
 * Workspace 路径安全工具。
 *
 * 所有本地文件工具都必须先经过这里解析路径，防止工具访问 workspace 外部文件。
 */
import path from "node:path";

export function toWorkspaceRelative(rootPath: string, targetPath: string): string {
  return path.relative(rootPath, targetPath).replaceAll(path.sep, "/");
}

export function resolveInsideWorkspace(
  rootPath: string,
  inputPath = ".",
): string {
  const root = path.resolve(rootPath);
  const target = path.resolve(root, inputPath);
  const rootKey = process.platform === "win32" ? root.toLowerCase() : root;
  const targetKey =
    process.platform === "win32" ? target.toLowerCase() : target;

  if (targetKey !== rootKey && !targetKey.startsWith(`${rootKey}${path.sep}`)) {
    throw new Error(`Path is outside workspace: ${inputPath}`);
  }

  return target;
}
