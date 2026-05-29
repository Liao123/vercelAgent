/**
 * Agent Thread（会话）API：列表、重命名、删除滚动记忆。
 */
import {
  buildAgentProjectSidebar,
  buildAgentThreadList,
} from "@/agent/memory/agent-thread-index";
import {
  deleteThreadMemory,
  getThreadMemory,
  listAllThreadMemories,
  listThreadMemoriesForWorkspace,
  updateThreadMemoryTitle,
} from "@/agent/memory/thread-memory-store";
import {
  getThreadMeta,
  hideThreadInSidebar,
  listAllThreadMetas,
  listThreadMetasForWorkspace,
  setThreadCustomTitle,
} from "@/agent/memory/thread-meta-store";
import { listTraces, updateTraceThread } from "@/agent/trace/trace-store";
import { resolveThreadIdFromTrace } from "@/agent/memory/agent-thread-index";
import { listHiddenWorkspaceIds } from "@/agent/workspace/workspace-sidebar-store";
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

export async function GET(request: Request) {
  try {
    const workspace = await getCurrentWorkspace();
    const grouped =
      new URL(request.url).searchParams.get("grouped") === "projects";

    if (grouped) {
      const traces = await listTraces();
      const projects = buildAgentProjectSidebar({
        traces,
        memories: listAllThreadMemories(),
        metas: listAllThreadMetas(),
        hiddenWorkspaceIds: listHiddenWorkspaceIds(),
      });
      return Response.json({
        currentWorkspaceId: workspace.id,
        projects,
      });
    }

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
  const url = new URL(request.url);
  const threadId = url.searchParams.get("threadId")?.trim();
  const workspaceIdParam = url.searchParams.get("workspaceId")?.trim();
  if (!threadId) {
    return Response.json({ error: "threadId is required." }, { status: 400 });
  }

  try {
    const memory = getThreadMemory(threadId);
    const meta = getThreadMeta(threadId);
    let threadWorkspaceId =
      workspaceIdParam ?? memory?.workspaceId ?? meta?.workspaceId;

    if (!threadWorkspaceId) {
      for (const trace of await listTraces()) {
        if (resolveThreadIdFromTrace(trace) !== threadId) continue;
        if (trace.task?.workspaceId) {
          threadWorkspaceId = trace.task.workspaceId;
          break;
        }
      }
    }

    if (!threadWorkspaceId) {
      return Response.json({ error: "Thread workspace not found." }, { status: 404 });
    }

    const memoryDeleted = deleteThreadMemory(threadId);
    hideThreadInSidebar(threadId, threadWorkspaceId);

    for (const trace of await listTraces()) {
      if (trace.thread?.id === threadId) {
        updateTraceThread(trace.id, { contextSummary: undefined });
      }
    }

    return Response.json({
      ok: true,
      memoryDeleted,
      workspaceId: threadWorkspaceId,
      note: "Session hidden from sidebar. Rolling memory cleared. Trace files unchanged.",
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
