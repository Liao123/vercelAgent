/**
 * Workspace Manager 雏形。
 *
 * 当前默认使用 Next.js 进程 cwd 作为 workspace。后续接本地 agent-server 或 Electron
 * 后，再改成用户显式选择项目目录。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { getGitRoot, getGitStatus } from "@/agent/tools/git-tools";
import { readProjectRules, type ProjectRuleFile } from "@/agent/tools/project-rules";
import { getConfiguredWorkspacePath } from "@/agent/workspace/workspace-config";

export type PackageManager = "npm" | "pnpm" | "yarn" | "bun" | "unknown";

export type WorkspaceInfo = {
  id: string;
  rootPath: string;
  gitRootPath: string | null;
  packageManager: PackageManager;
  framework: string | null;
  packageName: string | null;
  rules: ProjectRuleFile[];
  gitStatus: string;
};

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readPackageJson(rootPath: string): Promise<{
  name: string | null;
  dependencies: Record<string, string>;
}> {
  try {
    const raw = await fs.readFile(path.join(rootPath, "package.json"), "utf8");
    const parsed = JSON.parse(raw) as {
      name?: string;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    return {
      name: parsed.name ?? null,
      dependencies: {
        ...(parsed.dependencies ?? {}),
        ...(parsed.devDependencies ?? {}),
      },
    };
  } catch {
    return { name: null, dependencies: {} };
  }
}

async function detectPackageManager(rootPath: string): Promise<PackageManager> {
  if (await fileExists(path.join(rootPath, "pnpm-lock.yaml"))) return "pnpm";
  if (await fileExists(path.join(rootPath, "yarn.lock"))) return "yarn";
  if (await fileExists(path.join(rootPath, "bun.lockb"))) return "bun";
  if (await fileExists(path.join(rootPath, "package-lock.json"))) return "npm";
  return "unknown";
}

function detectFramework(dependencies: Record<string, string>): string | null {
  if ("next" in dependencies) return "Next.js";
  if ("vite" in dependencies) return "Vite";
  if ("react" in dependencies) return "React";
  if ("vue" in dependencies) return "Vue";
  if ("svelte" in dependencies) return "Svelte";
  return null;
}

export async function getCurrentWorkspace(): Promise<WorkspaceInfo> {
  const rootPath = (await getConfiguredWorkspacePath()) ?? process.cwd();
  const [packageManager, packageInfo, rules, gitRootPath, gitStatus] =
    await Promise.all([
      detectPackageManager(rootPath),
      readPackageJson(rootPath),
      readProjectRules(rootPath),
      getGitRoot(rootPath),
      getGitStatus(rootPath),
    ]);

  return {
    id: rootPath,
    rootPath,
    gitRootPath,
    packageManager,
    framework: detectFramework(packageInfo.dependencies),
    packageName: packageInfo.name,
    rules,
    gitStatus: gitStatus.stdout,
  };
}
