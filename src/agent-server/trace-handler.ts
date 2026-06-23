import type { IncomingMessage, ServerResponse } from "node:http";
import {
  getTrace,
  getTraceByTaskId,
  listTraces,
} from "@/agent/trace/trace-store";
import { resolveThreadIdFromTrace } from "@/agent/memory/agent-thread-index";

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

export async function handleTraceGet(
  _req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<void> {
  const traceId = url.searchParams.get("id");
  const taskId = url.searchParams.get("taskId");

  if (taskId) {
    const trace = await getTraceByTaskId(taskId);
    if (!trace) {
      sendJson(res, 404, { error: "Trace not found for task." });
      return;
    }
    sendJson(res, 200, { trace });
    return;
  }

  if (traceId) {
    const trace = await getTrace(traceId);
    if (!trace) {
      sendJson(res, 404, { error: "Trace not found." });
      return;
    }
    sendJson(res, 200, { trace });
    return;
  }

  const traces = await listTraces();
  sendJson(res, 200, {
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
