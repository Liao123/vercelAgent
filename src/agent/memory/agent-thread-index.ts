/**
 * 从 Trace + ThreadMemory 构建会话（Thread）列表索引。
 */
import type { ThreadMetaRecord } from "@/agent/memory/thread-meta-store";
import type { ThreadMemoryRecord } from "@/agent/memory/thread-memory-store";
import type { TraceRecord } from "@/agent/trace/trace-store";
import type { AgentEvent } from "@/agent/types";

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
      .filter((meta) => meta.workspaceId === input.workspaceId)
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
    if (memory.workspaceId !== input.workspaceId) continue;
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

  const items: AgentThreadListItem[] = [...byThread.entries()].map(
    ([threadId, row]) => {
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
