/** 工作区文件树：路径规范化与展开祖先目录。 */

export function normalizeTreePath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\/+/, "");
}

export function treePathsEqual(a: string, b: string): boolean {
  return normalizeTreePath(a) === normalizeTreePath(b);
}

/** 展开文件前需加载的目录（含 `.` 根）。 */
export function ancestorDirsForFile(filePath: string): string[] {
  const normalized = normalizeTreePath(filePath);
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length <= 1) return ["."];

  parts.pop();
  const dirs: string[] = ["."];
  let acc = "";
  for (const part of parts) {
    acc = acc ? `${acc}/${part}` : part;
    dirs.push(acc);
  }
  return dirs;
}
