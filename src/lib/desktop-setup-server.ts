/**
 * 桌面打包版首次配置：模型 API（.env.local）与工作区路径检测。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { getApiConfig } from "@/lib/openai-config";
import {
  getConfiguredWorkspacePath,
  isWorkspaceDirectory,
} from "@/agent/workspace/workspace-config";

export type DesktopSetupStatus = {
  modelConfigured: boolean;
  envLocalExists: boolean;
  envExampleExists: boolean;
  workspaceConfigured: boolean;
  /** Next standalone 进程 cwd（.env.local 应放于此目录） */
  configDir: string;
  envLocalFile: string;
  envExampleFile: string;
  packaged: boolean;
};

function isPackagedDesktop(): boolean {
  return process.env.VEC_DESKTOP_PACKAGED === "1";
}

export async function getDesktopSetupStatus(): Promise<DesktopSetupStatus> {
  const configDir = process.cwd();
  const envLocalFile = path.join(configDir, ".env.local");
  const envExampleFile = path.join(configDir, ".env.example");

  const [envLocalExists, envExampleExists, workspacePath] = await Promise.all([
    fs
      .access(envLocalFile)
      .then(() => true)
      .catch(() => false),
    fs
      .access(envExampleFile)
      .then(() => true)
      .catch(() => false),
    getConfiguredWorkspacePath(),
  ]);
  const workspaceConfigured = workspacePath
    ? await isWorkspaceDirectory(workspacePath)
    : false;

  return {
    modelConfigured: getApiConfig() !== null,
    envLocalExists,
    envExampleExists,
    workspaceConfigured,
    configDir,
    envLocalFile,
    envExampleFile,
    packaged: isPackagedDesktop(),
  };
}

export async function seedDesktopEnvLocalFromExample(): Promise<{
  created: boolean;
  path: string;
}> {
  const configDir = process.cwd();
  const envLocalFile = path.join(configDir, ".env.local");
  const envExampleFile = path.join(configDir, ".env.example");

  try {
    await fs.access(envLocalFile);
    return { created: false, path: envLocalFile };
  } catch {
    // continue
  }

  const example = await fs.readFile(envExampleFile, "utf8");
  await fs.writeFile(envLocalFile, example, "utf8");
  return { created: true, path: envLocalFile };
}
