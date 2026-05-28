/**
 * Thread 级滚动任务记忆（跨 Task 持久化，对齐 Codex session memory）。
 *
 * 存储在 `.agent-state/thread-memory.json`，与 Trace 事件中的 memoryContent 互为备份。
 */
import fs from "node:fs";
import path from "node:path";

export type ThreadMemoryRecord = {
  threadId: string;
  workspaceId: string;
  summaryId: string;
  memoryContent: string;
  round: number;
  method: "deterministic" | "semantic";
  updatedAt: string;
  lastTaskId: string;
  lastUserRequest?: string;
  /** 列表展示用标题（通常为首条或最近 userRequest） */
  title?: string;
  /** 列表展示用记忆摘要 */
  summaryPreview?: string;
};

const STATE_DIR = ".agent-state";
const STATE_FILE = "thread-memory.json";

const memoryByThread = new Map<string, ThreadMemoryRecord>();

function storePath(): string {
  return path.join(process.cwd(), STATE_DIR, STATE_FILE);
}

function loadFromDisk(): void {
  try {
    const raw = fs.readFileSync(storePath(), "utf8");
    const parsed = JSON.parse(raw) as ThreadMemoryRecord[];
    memoryByThread.clear();
    for (const record of parsed) {
      memoryByThread.set(record.threadId, record);
    }
  } catch {
    // 首次运行无文件
  }
}

function persistToDisk(): void {
  fs.mkdirSync(path.dirname(storePath()), { recursive: true });
  fs.writeFileSync(
    storePath(),
    JSON.stringify([...memoryByThread.values()], null, 2),
    "utf8",
  );
}

loadFromDisk();

export function saveThreadMemory(record: ThreadMemoryRecord): void {
  memoryByThread.set(record.threadId, record);
  persistToDisk();
}

export function getThreadMemory(
  threadId: string,
): ThreadMemoryRecord | undefined {
  return memoryByThread.get(threadId);
}

export function getLatestThreadMemoryForWorkspace(
  workspaceId: string,
): ThreadMemoryRecord | undefined {
  const records = [...memoryByThread.values()].filter(
    (record) => record.workspaceId === workspaceId,
  );
  if (records.length === 0) return undefined;
  return records.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
}

export function listThreadMemoriesForWorkspace(
  workspaceId: string,
): ThreadMemoryRecord[] {
  return [...memoryByThread.values()]
    .filter((record) => record.workspaceId === workspaceId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function listAllThreadMemories(): ThreadMemoryRecord[] {
  return [...memoryByThread.values()].sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt),
  );
}

export function deleteThreadMemory(threadId: string): boolean {
  const deleted = memoryByThread.delete(threadId);
  if (deleted) persistToDisk();
  return deleted;
}

export function updateThreadMemoryTitle(
  threadId: string,
  title: string,
): ThreadMemoryRecord | undefined {
  const record = memoryByThread.get(threadId);
  if (!record) return undefined;
  const next = { ...record, title: title.trim(), updatedAt: new Date().toISOString() };
  memoryByThread.set(threadId, next);
  persistToDisk();
  return next;
}

/** 注入 Loop messages：上一轮 Thread 滚动记忆 */
export function buildThreadMemoryInjectionMessage(
  memoryContent: string,
): { role: "user"; content: string } {
  return {
    role: "user",
    content: [
      memoryContent,
      "",
      "---",
      "Rolling thread memory from earlier tasks in this thread (authoritative for paths, approval IDs, errors).",
      "The user's CURRENT request is in the next user message.",
      "Do not repeat completed work unless the new request asks for it.",
    ].join("\n"),
  };
}
