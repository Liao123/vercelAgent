/**
 * Agent trace API.
 *
 * 只读查看持久化 trace，便于刷新后恢复任务事件。
 */
import { getTrace, listTraces } from "@/agent/trace/trace-store";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const traceId = url.searchParams.get("id");

  if (traceId) {
    const trace = await getTrace(traceId);
    if (!trace) {
      return Response.json({ error: "Trace not found." }, { status: 404 });
    }
    return Response.json({ trace });
  }

  const traces = await listTraces();
  return Response.json({
    traces: traces.map((trace) => ({
      id: trace.id,
      thread: trace.thread,
      task: trace.task,
      createdAt: trace.createdAt,
      updatedAt: trace.updatedAt,
      eventCount: trace.events.length,
    })),
  });
}
