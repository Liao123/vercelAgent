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

function configPath(): string {
  return path.join(process.cwd(), CONFIG_DIR, CONFIG_FILE);
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
