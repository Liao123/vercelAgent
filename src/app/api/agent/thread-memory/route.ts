/**
 * Thread 滚动记忆只读 API（跨 Task 会话记忆）。
 */
import {
  getLatestThreadMemoryForWorkspace,
  getThreadMemory,
  listThreadMemoriesForWorkspace,
} from "@/agent/memory/thread-memory-store";
import { getCurrentWorkspace } from "@/agent/workspace";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const threadId = url.searchParams.get("threadId");

  try {
    const workspace = await getCurrentWorkspace();

    if (threadId) {
      const record = getThreadMemory(threadId);
      if (!record) {
        return Response.json({ error: "Thread memory not found." }, { status: 404 });
      }
      if (record.workspaceId !== workspace.id) {
        return Response.json({ error: "Thread memory not in workspace." }, { status: 403 });
      }
      return Response.json({
        memory: {
          ...record,
          title: record.title ?? record.lastUserRequest?.slice(0, 56),
        },
      });
    }

    const latest = getLatestThreadMemoryForWorkspace(workspace.id);
    const list = listThreadMemoriesForWorkspace(workspace.id);
    return Response.json({
      workspaceId: workspace.id,
      latest,
      memories: list.map((item) => ({
        threadId: item.threadId,
        title: item.title ?? item.lastUserRequest?.slice(0, 56),
        round: item.round,
        method: item.method,
        updatedAt: item.updatedAt,
        lastTaskId: item.lastTaskId,
        summaryPreview:
          item.summaryPreview ?? item.memoryContent.slice(0, 280),
      })),
    });
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Failed to read thread memory.",
      },
      { status: 500 },
    );
  }
}
