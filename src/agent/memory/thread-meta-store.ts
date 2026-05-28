/**
 * Thread 元数据（自定义标题等），与会话记忆文件分离。
 */
import fs from "node:fs";
import path from "node:path";

export type ThreadMetaRecord = {
  threadId: string;
  workspaceId: string;
  customTitle?: string;
  updatedAt: string;
};

const STATE_DIR = ".agent-state";
const STATE_FILE = "thread-meta.json";

const metaByThread = new Map<string, ThreadMetaRecord>();

function storePath(): string {
  return path.join(process.cwd(), STATE_DIR, STATE_FILE);
}

function loadFromDisk(): void {
  try {
    const raw = fs.readFileSync(storePath(), "utf8");
    const parsed = JSON.parse(raw) as ThreadMetaRecord[];
    metaByThread.clear();
    for (const record of parsed) {
      metaByThread.set(record.threadId, record);
    }
  } catch {
    // 首次运行无文件
  }
}

function persistToDisk(): void {
  fs.mkdirSync(path.dirname(storePath()), { recursive: true });
  fs.writeFileSync(
    storePath(),
    JSON.stringify([...metaByThread.values()], null, 2),
    "utf8",
  );
}

loadFromDisk();

export function getThreadMeta(
  threadId: string,
): ThreadMetaRecord | undefined {
  return metaByThread.get(threadId);
}

export function listThreadMetasForWorkspace(
  workspaceId: string,
): ThreadMetaRecord[] {
  return [...metaByThread.values()].filter(
    (record) => record.workspaceId === workspaceId,
  );
}

export function listAllThreadMetas(): ThreadMetaRecord[] {
  return [...metaByThread.values()];
}

export function setThreadCustomTitle(
  threadId: string,
  workspaceId: string,
  customTitle: string,
): ThreadMetaRecord {
  const existing = metaByThread.get(threadId);
  const record: ThreadMetaRecord = {
    threadId,
    workspaceId,
    customTitle: customTitle.trim() || undefined,
    updatedAt: new Date().toISOString(),
  };
  if (existing && !record.customTitle) {
    metaByThread.delete(threadId);
    persistToDisk();
    return { ...existing, customTitle: undefined, updatedAt: record.updatedAt };
  }
  metaByThread.set(threadId, { ...existing, ...record });
  persistToDisk();
  return metaByThread.get(threadId)!;
}

export function deleteThreadMeta(threadId: string): boolean {
  const deleted = metaByThread.delete(threadId);
  if (deleted) persistToDisk();
  return deleted;
}
