/**
 * Agent 事件流协议工具。
 *
 * 帧格式见 `@/agent/protocol/harness`（HARNESS_PROTOCOL_VERSION）。
 */
import type { AgentEvent } from "@/agent/types";
import {
  formatAgentLoopSseFrame,
  HARNESS_SSE_HEADERS,
} from "@/agent/protocol/harness";

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
      headers: HARNESS_SSE_HEADERS,
    }),
    emit(event) {
      if (closed || !controllerRef) return;
      try {
        controllerRef.enqueue(encoder.encode(formatAgentLoopSseFrame(event)));
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
