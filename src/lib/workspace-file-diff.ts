import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** 工作区单文件：HEAD（或空）vs 当前磁盘，供审查区 Git 模式 diff。 */
export async function readWorkspaceFileDiff(
  rootPath: string,
  relativePath: string,
): Promise<{ before: string; after: string }> {
  const normalized = relativePath.replaceAll("\\", "/").replace(/^\.\/+/, "");
  const fullPath = path.join(rootPath, normalized);

  let before = "";
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["show", `HEAD:${normalized}`],
      { cwd: rootPath, maxBuffer: 8 * 1024 * 1024 },
    );
    before = stdout;
  } catch {
    before = "";
  }

  let after = "";
  try {
    after = await fs.readFile(fullPath, "utf8");
  } catch {
    after = "";
  }

  return { before, after };
}
