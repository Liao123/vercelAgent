import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function expandTilde(input: string): string {
  if (input === "~") return os.homedir();
  if (input.startsWith("~/") || input.startsWith("~\\")) {
    return path.join(os.homedir(), input.slice(2));
  }
  return input;
}

function expandEnvVars(input: string): string {
  return input.replace(/%([^%]+)%/g, (_, name: string) => process.env[name] ?? `%${name}%`);
}

function firstExistingDir(candidates: Array<string | null | undefined>): string | null {
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
        return candidate;
      }
    } catch {
      // ignore permission errors
    }
  }
  return null;
}

/** 解析当前运行环境用户桌面目录（跨平台、多语言文件夹名）。 */
export function resolveUserDesktopDir(): string {
  const home = os.homedir();
  const profile = process.env.USERPROFILE?.trim();

  const xdg = process.env.XDG_DESKTOP_DIR?.trim();
  if (xdg) {
    const resolved = path.resolve(expandTilde(expandEnvVars(xdg)));
    if (fs.existsSync(resolved)) return resolved;
  }

  const found = firstExistingDir([
    profile ? path.join(profile, "Desktop") : null,
    profile ? path.join(profile, "桌面") : null,
    path.join(home, "Desktop"),
    path.join(home, "桌面"),
    profile ? path.join(profile, "OneDrive", "Desktop") : null,
    path.join(home, "OneDrive", "Desktop"),
  ]);
  if (found) return found;

  return path.join(home, "Desktop");
}

/**
 * 将用户/模型给出的保存路径规范化为绝对路径。
 * 支持：`~/Desktop/a.png`、`desktop:shot.png`、`%USERPROFILE%\\Desktop\\a.png`、绝对路径。
 */
export function resolveUserSavePath(input: string, cwd = process.cwd()): string {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("filePath is empty.");
  }

  if (/^desktop[:/\\]/i.test(trimmed)) {
    const rest = trimmed.replace(/^desktop[:/\\]/i, "");
    return path.resolve(resolveUserDesktopDir(), rest);
  }

  let expanded = expandEnvVars(expandTilde(trimmed));
  if (!path.isAbsolute(expanded)) {
    expanded = path.resolve(cwd, expanded);
  }
  return path.resolve(expanded);
}

/** 若参数含 filePath，原地替换为解析后的绝对路径（MCP / 内置工具共用）。 */
export function resolveFilePathArg(
  args: Record<string, unknown>,
  cwd = process.cwd(),
): Record<string, unknown> {
  const filePath = args.filePath;
  if (typeof filePath !== "string" || !filePath.trim()) return args;
  return {
    ...args,
    filePath: resolveUserSavePath(filePath, cwd),
  };
}
