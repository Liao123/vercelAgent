/**
 * 从 Trace + ThreadMemory 构建会话（Thread）列表索引。
 */
import type { ThreadMetaRecord } from "@/agent/memory/thread-meta-store";
import type { ThreadMemoryRecord } from "@/agent/memory/thread-memory-store";
import type { TraceRecord } from "@/agent/trace/trace-store";
import type { AgentEvent } from "@/agent/types";
import {
  normalizeWorkspaceKey,
  workspaceIdsEqual,
} from "@/lib/workspace-path";

export type AgentThreadListItem = {
  threadId: string;
  workspaceId: string;
  title: string;
  summaryPreview: string | null;
  updatedAt: string;
  round: number | null;
  method: "deterministic" | "semantic" | null;
  lastTaskId: string | null;
  lastUserRequest: string | null;
  traceCount: number;
  hasMemory: boolean;
};

export function resolveThreadIdFromTrace(trace: TraceRecord): string | null {
  if (trace.thread?.id) return trace.thread.id;
  for (const event of trace.events) {
    if (event.type === "thread.created") return event.threadId;
    if (event.type === "context.compacted" && event.threadId) {
      return event.threadId;
    }
  }
  return null;
}

function resolveSummaryPreviewFromEvents(events: AgentEvent[]): string | null {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (event.type === "context.compacted") {
      return event.summaryPreview ?? event.memoryContent?.slice(0, 280) ?? null;
    }
  }
  return null;
}

function truncateTitle(text: string): string {
  return text.length > 56 ? `${text.slice(0, 56)}…` : text;
}

function resolveThreadTitle(
  customTitle: string | null | undefined,
  memoryTitle: string | null | undefined,
  lastUserRequest: string | null,
  threadTitle: string | null,
  threadId: string,
): string {
  const custom = customTitle?.trim();
  if (custom) return truncateTitle(custom);
  const saved = memoryTitle?.trim();
  if (saved) return truncateTitle(saved);
  const request = lastUserRequest?.trim();
  if (request) return truncateTitle(request);
  const title = threadTitle?.trim();
  if (title) return truncateTitle(title);
  return `会话 ${threadId.slice(0, 10)}`;
}

