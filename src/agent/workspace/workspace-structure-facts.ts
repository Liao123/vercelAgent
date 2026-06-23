/**
 * 工作区结构事实（只观测、不 prescribe 下一步）。
 * 供推理轮 / workspace.inspect / 系统提示注入，由模型推导计划。
 */
import fs from "node:fs/promises";
import path from "node:path";
import type { WorkspaceInfo } from "@/agent/workspace/workspace-manager";

export type WorkspaceStructureFacts = {
  rootPath: string;
  staleConfiguredPath: string | null;
  hasPackageJson: boolean;
  hasSrcApp: boolean;
  hasAppDir: boolean;
  hasPagesDir: boolean;
  topLevelEntryCount: number;
  topLevelEntries: string[];
  observations: string[];
};

async function isDirectory(dirPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(dirPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function listTopLevelEntries(rootPath: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(rootPath);
    return entries.slice(0, 24);
  } catch {
    return [];
  }
}

function buildObservations(input: {
  hasPackageJson: boolean;
  hasSrcApp: boolean;
  hasAppDir: boolean;
  hasPagesDir: boolean;
  staleConfiguredPath: string | null;
  topLevelEntryCount: number;
}): string[] {
  const observations: string[] = [];
  if (input.staleConfiguredPath) {
    observations.push(
      `workspace.json points to missing path: ${input.staleConfiguredPath}`,
    );
  }
  if (!input.hasPackageJson) {
    observations.push("no package.json at workspace root");
  }
  if (!input.hasSrcApp && !input.hasAppDir && !input.hasPagesDir) {
    observations.push("no common web app entry dirs (src/app, app, pages)");
  }
  if (input.topLevelEntryCount === 0) {
    observations.push("workspace root appears empty");
  }
  return observations;
}

export async function collectWorkspaceStructureFacts(
  workspace: WorkspaceInfo,
): Promise<WorkspaceStructureFacts> {
  const root = workspace.rootPath;
  const [hasPackageJson, hasSrcApp, hasAppDir, hasPagesDir, topLevelEntries] =
    await Promise.all([
      fileExists(path.join(root, "package.json")),
      isDirectory(path.join(root, "src", "app")),
      isDirectory(path.join(root, "app")),
      isDirectory(path.join(root, "pages")),
      listTopLevelEntries(root),
    ]);

  const observations = buildObservations({
    hasPackageJson,
    hasSrcApp,
    hasAppDir,
    hasPagesDir,
    staleConfiguredPath: workspace.staleConfiguredPath,
    topLevelEntryCount: topLevelEntries.length,
  });

  return {
    rootPath: root,
    staleConfiguredPath: workspace.staleConfiguredPath,
    hasPackageJson,
    hasSrcApp,
    hasAppDir,
    hasPagesDir,
    topLevelEntryCount: topLevelEntries.length,
    topLevelEntries,
    observations,
  };
}

export function formatWorkspaceStructureFactsForPrompt(
  facts: WorkspaceStructureFacts,
): string {
  const lines = [
    "[WORKSPACE_STRUCTURE — disk facts only; derive prerequisites from user intent + these facts; do NOT assume fixed paths exist]",
    `Root: ${facts.rootPath}`,
    `package.json: ${facts.hasPackageJson ? "yes" : "no"}`,
    `src/app: ${facts.hasSrcApp ? "yes" : "no"}`,
    `app/: ${facts.hasAppDir ? "yes" : "no"}`,
    `pages/: ${facts.hasPagesDir ? "yes" : "no"}`,
  ];
  if (facts.staleConfiguredPath) {
    lines.push(`stale configured path: ${facts.staleConfiguredPath}`);
  }
  if (facts.topLevelEntries.length > 0) {
    lines.push(`top-level: ${facts.topLevelEntries.join(", ")}`);
  }
  if (facts.observations.length > 0) {
    lines.push(`observations: ${facts.observations.join("; ")}`);
  }
  lines.push(
    "If user wants to write into this workspace but structure is missing, plan prerequisite steps (scaffold, init, or create files) before UI replication — choose stack from context, not a fixed recipe.",
  );
  return lines.join("\n");
}
