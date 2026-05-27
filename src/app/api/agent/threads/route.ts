/**
 * Agent Thread（会话）API：列表、重命名、删除滚动记忆。
 */
import { buildAgentThreadList } from "@/agent/memory/agent-thread-index";
import {
  deleteThreadMemory,
  getThreadMemory,
  listThreadMemoriesForWorkspace,
  updateThreadMemoryTitle,
} from "@/agent/memory/thread-memory-store";
import {
  getThreadMeta,
  listThreadMetasForWorkspace,
  setThreadCustomTitle,
} from "@/agent/memory/thread-meta-store";
import { listTraces, updateTraceThread } from "@/agent/trace/trace-store";
import { getCurrentWorkspace } from "@/agent/workspace";

export const dynamic = "force-dynamic";

async function listThreadsForWorkspace(workspaceId: string) {
  const traces = await listTraces();
  const memories = listThreadMemoriesForWorkspace(workspaceId);
  const metas = listThreadMetasForWorkspace(workspaceId);
  return buildAgentThreadList({
    workspaceId,
    traces,
    memories,
    metas,
  });
}

export async function GET() {
  try {
    const workspace = await getCurrentWorkspace();
    const threads = await listThreadsForWorkspace(workspace.id);
    return Response.json({ workspaceId: workspace.id, threads });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to list threads.",
      },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request) {
  let body: { threadId?: string; title?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  const threadId = body.threadId?.trim();
  const title = body.title?.trim();
  if (!threadId || !title) {
    return Response.json(
      { error: "threadId and title are required." },
      { status: 400 },
    );
  }

  try {
    const workspace = await getCurrentWorkspace();
    const memory = getThreadMemory(threadId);
    if (memory && memory.workspaceId !== workspace.id) {
      return Response.json({ error: "Thread not in workspace." }, { status: 403 });
    }

    const meta = setThreadCustomTitle(threadId, workspace.id, title);
    updateThreadMemoryTitle(threadId, title);

    for (const trace of await listTraces()) {
      if (trace.thread?.id === threadId) {
        updateTraceThread(trace.id, { title });
      }
    }

    const threads = await listThreadsForWorkspace(workspace.id);
    const thread = threads.find((item) => item.threadId === threadId);

    return Response.json({
      ok: true,
      meta,
      thread,
    });
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Failed to rename thread.",
      },
      { status: 500 },
    );
  }
}

export async function DELETE(request: Request) {
  const threadId = new URL(request.url).searchParams.get("threadId")?.trim();
  if (!threadId) {
    return Response.json({ error: "threadId is required." }, { status: 400 });
  }

  try {
    const workspace = await getCurrentWorkspace();
    const memory = getThreadMemory(threadId);
    const meta = getThreadMeta(threadId);

    if (memory && memory.workspaceId !== workspace.id) {
      return Response.json({ error: "Thread not in workspace." }, { status: 403 });
    }
    if (meta && meta.workspaceId !== workspace.id) {
      return Response.json({ error: "Thread not in workspace." }, { status: 403 });
    }

    const memoryDeleted = deleteThreadMemory(threadId);

    for (const trace of await listTraces()) {
      if (trace.thread?.id === threadId) {
        updateTraceThread(trace.id, { contextSummary: undefined });
      }
    }

    return Response.json({
      ok: true,
      memoryDeleted,
      note: "Custom title preserved. Traces unchanged.",
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to delete thread memory.",
      },
      { status: 500 },
    );
  }
}