export function buildAgentThreadList(input: {
  workspaceId: string;
  traces: TraceRecord[];
  memories: ThreadMemoryRecord[];
  metas?: ThreadMetaRecord[];
}): AgentThreadListItem[] {
  const metaById = new Map(
    (input.metas ?? [])
      .filter((meta) => workspaceIdsEqual(meta.workspaceId, input.workspaceId))
      .map((meta) => [meta.threadId, meta]),
  );
  const byThread = new Map<
    string,
    {
      workspaceId: string;
      title: string | null;
      contextSummary: string | null;
      updatedAt: string;
      lastUserRequest: string | null;
      lastTaskId: string | null;
      traceCount: number;
      memory: ThreadMemoryRecord | null;
      eventSummary: string | null;
    }
  >();

  for (const memory of input.memories) {
    if (!workspaceIdsEqual(memory.workspaceId, input.workspaceId)) continue;
    byThread.set(memory.threadId, {
      workspaceId: memory.workspaceId,
      title: null,
      contextSummary: memory.memoryContent.slice(0, 400),
      updatedAt: memory.updatedAt,
      lastUserRequest: memory.lastUserRequest ?? null,
      lastTaskId: memory.lastTaskId,
      traceCount: 0,
      memory,
      eventSummary: memory.summaryPreview ?? memory.memoryContent.slice(0, 280),
    });
  }

  for (const trace of input.traces) {
    const threadId = resolveThreadIdFromTrace(trace);
    if (!threadId) continue;

    const existing = byThread.get(threadId);
    const traceUpdated = trace.updatedAt;
    const request = trace.task?.userRequest ?? null;
    const eventSummary = resolveSummaryPreviewFromEvents(trace.events);

    if (!existing) {
      byThread.set(threadId, {
        workspaceId: input.workspaceId,
        title: trace.thread?.title ?? null,
        contextSummary: trace.thread?.contextSummary ?? null,
        updatedAt: traceUpdated,
        lastUserRequest: request,
        lastTaskId: trace.task?.id ?? null,
        traceCount: 1,
        memory: null,
        eventSummary,
      });
      continue;
    }

    existing.traceCount += 1;
    if (traceUpdated > existing.updatedAt) {
      existing.updatedAt = traceUpdated;
      if (request) existing.lastUserRequest = request;
      if (trace.task?.id) existing.lastTaskId = trace.task.id;
      if (eventSummary) existing.eventSummary = eventSummary;
    }
    if (!existing.title && trace.thread?.title) {
      existing.title = trace.thread.title;
    }
    if (!existing.contextSummary && trace.thread?.contextSummary) {
      existing.contextSummary = trace.thread.contextSummary;
    }
  }

  const items: AgentThreadListItem[] = [...byThread.entries()]
    .filter(([threadId]) => !metaById.get(threadId)?.hidden)
    .map(([threadId, row]) => {
      const memory = row.memory;
      const summaryPreview =
        memory?.summaryPreview ??
        row.eventSummary ??
        row.contextSummary ??
        null;

      const meta = metaById.get(threadId);
      return {
        threadId,
        workspaceId: row.workspaceId,
        title: resolveThreadTitle(
          meta?.customTitle,
          memory?.title,
          memory?.lastUserRequest ?? row.lastUserRequest,
          row.title,
          threadId,
        ),
        summaryPreview,
        updatedAt: row.updatedAt,
        round: memory?.round ?? null,
        method: memory?.method ?? null,
        lastTaskId: memory?.lastTaskId ?? row.lastTaskId,
        lastUserRequest: memory?.lastUserRequest ?? row.lastUserRequest,
        traceCount: row.traceCount,
        hasMemory: Boolean(memory?.memoryContent),
      };
    },
  );

  return items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function filterTracesByThreadId(
  traces: TraceRecord[],
  threadId: string | null,
): TraceRecord[] {
  if (!threadId) return traces;
  return traces.filter((trace) => resolveThreadIdFromTrace(trace) === threadId);
}

export type AgentProjectSidebarItem = {
  workspaceId: string;
  name: string;
  updatedAt: string;
  threadCount: number;
  threads: AgentThreadListItem[];
};

const DEFAULT_RECENT_THREADS_PER_PROJECT = 5;

function workspaceDisplayName(workspaceId: string): string {
  const normalized = workspaceId.replace(/\\/g, "/").replace(/\/+$/, "");
  const base = normalized.split("/").pop();
  return base && base.length > 0 ? base : workspaceId;
}

function collectWorkspaceIds(input: {
  traces: TraceRecord[];
  memories: ThreadMemoryRecord[];
  metas: ThreadMetaRecord[];
}): string[] {
  const ids = new Set<string>();
  for (const memory of input.memories) {
    ids.add(memory.workspaceId);
  }
  for (const meta of input.metas) {
    ids.add(meta.workspaceId);
  }
  for (const trace of input.traces) {
    const workspaceId = trace.task?.workspaceId;
    if (workspaceId) ids.add(workspaceId);
  }
  return [...ids];
}

function workspaceKeysFromInput(input: {
  traces: TraceRecord[];
  memories: ThreadMemoryRecord[];
  metas: ThreadMetaRecord[];
  currentWorkspaceId?: string | null;
}): Map<string, string> {
  const canonicalByKey = new Map<string, string>();

  const register = (workspaceId: string) => {
    const key = normalizeWorkspaceKey(workspaceId);
    if (!canonicalByKey.has(key)) {
      canonicalByKey.set(key, workspaceId);
    }
  };

  for (const memory of input.memories) register(memory.workspaceId);
  for (const meta of input.metas) register(meta.workspaceId);
  for (const trace of input.traces) {
    const workspaceId = trace.task?.workspaceId;
    if (workspaceId) register(workspaceId);
  }
  if (input.currentWorkspaceId?.trim()) {
    const key = normalizeWorkspaceKey(input.currentWorkspaceId);
    canonicalByKey.set(key, input.currentWorkspaceId);
  }

  return canonicalByKey;
}

function belongsToWorkspaceKey(
  workspaceId: string,
  key: string,
): boolean {
  return normalizeWorkspaceKey(workspaceId) === key;
}

export function buildAgentProjectSidebar(input: {
  traces: TraceRecord[];
  memories: ThreadMemoryRecord[];
  metas: ThreadMetaRecord[];
  recentThreadsPerProject?: number;
  /** 当前打开的工作区：无会话时也显示在侧栏（对齐 Cursor 当前文件夹） */
  currentWorkspaceId?: string | null;
}): AgentProjectSidebarItem[] {
  const limit = input.recentThreadsPerProject ?? DEFAULT_RECENT_THREADS_PER_PROJECT;
  const canonicalByKey = workspaceKeysFromInput(input);

  const projects = [...canonicalByKey.entries()].map(([key, workspaceId]) => {
    const traces = input.traces.filter(
      (trace) =>
        trace.task?.workspaceId &&
        belongsToWorkspaceKey(trace.task.workspaceId, key),
    );
    const threads = buildAgentThreadList({
      workspaceId,
      traces,
      memories: input.memories.filter((memory) =>
        belongsToWorkspaceKey(memory.workspaceId, key),
      ),
      metas: input.metas.filter((meta) =>
        belongsToWorkspaceKey(meta.workspaceId, key),
      ),
    });
    const recentThreads = threads.slice(0, limit);
    const updatedAt =
      threads[0]?.updatedAt ??
      traces[0]?.updatedAt ??
      new Date(0).toISOString();

    return {
      workspaceId,
      name: workspaceDisplayName(workspaceId),
      updatedAt,
      threadCount: threads.length,
      threads: recentThreads,
    };
  });

  return projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
