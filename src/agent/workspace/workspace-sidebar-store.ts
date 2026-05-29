/**
 * 左侧项目列表展示偏好（隐藏分组，不删磁盘项目）。
 */
import fs from "node:fs";
import path from "node:path";

const STATE_DIR = ".agent-state";
const STATE_FILE = "workspace-sidebar.json";

type WorkspaceSidebarState = {
  hiddenWorkspaceIds: string[];
  updatedAt: string;
};

let hiddenWorkspaceIds = new Set<string>();

function storePath(): string {
  return path.join(process.cwd(), STATE_DIR, STATE_FILE);
}

function loadFromDisk(): void {
  try {
    const raw = fs.readFileSync(storePath(), "utf8");
    const parsed = JSON.parse(raw) as WorkspaceSidebarState;
    hiddenWorkspaceIds = new Set(parsed.hiddenWorkspaceIds ?? []);
  } catch {
    hiddenWorkspaceIds = new Set();
  }
}

function persistToDisk(): void {
  const state: WorkspaceSidebarState = {
    hiddenWorkspaceIds: [...hiddenWorkspaceIds],
    updatedAt: new Date().toISOString(),
  };
  fs.mkdirSync(path.dirname(storePath()), { recursive: true });
  fs.writeFileSync(storePath(), JSON.stringify(state, null, 2), "utf8");
}

loadFromDisk();

export function listHiddenWorkspaceIds(): string[] {
  return [...hiddenWorkspaceIds];
}

export function isWorkspaceHiddenInSidebar(workspaceId: string): boolean {
  return hiddenWorkspaceIds.has(workspaceId);
}

export function hideWorkspaceInSidebar(workspaceId: string): boolean {
  if (hiddenWorkspaceIds.has(workspaceId)) return false;
  hiddenWorkspaceIds.add(workspaceId);
  persistToDisk();
  return true;
}

export function showWorkspaceInSidebar(workspaceId: string): boolean {
  const deleted = hiddenWorkspaceIds.delete(workspaceId);
  if (deleted) persistToDisk();
  return deleted;
}
