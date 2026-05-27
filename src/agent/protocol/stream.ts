/**
 * Agent 事件流协议工具。
 *
 * 当前用 Server-Sent Events 输出 AgentEvent，后续如果改成 WebSocket/JSON-RPC，
 * 也应该保持事件结构稳定，让 UI 能持续看到任务进度。
 */
import type { AgentEvent } from "@/agent/types";

export type AgentEventWriter = {
  emit(event: AgentEvent): void;
  close(): void;
  error(error: unknown): void;
  response: Response;
};

export function createAgentEventStream(): AgentEventWriter {
  const encoder = new TextEncoder();
  let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controllerRef = controller;
    },
  });

  return {
    response: new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    }),
    emit(event) {
      if (closed || !controllerRef) return;
      try {
        controllerRef.enqueue(
          encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`),
        );
      } catch {
        closed = true;
      }
    },
    close() {
      if (closed || !controllerRef) return;
      closed = true;
      controllerRef.close();
    },
    error(error) {
      if (closed || !controllerRef) return;
      closed = true;
      controllerRef.error(error);
    },
  };
}
