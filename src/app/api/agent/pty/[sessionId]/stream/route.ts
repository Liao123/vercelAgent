/**
 * A168：PTY 输出 SSE 流。
 * 阶段 B：AGENT_SERVER_URL 时从 agent-server 透传 SSE。
 */
import {
  getPtySession,
  subscribePtySession,
} from "@/agent/terminal/pty-session-manager";
import {
  isRemotePtyEnabled,
  proxyPtyStream,
} from "@/agent-server/remote-pty";
import { formatPtyStreamSseFrame, HARNESS_SSE_HEADERS } from "@/agent/protocol/harness";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await context.params;
  const trimmed = sessionId?.trim();
  if (!trimmed) {
    return Response.json({ error: "PTY session not found." }, { status: 404 });
  }

  if (isRemotePtyEnabled()) {
    return proxyPtyStream(request, trimmed);
  }

  if (!getPtySession(trimmed)) {
    return Response.json({ error: "PTY session not found." }, { status: 404 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const unsubscribe = subscribePtySession(trimmed, (event) => {
        controller.enqueue(
          encoder.encode(formatPtyStreamSseFrame(event)),
        );
        if (event.type === "exit") {
          unsubscribe?.();
          controller.close();
        }
      });

      if (!unsubscribe) {
        controller.close();
        return;
      }

      request.signal.addEventListener("abort", () => {
        unsubscribe();
        try {
          controller.close();
        } catch {
          /* ignore */
        }
      });
    },
  });

  return new Response(stream, {
    headers: HARNESS_SSE_HEADERS,
  });
}
