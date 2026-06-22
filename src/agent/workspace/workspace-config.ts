/**
 * Workspace 配置。
 *
 * Web 阶段先用本地 JSON 文件保存当前 workspace 路径。
 * Electron 阶段再换成系统目录选择器。
 */
import fs from "node:fs/promises";
import path from "node:path";

const CONFIG_DIR = ".agent-state";
const CONFIG_FILE = "workspace.json";

export type WorkspaceConfig = {
  rootPath: string;
  updatedAt: string;
};

export type ResolvedWorkspaceRoot = {
  /** 实际用于读盘/跑命令的根目录 */
  rootPath: string;
  /** workspace.json 里记录的路径（可能已失效） */
  configuredPath: string | null;
  /** 配置存在但目录已不存在时为该路径，否则 null */
  staleConfiguredPath: string | null;
};

function configPath(): string {
  return path.join(process.cwd(), CONFIG_DIR, CONFIG_FILE);
}

export async function isWorkspaceDirectory(rootPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(rootPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

/**
 * 解析当前 workspace 根目录：配置路径失效时回退 process.cwd()，避免 ENOENT 打穿 API。
 */
export async function resolveWorkspaceRootPath(): Promise<ResolvedWorkspaceRoot> {
  const configuredPath = await getConfiguredWorkspacePath();
  if (!configuredPath) {
    return {
      rootPath: process.cwd(),
      configuredPath: null,
      staleConfiguredPath: null,
    };
  }
  if (await isWorkspaceDirectory(configuredPath)) {
    return {
      rootPath: configuredPath,
      configuredPath,
      staleConfiguredPath: null,
    };
  }
  return {
    rootPath: process.cwd(),
    configuredPath,
    staleConfiguredPath: configuredPath,
  };
}

export async function clearConfiguredWorkspacePath(): Promise<void> {
  try {
    await fs.unlink(configPath());
  } catch {
    // missing config is fine
  }
}

export async function getConfiguredWorkspacePath(): Promise<string | null> {
  try {
    const raw = await fs.readFile(configPath(), "utf8");
    const config = JSON.parse(raw) as WorkspaceConfig;
    return config.rootPath || null;
  } catch {
    return null;
  }
}

export async function setConfiguredWorkspacePath(
  rootPath: string,
): Promise<WorkspaceConfig> {
  const resolved = path.resolve(rootPath);
  const stat = await fs.stat(resolved);
  if (!stat.isDirectory()) {
    throw new Error(`Workspace path is not a directory: ${rootPath}`);
  }

  const config: WorkspaceConfig = {
    rootPath: resolved,
    updatedAt: new Date().toISOString(),
  };
  await fs.mkdir(path.dirname(configPath()), { recursive: true });
  await fs.writeFile(configPath(), JSON.stringify(config, null, 2), "utf8");
  return config;
}
