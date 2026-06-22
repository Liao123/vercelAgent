/**
 * 将 Workspace 元数据格式化为 Loop 提示词块（零成本注入，不绑具体问法）。
 */
import type { PackageManager, WorkspaceInfo } from "@/agent/workspace/workspace-manager";
import { formatMetadataCatalogHints } from "@/agent/workspace/framework-metadata-catalog";
import { formatRuntimeFactsForPrompt } from "@/agent/workspace/runtime-facts-prompt";

export type WorkspaceSnapshotInput = Pick<
  WorkspaceInfo,
  "rootPath" | "gitRootPath" | "framework" | "packageName" | "packageManager"
>;

export function workspaceToSnapshotInput(
  workspace: WorkspaceInfo,
): WorkspaceSnapshotInput {
  return {
    rootPath: workspace.rootPath,
    gitRootPath: workspace.gitRootPath,
    framework: workspace.framework,
    packageName: workspace.packageName,
    packageManager: workspace.packageManager,
  };
}

export function formatWorkspaceSnapshotForPrompt(
  snapshot: WorkspaceSnapshotInput,
): string {
  const lines = [
    "[WORKSPACE_SNAPSHOT — runtime facts; NOT proof for edits; still file.read before factual final]",
    `Root: ${snapshot.rootPath}`,
  ];
  if (snapshot.gitRootPath) {
    lines.push(`Git root: ${snapshot.gitRootPath}`);
  }
  if (snapshot.framework) {
    lines.push(`Detected framework: ${snapshot.framework}`);
  }
  if (snapshot.packageName) {
    lines.push(`Package name: ${snapshot.packageName}`);
  }
  if (snapshot.packageManager && snapshot.packageManager !== "unknown") {
    lines.push(`Package manager: ${snapshot.packageManager}`);
  }
  lines.push(formatMetadataCatalogHints(snapshot.framework));
  lines.push(formatRuntimeFactsForPrompt());
  lines.push(
    "Use framework + repo layout in your plan to choose metadata files — do NOT call workspace.inspect only to learn this snapshot.",
  );
  return lines.join("\n");
}
