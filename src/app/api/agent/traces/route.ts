/**
 * Agent trace API.
 *
 * 只读查看持久化 trace，便于刷新后恢复任务事件。
 */
import { resolveThreadIdFromTrace } from "@/agent/memory/agent-thread-index";
import {
  isRemoteTraceEnabled,
  proxyTraceGet,
} from "@/agent-server/remote-trace";
import {
  getTrace,
  getTraceByTaskId,
  listTraces,
} from "@/agent/trace/trace-store";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (isRemoteTraceEnabled()) {
    return proxyTraceGet(request);
  }

  const url = new URL(request.url);
  const traceId = url.searchParams.get("id");
  const taskId = url.searchParams.get("taskId");

  if (taskId) {
    const trace = await getTraceByTaskId(taskId);
    if (!trace) {
      return Response.json({ error: "Trace not found for task." }, { status: 404 });
    }
    return Response.json({ trace });
  }

  if (traceId) {
    const trace = await getTrace(traceId);
    if (!trace) {
      return Response.json({ error: "Trace not found." }, { status: 404 });
    }
    return Response.json({ trace });
  }

  const traces = await listTraces();
  return Response.json({
    traces: traces.map((trace) => {
      const threadId = resolveThreadIdFromTrace(trace);
      const thread = trace.thread
        ? { ...trace.thread, id: trace.thread.id ?? threadId ?? undefined }
        : threadId
          ? { id: threadId }
          : undefined;
      return {
        id: trace.id,
        thread,
        task: trace.task,
        createdAt: trace.createdAt,
        updatedAt: trace.updatedAt,
        eventCount: trace.events.length,
      };
    }),
  });
}
